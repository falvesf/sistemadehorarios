import prisma from '@/lib/prisma';
import { ScheduleDiff, Conflict, detectConflicts, SuggestedFix } from './conflict-detector';
import { ScheduleConfig, DEFAULT_CONFIG } from './types';

export interface RecalculationChange {
  type: 'replace_teacher';
  oldTeacherId: string;
  newTeacherId: string;
  affectedSubjectId?: string;
  affectedClassId?: string;
}

export interface RecalculationProposal {
  conflicts: Conflict[];
  diffs: ScheduleDiff[];
  summary: {
    totalChanges: number;
    slotsKept: number;
    slotsChanged: number;
    slotsRemoved: number;
    slotsAdded: number;
  };
}

function timeToMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function doTimeSlotsOverlap(ts1: { startTime: string; endTime: string }, ts2: { startTime: string; endTime: string }) {
  return Math.max(timeToMin(ts1.startTime), timeToMin(ts2.startTime)) < Math.min(timeToMin(ts1.endTime), timeToMin(ts2.endTime));
}

function getMaxPeriods(level: string, dayOfWeek: number, shift: string, config: ScheduleConfig): number {
  const isFriday = dayOfWeek === 5;
  const periodConfig = isFriday ? config.classDistribution.friday : config.classDistribution.weekdays;
  const shiftConfig = shift === 'MORNING' ? periodConfig.morning : periodConfig.afternoon;
  switch (level) {
    case 'INFANTIL': return shiftConfig.INFANTIL;
    case 'FUND1': return shiftConfig.FUND1;
    case 'FUND2': return shiftConfig.FUND2;
    case 'MEDIO': return shiftConfig.MEDIO;
    default: return 5;
  }
}

