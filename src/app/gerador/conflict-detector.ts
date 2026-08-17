import prisma from '@/lib/prisma';

export type ConflictType =
  | 'MISSING_CLASSES'
  | 'TEACHER_UNAVAILABLE'
  | 'TEACHER_DOUBLE_BOOKED'
  | 'CLASS_DOUBLE_BOOKED'
  | 'NO_TEACHER';

export type SuggestedFixType = 'add_class' | 'move_class' | 'swap_teacher' | 'assign_teacher';

export interface SuggestedFix {
  type: SuggestedFixType;
  description: string;
  data: {
    classId?: string;
    subjectId?: string;
    teacherId?: string;
    fromDay?: number;
    fromPeriod?: number;
    toDay?: number;
    toPeriod?: number;
    swapTeacherId?: string;
  };
}

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: 'high' | 'medium' | 'low';
  classId: string;
  className: string;
  subjectId?: string;
  subjectName?: string;
  teacherId?: string;
  teacherName?: string;
  dayOfWeek?: number;
  period?: number;
  description: string;
  affectedSlots: { classId: string; dayOfWeek: number; period: number }[];
  suggestedFix?: SuggestedFix;
  autoFixable: boolean;
}

export interface ScheduleDiff {
  classId: string;
  className: string;
  dayOfWeek: number;
  period: number;
  status: 'kept' | 'changed' | 'removed' | 'added';
  oldSubject?: string;
  oldTeacher?: string;
  newSubject?: string;
  newTeacher?: string;
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

export async function detectConflicts(): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];

  const classes = await prisma.class.findMany();
  const curriculums = await prisma.curriculum.findMany({ include: { Class: true, Subject: true, Teacher: true } });
  const schedules = await prisma.schedule.findMany({ include: { Class: true, Subject: true, Teacher: true } });
  const availabilities = await prisma.availability.findMany();
  const subjectAliases = await prisma.subjectAlias.findMany();

  const aliasTargetByName = new Map<string, string>();
  for (const alias of subjectAliases) {
    aliasTargetByName.set(alias.sourceName.toLowerCase(), alias.targetName);
  }

  const classMap = new Map(classes.map(c => [c.id, c]));

  // Build teacher unavailability set (used by multiple checks)
  // Key format: teacherId-dayOfWeek-period (periods are ALWAYS 1-6)
  const teacherUnavail = new Set<string>();
  for (const a of availabilities) {
    if (!a.isAvailable) teacherUnavail.add(a.teacherId + '-' + a.dayOfWeek + '-' + a.period);
  }

  // Check for missing classes
  for (const curr of curriculums) {
    if (curr.Subject && aliasTargetByName.has(curr.Subject.name.toLowerCase())) continue;

    const placed = schedules.filter(s => s.classId === curr.classId && s.subjectId === curr.subjectId).length;
    const needed = curr.classesPerWeek - placed;

    if (needed > 0) {
      const cls = classMap.get(curr.classId);
      const shift = cls?.shift || 'MORNING';
      
      // Find available slots for this class
      const classSlots = schedules.filter(s => s.classId === curr.classId);
      const occupiedSlots = new Set(classSlots.map(s => `${s.dayOfWeek}-${s.period}`));
      
      // Collect all candidate slots, sorted by gap-filling potential
      const candidates: { day: number; period: number; gapScore: number }[] = [];
      
      for (let day = 1; day <= 5; day++) {
        const maxP = (cls?.level === 'INFANTIL' || cls?.level === 'FUND1') ? 5 : 6;
        for (let period = 1; period <= maxP; period++) {
          if (occupiedSlots.has(`${day}-${period}`)) continue;
          
          // Check if teacher is available at this time
          let teacherOk = true;
          if (curr.teacherId) {
            const unavailKey = curr.teacherId + '-' + day + '-' + period;
            if (teacherUnavail.has(unavailKey)) teacherOk = false;
            
            // Check if teacher already teaches at this time (double-booked)
            if (teacherOk) {
              const teacherConflict = schedules.find(s =>
                s.teacherId === curr.teacherId &&
                s.dayOfWeek === day &&
                s.period === period
              );
              if (teacherConflict) teacherOk = false;
            }
          }
          
          if (!teacherOk) continue;
          
          // Score: prefer positions that fill gaps (adjacent to existing classes)
          const existingPeriods = classSlots
            .filter(s => s.dayOfWeek === day)
            .map(s => s.period)
            .sort((a, b) => a - b);
          
          let gapScore = 0;
          if (existingPeriods.length > 0) {
            for (const ep of existingPeriods) {
              if (Math.abs(period - ep) === 1) gapScore += 10;
            }
            const minP = Math.min(...existingPeriods);
            const maxP = Math.max(...existingPeriods);
            if (period > minP && period < maxP) gapScore += 5;
          } else {
            if (period === 1) gapScore += 3;
          }
          
          candidates.push({ day, period, gapScore });
        }
      }
      
      // Sort by gap score (best gap-filling first)
      candidates.sort((a, b) => b.gapScore - a.gapScore);
      
      const best = candidates[0];
      const foundSlot = !!best;
      const suggestedDay = best?.day || 1;
      const suggestedPeriod = best?.period || 1;
      
      conflicts.push({
        id: `missing-${curr.classId}-${curr.subjectId}`,
        type: 'MISSING_CLASSES',
        severity: needed >= 2 ? 'high' : 'medium',
        classId: curr.classId,
        className: cls?.name || '',
        subjectId: curr.subjectId,
        subjectName: curr.Subject.name,
        teacherId: curr.teacherId || undefined,
        teacherName: curr.Teacher?.name || undefined,
        description: `Turma ${cls?.name}: faltam ${needed} aula(s) de ${curr.Subject.name} (${placed}/${curr.classesPerWeek})`,
        affectedSlots: [],
        autoFixable: foundSlot,
        suggestedFix: foundSlot ? {
          type: 'add_class',
          description: `Adicionar aula de ${curr.Subject.name} na ${['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'][suggestedDay]}ª ${suggestedPeriod}ª aula`,
          data: {
            classId: curr.classId,
            subjectId: curr.subjectId,
            teacherId: curr.teacherId || undefined,
            toDay: suggestedDay,
            toPeriod: suggestedPeriod,
          },
        } : undefined,
      });
    }
  }

  // Check teacher unavailability

  for (const schedule of schedules) {
    if (schedule.isFixed) continue;
    if (!schedule.teacherId) continue;

    const cls = classMap.get(schedule.classId);
    const shift = cls?.shift || 'MORNING';
    const period = schedule.period;
    const key = schedule.teacherId + '-' + schedule.dayOfWeek + '-' + period;
    if (teacherUnavail.has(key)) {
      const cls = classMap.get(schedule.classId);
      
      // Find alternative times when teacher is available
      const teacherAvailabilities = availabilities.filter(
        a => a.teacherId === schedule.teacherId && a.isAvailable
      );
      
      let suggestedDay = schedule.dayOfWeek;
      let suggestedPeriod = schedule.period;
      let foundAlternative = false;
      
      // Check same day, different period first
      for (const avail of teacherAvailabilities) {
        if (avail.dayOfWeek === schedule.dayOfWeek && avail.period !== period) {
          const testKey = schedule.teacherId + '-' + schedule.dayOfWeek + '-' + avail.period;
          if (!teacherUnavail.has(testKey)) {
            suggestedDay = schedule.dayOfWeek;
            suggestedPeriod = avail.period;
            foundAlternative = true;
            break;
          }
        }
      }
      
      // If no same-day alternative, try other days
      if (!foundAlternative) {
        for (const avail of teacherAvailabilities) {
          const testKey = schedule.teacherId + '-' + avail.dayOfWeek + '-' + avail.period;
          if (!teacherUnavail.has(testKey)) {
            suggestedDay = avail.dayOfWeek;
            suggestedPeriod = avail.period;
            foundAlternative = true;
            break;
          }
        }
      }
      
      conflicts.push({
        id: `unavail-${schedule.id}`,
        type: 'TEACHER_UNAVAILABLE',
        severity: 'high',
        classId: schedule.classId,
        className: cls?.name || '',
        subjectId: schedule.subjectId,
        subjectName: schedule.Subject.name,
        teacherId: schedule.teacherId,
        teacherName: schedule.Teacher?.name || undefined,
        dayOfWeek: schedule.dayOfWeek,
        period: schedule.period,
        description: `${schedule.Teacher?.name} não está disponível ${['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'][schedule.dayOfWeek]}ª ${schedule.period}ª aula`,
        affectedSlots: [{ classId: schedule.classId, dayOfWeek: schedule.dayOfWeek, period: schedule.period }],
        autoFixable: foundAlternative,
        suggestedFix: foundAlternative ? {
          type: 'move_class',
          description: `Mover aula de ${schedule.Subject.name} para ${['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'][suggestedDay]}ª ${suggestedPeriod}ª aula`,
          data: {
            classId: schedule.classId,
            subjectId: schedule.subjectId,
            teacherId: schedule.teacherId,
            fromDay: schedule.dayOfWeek,
            fromPeriod: schedule.period,
            toDay: suggestedDay,
            toPeriod: suggestedPeriod,
          },
        } : undefined,
      });
    }
  }

  // Check teacher double booking
  const teacherSlots = new Map<string, { schedule: typeof schedules[0]; period: number }[]>();
  for (const schedule of schedules) {
    if (!schedule.teacherId) continue;
    const cls = classMap.get(schedule.classId);
    const period = schedule.period;
    const key = schedule.teacherId + '-' + schedule.dayOfWeek + '-' + (cls?.shift || 'MORNING');
    if (!teacherSlots.has(key)) teacherSlots.set(key, []);
    teacherSlots.get(key)!.push({ schedule, period });
  }

  for (const [key, slots] of teacherSlots) {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].period === slots[j].period) {
          const s1 = slots[i].schedule;
          const s2 = slots[j].schedule;

          if (s1.subjectId === s2.subjectId) continue;
          // Skip duplicate entries for the same class+subject+day+period
          if (s1.classId === s2.classId && s1.subjectId === s2.subjectId && s1.dayOfWeek === s2.dayOfWeek && s1.period === s2.period) continue;
          // Skip if both are for the same class on the same day+period (class double-booking, not teacher)
          if (s1.classId === s2.classId && s1.dayOfWeek === s2.dayOfWeek && s1.period === s2.period) continue;
          // Skip if different classes - multi-class lecture (Capela, Bilingue, etc.)
          if (s1.classId !== s2.classId) continue;

          const cls1 = classMap.get(s1.classId);
          const cls2 = classMap.get(s2.classId);
          const teacherName = s1.Teacher?.name || '';
          
          // Find alternative time for second class
          const teacherAvailabilities = availabilities.filter(
            a => a.teacherId === s1.teacherId && a.isAvailable
          );
          
          let suggestedDay = s2.dayOfWeek;
          let suggestedPeriod = s2.period;
          let foundAlternative = false;
          
          // Try to find alternative time for the second class
          for (const avail of teacherAvailabilities) {
            const testKey = s1.teacherId + '-' + avail.dayOfWeek + '-' + avail.period;
            if (!teacherUnavail.has(testKey) && avail.dayOfWeek === s2.dayOfWeek && avail.period !== s2.period) {
              suggestedDay = avail.dayOfWeek;
              suggestedPeriod = avail.period;
              foundAlternative = true;
              break;
            }
          }
          
          conflicts.push({
            id: `dbook-${s1.id}-${s2.id}`,
            type: 'TEACHER_DOUBLE_BOOKED',
            severity: 'high',
            classId: s1.classId,
            className: cls1?.name || '',
            subjectId: s1.subjectId,
            subjectName: s1.Subject.name,
            teacherId: s1.teacherId || undefined,
            teacherName,
            dayOfWeek: s1.dayOfWeek,
            period: s1.period,
            description: `${teacherName} está em dois lugares ${['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'][s1.dayOfWeek]}ª ${s1.period}ª: ${cls1?.name} (${s1.Subject.name}) e ${cls2?.name} (${s2.Subject.name})`,
            affectedSlots: [
              { classId: s1.classId, dayOfWeek: s1.dayOfWeek, period: s1.period },
              { classId: s2.classId, dayOfWeek: s2.dayOfWeek, period: s2.period },
            ],
            autoFixable: foundAlternative,
            suggestedFix: foundAlternative ? {
              type: 'move_class',
              description: `Mover aula de ${s2.Subject.name} (${cls2?.name}) para ${['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'][suggestedDay]}ª ${suggestedPeriod}ª aula`,
              data: {
                classId: s2.classId,
                subjectId: s2.subjectId,
                teacherId: s1.teacherId || undefined,
                fromDay: s2.dayOfWeek,
                fromPeriod: s2.period,
                toDay: suggestedDay,
                toPeriod: suggestedPeriod,
              },
            } : undefined,
          });
        }
      }
    }
  }

  // Check slots without teacher
  for (const schedule of schedules) {
    if (schedule.isFixed) continue;
    if (!schedule.teacherId) {
      const cls = classMap.get(schedule.classId);
      
      // Find curriculum entry to get the assigned teacher
      const currEntry = curriculums.find(
        c => c.classId === schedule.classId && c.subjectId === schedule.subjectId
      );
      
      const suggestedTeacherId = currEntry?.teacherId || undefined;
      const suggestedTeacherName = currEntry?.Teacher?.name || undefined;
      
      conflicts.push({
        id: `noteacher-${schedule.id}`,
        type: 'NO_TEACHER',
        severity: 'low',
        classId: schedule.classId,
        className: cls?.name || '',
        subjectId: schedule.subjectId,
        subjectName: schedule.Subject.name,
        dayOfWeek: schedule.dayOfWeek,
        period: schedule.period,
        description: `Aula de ${schedule.Subject.name} (${cls?.name}) sem professor atribuído`,
        affectedSlots: [{ classId: schedule.classId, dayOfWeek: schedule.dayOfWeek, period: schedule.period }],
        autoFixable: !!suggestedTeacherId,
        suggestedFix: suggestedTeacherId ? {
          type: 'assign_teacher',
          description: `Atribuir professor ${suggestedTeacherName} para esta aula`,
          data: {
            classId: schedule.classId,
            subjectId: schedule.subjectId,
            teacherId: suggestedTeacherId,
          },
        } : undefined,
      });
    }
  }

  return conflicts;
}