export async function runRecalculation(changes: RecalculationChange[], config: ScheduleConfig = DEFAULT_CONFIG): Promise<RecalculationProposal> {
  const classes = await prisma.class.findMany();
  const curriculums = await prisma.curriculum.findMany({ include: { Class: true, Subject: true, Teacher: true } });
  const schedules = await prisma.schedule.findMany({ include: { Class: true, Subject: true, Teacher: true } });
  const availabilities = await prisma.availability.findMany();
  const timeSlots = await prisma.timeSlot.findMany();
  const subjectAliases = await prisma.subjectAlias.findMany();

  const aliasTargetByName = new Map<string, string>();
  for (const alias of subjectAliases) {
    aliasTargetByName.set(alias.sourceName.toLowerCase(), alias.targetName);
  }

  const classMap = new Map(classes.map(c => [c.id, c]));

  const slotLookup = new Map<string, { startTime: string; endTime: string }>();
  for (const ts of timeSlots) {
    slotLookup.set(ts.level + '-' + ts.shift + '-' + ts.dayOfWeek + '-' + ts.period, ts);
  }

  // Step 1: Identify slots that need to change
  const slotsToRemove = new Set<string>();
  const slotsToReassign = new Map<string, { oldTeacherId: string | null; newTeacherId: string | null }>();

  for (const change of changes) {
    if (change.type === 'replace_teacher') {
      // Find all schedule slots for the old teacher
      for (const schedule of schedules) {
        if (schedule.isFixed) continue;
        if (schedule.teacherId === change.oldTeacherId) {
          if (change.affectedSubjectId && schedule.subjectId !== change.affectedSubjectId) continue;
          if (change.affectedClassId && schedule.classId !== change.affectedClassId) continue;
          slotsToRemove.add(schedule.id);
          slotsToReassign.set(schedule.id, {
            oldTeacherId: schedule.teacherId,
            newTeacherId: change.newTeacherId,
          });
        }
      }
    }
  }

  // Step 2: Build the current grid state (excluding slots to remove)
  const occupied = new Set<string>();
  const teacherOccupied = new Set<string>();
  const teacherUnavail = new Set<string>();
  const classDayCount = new Map<string, Map<number, number>>();
  const classSubjectDayCount = new Map<string, Map<string, Map<number, number>>>();
  const teacherDaySlots = new Map<string, Map<number, { startTime: string; endTime: string }[]>>();

  for (const a of availabilities) {
    if (!a.isAvailable) teacherUnavail.add(a.teacherId + '-' + a.dayOfWeek + '-' + (a.shift || 'MORNING') + '-' + a.period);
  }

  const placeOnGrid = (cid: string, sid: string, tid: string | null, day: number, period: number, shift: string) => {
    occupied.add(cid + '-' + day + '-' + period);
    if (tid) {
      teacherOccupied.add(tid + '-' + day + '-' + shift + '-' + period);
      if (!teacherDaySlots.has(tid)) teacherDaySlots.set(tid, new Map());
      const dm = teacherDaySlots.get(tid)!;
      if (!dm.has(day)) dm.set(day, []);
      const level = classMap.get(cid)?.level || 'FUND2';
      const slot = slotLookup.get(level + '-' + shift + '-' + day + '-' + period);
      if (slot) dm.get(day)!.push(slot);
    }
    if (!classDayCount.has(cid)) classDayCount.set(cid, new Map());
    const dc = classDayCount.get(cid)!;
    dc.set(day, (dc.get(day) || 0) + 1);
    if (!classSubjectDayCount.has(cid)) classSubjectDayCount.set(cid, new Map());
    const csm = classSubjectDayCount.get(cid)!;
    if (!csm.has(sid)) csm.set(sid, new Map());
    csm.get(sid)!.set(day, (csm.get(sid)!.get(day) || 0) + 1);
  };

  // Place fixed schedules
  const fixedSchedules = schedules.filter(s => s.isFixed);
  for (const s of fixedSchedules) {
    const c = classMap.get(s.classId);
    if (c) placeOnGrid(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
  }

  // Place non-removed, non-fixed schedules
  const keptSchedules = schedules.filter(s => !s.isFixed && !slotsToRemove.has(s.id));
  for (const s of keptSchedules) {
    const c = classMap.get(s.classId);
    if (c) placeOnGrid(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
  }

  // Step 3: Try to reassign removed slots with the new teacher
  const slotsNeedingReassignment: { scheduleId: string; classId: string; subjectId: string; newTeacherId: string | null; shift: string; level: string }[] = [];

  for (const [scheduleId, info] of slotsToReassign) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) continue;
    const cls = classMap.get(schedule.classId);
    if (!cls) continue;
    slotsNeedingReassignment.push({
      scheduleId,
      classId: schedule.classId,
      subjectId: schedule.subjectId,
      newTeacherId: info.newTeacherId,
      shift: cls.shift,
      level: cls.level,
    });
  }

  const canPlace = (cid: string, sid: string, tid: string | null, day: number, period: number, shift: string, level: string): boolean => {
    if (occupied.has(cid + '-' + day + '-' + period)) return false;
    const maxP = getMaxPeriods(level, day, shift, config);
    if ((classDayCount.get(cid)?.get(day) || 0) >= maxP) return false;
    if ((classSubjectDayCount.get(cid)?.get(sid)?.get(day) || 0) >= 2) return false;
    if (!tid) return true;
    if (teacherUnavail.has(tid + '-' + day + '-' + shift + '-' + period)) return false;
    if (teacherOccupied.has(tid + '-' + day + '-' + shift + '-' + period)) return false;
    const mySlot = slotLookup.get(level + '-' + shift + '-' + day + '-' + period);
    if (!mySlot) return true;
    const tSlots = teacherDaySlots.get(tid)?.get(day);
    if (!tSlots || tSlots.length === 0) return true;
    for (const ts of tSlots) {
      if (doTimeSlotsOverlap(mySlot, ts)) return false;
    }
    return true;
  };

  const reassignmentResults: { scheduleId: string; newDay: number; newPeriod: number }[] = [];
  const failedReassignments: { scheduleId: string; classId: string; subjectId: string }[] = [];

  for (const item of slotsNeedingReassignment) {
    const schedule = schedules.find(s => s.id === item.scheduleId);
    if (!schedule) continue;

    // First try the original position
    if (canPlace(item.classId, item.subjectId, item.newTeacherId, schedule.dayOfWeek, schedule.period, item.shift, item.level)) {
      placeOnGrid(item.classId, item.subjectId, item.newTeacherId, schedule.dayOfWeek, schedule.period, item.shift);
      reassignmentResults.push({ scheduleId: item.scheduleId, newDay: schedule.dayOfWeek, newPeriod: schedule.period });
      continue;
    }

    // Try other positions, preferring same day
    const days = [schedule.dayOfWeek, 1, 2, 3, 4, 5].filter((d, i, arr) => arr.indexOf(d) === i);
    const periods = [1, 2, 3, 4, 5, 6];
    let placed = false;

    for (const day of days) {
      if (placed) break;
      for (const period of periods) {
        if (canPlace(item.classId, item.subjectId, item.newTeacherId, day, period, item.shift, item.level)) {
          placeOnGrid(item.classId, item.subjectId, item.newTeacherId, day, period, item.shift);
          reassignmentResults.push({ scheduleId: item.scheduleId, newDay: day, newPeriod: period });
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      failedReassignments.push({ scheduleId: item.scheduleId, classId: item.classId, subjectId: item.subjectId });
    }
  }

  // Step 4: Build the diff list
  const diffs: ScheduleDiff[] = [];

  // Kept schedules (unchanged)
  for (const s of keptSchedules) {
    const cls = classMap.get(s.classId);
    diffs.push({
      classId: s.classId,
      className: cls?.name || '',
      dayOfWeek: s.dayOfWeek,
      period: s.period,
      status: 'kept',
      oldSubject: s.Subject.name,
      oldTeacher: s.Teacher?.name || undefined,
    });
  }

  // Changed schedules (same position, different teacher)
  for (const result of reassignmentResults) {
    const schedule = schedules.find(s => s.id === result.scheduleId);
    if (!schedule) continue;
    const cls = classMap.get(schedule.classId);
    const newTeacher = classes.length > 0 ? (await prisma.teacher.findUnique({ where: { id: slotsToReassign.get(result.scheduleId)?.newTeacherId || '' } })) : null;
    diffs.push({
      classId: schedule.classId,
      className: cls?.name || '',
      dayOfWeek: result.newDay,
      period: result.newPeriod,
      status: result.newDay === schedule.dayOfWeek && result.newPeriod === schedule.period ? 'changed' : 'added',
      oldSubject: schedule.Subject.name,
      oldTeacher: schedule.Teacher?.name || undefined,
      newSubject: schedule.Subject.name,
      newTeacher: newTeacher?.name || undefined,
    });
  }

  // Removed schedules (couldn't be reassigned)
  for (const fail of failedReassignments) {
    const schedule = schedules.find(s => s.id === fail.scheduleId);
    if (!schedule) continue;
    const cls = classMap.get(schedule.classId);
    diffs.push({
      classId: schedule.classId,
      className: cls?.name || '',
      dayOfWeek: schedule.dayOfWeek,
      period: schedule.period,
      status: 'removed',
      oldSubject: schedule.Subject.name,
      oldTeacher: schedule.Teacher?.name || undefined,
    });
  }

  // Summary
  const summary = {
    totalChanges: diffs.filter(d => d.status !== 'kept').length,
    slotsKept: diffs.filter(d => d.status === 'kept').length,
    slotsChanged: diffs.filter(d => d.status === 'changed').length,
    slotsRemoved: diffs.filter(d => d.status === 'removed').length,
    slotsAdded: diffs.filter(d => d.status === 'added').length,
  };

  const conflicts = await detectConflicts();

  return { conflicts, diffs, summary };
}

export async function applyRecalculation(changes: RecalculationChange[]): Promise<{ success: boolean; applied: number; error?: string }> {
  try {
    const schedules = await prisma.schedule.findMany({ include: { Class: true } });

    let applied = 0;

    for (const change of changes) {
      if (change.type === 'replace_teacher') {
        // Update all schedules for the old teacher to the new teacher
        const result = await prisma.schedule.updateMany({
          where: {
            teacherId: change.oldTeacherId,
            isFixed: false,
            ...(change.affectedSubjectId ? { subjectId: change.affectedSubjectId } : {}),
            ...(change.affectedClassId ? { classId: change.affectedClassId } : {}),
          },
          data: { teacherId: change.newTeacherId },
        });
        applied += result.count;

        // Also update curriculum
        await prisma.curriculum.updateMany({
          where: { teacherId: change.oldTeacherId },
          data: { teacherId: change.newTeacherId },
        });
      }
    }

    return { success: true, applied };
  } catch (e: any) {
    return { success: false, applied: 0, error: e.message };
  }
}

export async function applyAutoFix(fix: SuggestedFix): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    switch (fix.type) {
      case 'add_class':
        return await addMissingClass(fix);
      case 'move_class':
        return await moveClass(fix);
      case 'assign_teacher':
        return await assignTeacher(fix);
      default:
        return { success: false, message: 'Tipo de correção não suportado', error: 'Unsupported fix type' };
    }
  } catch (e: any) {
    return { success: false, message: 'Erro ao aplicar correção', error: e.message };
  }
}

async function addMissingClass(fix: SuggestedFix): Promise<{ success: boolean; message: string; error?: string }> {
  const { classId, subjectId, teacherId, toDay, toPeriod } = fix.data;
  
  if (!classId || !subjectId || !toDay || !toPeriod) {
    return { success: false, message: 'Dados incompletos para adicionar aula', error: 'Missing required data' };
  }

  const existing = await prisma.schedule.findFirst({
    where: { classId, dayOfWeek: toDay, period: toPeriod }
  });

  if (existing) {
    return { success: false, message: 'Horário já ocupado por outra aula', error: 'Slot occupied' };
  }

  await prisma.schedule.create({
    data: {
      classId,
      subjectId,
      teacherId: teacherId || null,
      dayOfWeek: toDay,
      period: toPeriod,
      isFixed: false,
    }
  });

  return { success: true, message: 'Aula adicionada com sucesso' };
}

async function moveClass(fix: SuggestedFix): Promise<{ success: boolean; message: string; error?: string }> {
  const { classId, subjectId, teacherId, fromDay, fromPeriod, toDay, toPeriod } = fix.data;
  
  if (!classId || !subjectId || !fromDay || !fromPeriod || !toDay || !toPeriod) {
    return { success: false, message: 'Dados incompletos para mover aula', error: 'Missing required data' };
  }

  const existing = await prisma.schedule.findFirst({
    where: {
      classId,
      subjectId,
      dayOfWeek: fromDay,
      period: fromPeriod,
    }
  });

  if (!existing) {
    return { success: false, message: 'Aula original não encontrada', error: 'Schedule not found' };
  }

  const targetOccupied = await prisma.schedule.findFirst({
    where: { classId, dayOfWeek: toDay, period: toPeriod }
  });

  if (targetOccupied) {
    return { success: false, message: 'Horário de destino já ocupado', error: 'Target slot occupied' };
  }

  await prisma.schedule.update({
    where: { id: existing.id },
    data: {
      dayOfWeek: toDay,
      period: toPeriod,
    }
  });

  return { success: true, message: 'Aula movida com sucesso' };
}

async function assignTeacher(fix: SuggestedFix): Promise<{ success: boolean; message: string; error?: string }> {
  const { classId, subjectId, teacherId } = fix.data;
  
  if (!classId || !subjectId || !teacherId) {
    return { success: false, message: 'Dados incompletos para atribuir professor', error: 'Missing required data' };
  }

  // Find all schedule entries for this class and subject without a teacher
  const schedules = await prisma.schedule.findMany({
    where: {
      classId,
      subjectId,
      teacherId: null,
    }
  });

  if (schedules.length === 0) {
    return { success: false, message: 'Nenhuma aula encontrada para atribuir professor', error: 'No schedule found' };
  }

  // Update all matching schedules
  await prisma.schedule.updateMany({
    where: {
      classId,
      subjectId,
      teacherId: null,
    },
    data: {
      teacherId,
    }
  });

  return { success: true, message: `Professor atribuído a ${schedules.length} aula(s)` };
}

export async function autoFixAllConflicts(): Promise<{ 
  fixed: number; 
  failed: number; 
  results: { conflictId: string; success: boolean; message: string }[] 
}> {
  const conflicts = await detectConflicts();
  const fixableConflicts = conflicts.filter(c => c.autoFixable && c.suggestedFix);
  
  let fixed = 0;
  let failed = 0;
  const results: { conflictId: string; success: boolean; message: string }[] = [];

  for (const conflict of fixableConflicts) {
    if (!conflict.suggestedFix) continue;
    
    const result = await applyAutoFix(conflict.suggestedFix);
    results.push({
      conflictId: conflict.id,
      success: result.success,
      message: result.message,
    });
    
    if (result.success) {
      fixed++;
    } else {
      failed++;
    }
  }

  return { fixed, failed, results };
}
