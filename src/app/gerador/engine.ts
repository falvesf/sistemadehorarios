import prisma from '@/lib/prisma';
import { ScheduleConfig, PlacedSlot, ToScheduleItem, DEFAULT_CONFIG } from './types';
import { runBacktracker, shuffleArray } from './backtracker';

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

function sortItems(items: { classId: string; subjectId: string; teacherId: string | null; shift: string; level: string; consecutiveCount?: number }[], strategy: string) {
  const arr = [...items];
  // Itens COM professor sempre primeiro (mais restritos)
  const withTeacher = (a: typeof arr[0], b: typeof arr[0]) => {
    if (a.teacherId && !b.teacherId) return -1;
    if (!a.teacherId && b.teacherId) return 1;
    return 0;
  };
  switch (strategy) {
    case 'reverse':
      return arr.reverse();
    case 'random':
      return shuffleArray(arr);
    case 'teacher-first': {
      const teacherCounts = new Map<string, number>();
      for (const item of arr) {
        if (item.teacherId) teacherCounts.set(item.teacherId, (teacherCounts.get(item.teacherId) || 0) + 1);
      }
      return arr.sort((a, b) => withTeacher(a, b) || (teacherCounts.get(b.teacherId || '') || 0) - (teacherCounts.get(a.teacherId || '') || 0));
    }
    case 'subject-first': {
      const subjectCounts = new Map<string, number>();
      for (const item of arr) subjectCounts.set(item.subjectId, (subjectCounts.get(item.subjectId) || 0) + 1);
      return arr.sort((a, b) => withTeacher(a, b) || (subjectCounts.get(b.subjectId) || 0) - (subjectCounts.get(a.subjectId) || 0));
    }
    default: {
      const teacherLoads = new Map<string, number>();
      for (const item of arr) {
        if (item.teacherId) teacherLoads.set(item.teacherId, (teacherLoads.get(item.teacherId) || 0) + 1);
      }
      return arr.sort((a, b) => withTeacher(a, b) || (teacherLoads.get(b.teacherId || '') || 0) - (teacherLoads.get(a.teacherId || '') || 0));
    }
  }
}

export async function runGenerator(mode: 'REPAIR' | 'SCRATCH', config: ScheduleConfig = DEFAULT_CONFIG) {
  try {
    const classes = await prisma.class.findMany();
    const curriculums = await prisma.curriculum.findMany({ include: { Class: true, Subject: true } });
    const timeSlots = await prisma.timeSlot.findMany();
    const availabilities = await prisma.availability.findMany();
    const fixedSchedules = await prisma.schedule.findMany({ where: { isFixed: true } });
    const currentSchedules = await prisma.schedule.findMany({ where: { isFixed: false } });
    const subjectAliases = await prisma.subjectAlias.findMany();
    const fixedSubjectConfigs = await prisma.fixedSubjectConfig.findMany({ include: { FixedSubjectClass: true, Subject: true } });

    // Deduplicate fixedSchedules: for each class+subject, keep only ONE entry
    // Prefer the entry whose period matches a fixedSubjectConfig, otherwise keep the first
    const fixedSubjectPeriodMap = new Map<string, number>(); // classId-subjectId -> configured period
    for (const fsc of fixedSubjectConfigs) {
      for (const cls of fsc.FixedSubjectClass) {
        if (cls.assignedPeriod) {
          fixedSubjectPeriodMap.set(cls.classId + '-' + fsc.subjectId, cls.assignedPeriod);
        }
      }
    }

    const dedupedFixedSchedules: typeof fixedSchedules = [];
    const fixedSeen = new Map<string, typeof fixedSchedules[0]>(); // classId-subjectId -> schedule
    const fixedToDelete: string[] = [];

    for (const s of fixedSchedules) {
      const key = s.classId + '-' + s.subjectId;
      const existing = fixedSeen.get(key);
      if (!existing) {
        fixedSeen.set(key, s);
        dedupedFixedSchedules.push(s);
      } else {
        // Duplicate found - keep the one matching fixedSubjectConfig period
        const configPeriod = fixedSubjectPeriodMap.get(key);
        if (configPeriod) {
          if (existing.period === configPeriod) {
            // existing matches config, delete this one
            fixedToDelete.push(s.id);
          } else if (s.period === configPeriod) {
            // this matches config, delete existing and replace
            fixedToDelete.push(existing.id);
            fixedSeen.set(key, s);
            // Replace in dedupedFixedSchedules
            const idx = dedupedFixedSchedules.indexOf(existing);
            if (idx >= 0) dedupedFixedSchedules[idx] = s;
          } else {
            // Neither matches config, delete this one
            fixedToDelete.push(s.id);
          }
        } else {
          // No config, just keep the first one
          fixedToDelete.push(s.id);
        }
      }
    }

    // Delete duplicate fixed entries from DB
    if (fixedToDelete.length > 0) {
      await prisma.schedule.deleteMany({ where: { id: { in: fixedToDelete } } });
    }

    const finalFixedSchedules = dedupedFixedSchedules;

    // Build alias map: sourceSubjectName -> targetSubjectName
    const aliasTargetByName = new Map<string, string>();
    for (const alias of subjectAliases) {
      aliasTargetByName.set(alias.sourceName.toLowerCase(), alias.targetName);
    }

    // Find subject IDs that are aliased (e.g., "Cultura Geral" -> should be treated as "Capela")
    // These subjects should NOT be distributed by the engine because they have fixed schedules
    const aliasedSubjectIds = new Set<string>();
    for (const curr of curriculums) {
      if (curr.Subject && aliasTargetByName.has(curr.Subject.name.toLowerCase())) {
        aliasedSubjectIds.add(curr.subjectId);
      }
    }

    if (mode === 'SCRATCH') {
      await prisma.schedule.deleteMany({ where: { isFixed: false } });
    }

    const classMap = new Map(classes.map(c => [c.id, c]));

    const slotLookup = new Map<string, { startTime: string; endTime: string }>();
    for (const ts of timeSlots) {
      slotLookup.set(ts.level + '-' + ts.shift + '-' + ts.dayOfWeek + '-' + ts.period, ts);
    }

    const occupied = new Set<string>();
    const teacherOccupied = new Set<string>();
    const teacherUnavail = new Set<string>();
    const classDayCount = new Map<string, Map<number, number>>();
    const classSubjectDayCount = new Map<string, Map<string, Map<number, number>>>();
    const teacherDaySlots = new Map<string, Map<number, { startTime: string; endTime: string }[]>>();
    const classDaySubjects = new Map<string, Map<number, Map<string, number>>>();

    // Periods are ALWAYS 1-6 for both shifts. No normalization/denormalization.
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
      if (!classDaySubjects.has(cid)) classDaySubjects.set(cid, new Map());
      const cds = classDaySubjects.get(cid)!;
      if (!cds.has(day)) cds.set(day, new Map());
      const subjMap = cds.get(day)!;
      subjMap.set(sid, (subjMap.get(sid) || 0) + 1);
    };

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

    const canPlaceDouble = (cid: string, sid: string, tid: string | null, day: number, period: number, shift: string, level: string): boolean => {
      if (!config.doublePeriods.enabled) return true;
      const maxConsecutive = config.doublePeriods.maxConsecutive;
      const currentConsecutive = classDaySubjects.get(cid)?.get(day)?.get(sid) || 0;
      if (currentConsecutive >= maxConsecutive) return false;
      return true;
    };

    for (const s of finalFixedSchedules) {
      const c = classMap.get(s.classId);
      if (c) placeOnGrid(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
    }

    if (mode === 'REPAIR') {
      for (const s of currentSchedules) {
        const c = classMap.get(s.classId);
        if (c) placeOnGrid(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
      }
    }

    for (const a of availabilities) {
      if (!a.isAvailable) teacherUnavail.add(a.teacherId + '-' + a.dayOfWeek + '-' + (a.shift || 'MORNING') + '-' + a.period);
    }

    // Step: Handle Fixed Subject Periods (e.g., Bilingue - same period every day for each class)
    // The engine assigns a period to each class and places the subject on ALL weekdays at that period
    const fixedSubjectSubjectIds = new Set<string>();
    const fixedSubjectPlaced: { classId: string; subjectId: string; teacherId: string | null; dayOfWeek: number; period: number }[] = [];
    const days = [1, 2, 3, 4, 5];

    // Track schedules displaced by fixedSubjectConfig for DB deletion
    const displacedScheduleIds: string[] = [];

    for (const fixedConfig of fixedSubjectConfigs) {
      fixedSubjectSubjectIds.add(fixedConfig.subjectId);

      // Find teacher for this subject in curriculums
      const curriculum = curriculums.find(c => c.subjectId === fixedConfig.subjectId);
      const teacherId = curriculum?.teacherId || null;

      // Sort classes by level (fewer periods first = more constrained)
      const sortedClasses = [...fixedConfig.FixedSubjectClass].sort((a, b) => {
        const classA = classMap.get(a.classId);
        const classB = classMap.get(b.classId);
        const maxPA = classA ? getMaxPeriods(classA.level, 1, classA.shift, config) : 5;
        const maxPB = classB ? getMaxPeriods(classB.level, 1, classB.shift, config) : 5;
        return maxPA - maxPB;
      });

      // Process EACH class individually - each class gets its own period
      // based on teacher availability (teacher can't teach multiple classes at same time)
      const teacherUsedPeriods = new Map<string, Set<number>>(); // teacherId -> set of periods already used

      for (const fsc of sortedClasses) {
        const cls = classMap.get(fsc.classId);
        if (!cls) continue;

        const classMaxP = getMaxPeriods(cls.level, 1, cls.shift, config);
        const validPeriods = [1, 2, 3, 4, 5, 6].filter(p => p <= classMaxP);

        // Try the preferred period first, then others
        const preferred = fsc.assignedPeriod && validPeriods.includes(fsc.assignedPeriod) ? fsc.assignedPeriod : null;
        const tryPeriods = preferred
          ? [preferred, ...validPeriods.filter(p => p !== preferred)]
          : validPeriods;

        let classPeriod: number | null = null;

        for (const period of tryPeriods) {
          if (classPeriod !== null) break;

          // Check teacher availability at this period for this class's shift
          if (teacherId) {
            // Check if teacher is unavailable at this period on any weekday
            let teacherFree = true;
            for (const day of days) {
              if (teacherUnavail.has(teacherId + '-' + day + '-' + cls.shift + '-' + period)) {
                teacherFree = false;
                break;
              }
            }
            if (!teacherFree) continue;

            // Check if teacher is already teaching at this period (from another class in this config or another config)
            const teacherPeriodKey = teacherId + '-' + cls.shift;
            if (!teacherUsedPeriods.has(teacherPeriodKey)) teacherUsedPeriods.set(teacherPeriodKey, new Set());
            if (teacherUsedPeriods.get(teacherPeriodKey)!.has(period)) continue;

            // Also check teacherOccupied for this period
            let teacherBusy = false;
            for (const day of days) {
              if (teacherOccupied.has(teacherId + '-' + day + '-' + cls.shift + '-' + period)) {
                teacherBusy = true;
                break;
              }
            }
            if (teacherBusy) continue;

            // Check time overlap with teacher's other slots
            const mySlot = slotLookup.get(cls.level + '-' + cls.shift + '-' + 1 + '-' + period);
            if (mySlot) {
              let overlap = false;
              for (const day of days) {
                const tSlots = teacherDaySlots.get(teacherId)?.get(day);
                if (tSlots) {
                  for (const ts of tSlots) {
                    if (doTimeSlotsOverlap(mySlot, ts)) {
                      overlap = true;
                      break;
                    }
                  }
                }
                if (overlap) break;
              }
              if (overlap) continue;
            }
          }

          // Check if this period is occupied by a FIXED entry for this class
          let slotFree = true;
          for (const day of days) {
            const slotKey = fsc.classId + '-' + day + '-' + period;
            if (occupied.has(slotKey)) {
              const isFixedOccupying = finalFixedSchedules.some(
                s => s.classId === fsc.classId && s.subjectId !== fixedConfig.subjectId && s.dayOfWeek === day && s.period === period
              );
              if (isFixedOccupying) {
                slotFree = false;
                break;
              }
            }
          }
          if (!slotFree) continue;

          classPeriod = period;
        }

        if (classPeriod === null) {
          console.warn(`Could not assign fixed period for ${fixedConfig.Subject.name} in class ${cls.name}`);
          continue;
        }

        // Mark this period as used for this teacher
        if (teacherId) {
          const teacherPeriodKey = teacherId + '-' + cls.shift;
          if (!teacherUsedPeriods.has(teacherPeriodKey)) teacherUsedPeriods.set(teacherPeriodKey, new Set());
          teacherUsedPeriods.get(teacherPeriodKey)!.add(classPeriod);
        }

        // Remove any non-fixed occupying classes from grid at target period
        for (const day of days) {
          const slotKey = fsc.classId + '-' + day + '-' + classPeriod;
          if (occupied.has(slotKey)) {
            const occSchedule = await prisma.schedule.findFirst({
              where: {
                classId: fsc.classId,
                dayOfWeek: day,
                period: classPeriod,
                isFixed: false,
              }
            });
            if (occSchedule) {
              occupied.delete(slotKey);
              if (occSchedule.teacherId) {
                teacherOccupied.delete(occSchedule.teacherId + '-' + day + '-' + cls.shift + '-' + occSchedule.period);
              }
              displacedScheduleIds.push(occSchedule.id);
            }
          }
        }

        // Place on weekdays according to classesPerWeek
        // MAX 1 class per day for fixed-period subjects
        const weekdaysToPlace = days.slice(0, fixedConfig.classesPerWeek);
        for (const day of weekdaysToPlace) {
          // Check if this class already has this subject on this day (in any period)
          const alreadyOnThisDay = finalFixedSchedules.some(
            s => s.classId === fsc.classId && s.subjectId === fixedConfig.subjectId && s.dayOfWeek === day
          ) || fixedSubjectPlaced.some(
            s => s.classId === fsc.classId && s.subjectId === fixedConfig.subjectId && s.dayOfWeek === day
          );
          if (alreadyOnThisDay) continue;

          // Check if the target period on this day is already occupied by this subject
          const slotKey = fsc.classId + '-' + day + '-' + classPeriod;
          if (occupied.has(slotKey)) continue;

          placeOnGrid(fsc.classId, fixedConfig.subjectId, teacherId, day, classPeriod, cls.shift);
          fixedSubjectPlaced.push({
            classId: fsc.classId,
            subjectId: fixedConfig.subjectId,
            teacherId,
            dayOfWeek: day,
            period: classPeriod,
          });
        }

        // Update DB: set assignedPeriod
        await prisma.fixedSubjectClass.update({
          where: { id: fsc.id },
          data: { assignedPeriod: classPeriod },
        });
      }
    }

    // VERIFICATION PASS: Ensure all fixed subjects are placed on ALL required weekdays at CORRECT period
    for (const fixedConfig of fixedSubjectConfigs) {
      const teacherId = curriculums.find(c => c.subjectId === fixedConfig.subjectId)?.teacherId || null;

      for (const fsc of fixedConfig.FixedSubjectClass) {
        const cls = classMap.get(fsc.classId);
        if (!cls) continue;

        const targetPeriod = fsc.assignedPeriod;
        if (!targetPeriod) continue;

        const weekdaysNeeded = days.slice(0, fixedConfig.classesPerWeek);

        for (const day of weekdaysNeeded) {
          // STEP 1: Remove any entry at WRONG period for this class+subject+day
          const wrongEntries = fixedSubjectPlaced.filter(
            s => s.classId === fsc.classId && s.subjectId === fixedConfig.subjectId && s.dayOfWeek === day && s.period !== targetPeriod
          );
          for (const wrong of wrongEntries) {
            const wrongIdx = fixedSubjectPlaced.indexOf(wrong);
            if (wrongIdx >= 0) fixedSubjectPlaced.splice(wrongIdx, 1);
            const wrongKey = fsc.classId + '-' + day + '-' + wrong.period;
            occupied.delete(wrongKey);
            if (wrong.teacherId) {
              teacherOccupied.delete(wrong.teacherId + '-' + day + '-' + cls.shift + '-' + wrong.period);
            }
          }

          // Also remove from DB if there's a wrong-period entry
          const dbWrongEntries = await prisma.schedule.findMany({
            where: {
              classId: fsc.classId,
              subjectId: fixedConfig.subjectId,
              dayOfWeek: day,
              period: { not: targetPeriod },
            }
          });
          for (const entry of dbWrongEntries) {
            displacedScheduleIds.push(entry.id);
            occupied.delete(fsc.classId + '-' + day + '-' + entry.period);
          }

          // STEP 2: Check if already at CORRECT period
          const atCorrectPeriod = fixedSubjectPlaced.some(
            s => s.classId === fsc.classId && s.subjectId === fixedConfig.subjectId && s.dayOfWeek === day && s.period === targetPeriod
          ) || finalFixedSchedules.some(
            s => s.classId === fsc.classId && s.subjectId === fixedConfig.subjectId && s.dayOfWeek === day && s.period === targetPeriod
          );

          if (atCorrectPeriod) continue;

          // STEP 3: Place at correct period
          const slotKey = fsc.classId + '-' + day + '-' + targetPeriod;
          if (occupied.has(slotKey)) {
            const occSchedule = await prisma.schedule.findFirst({
              where: { classId: fsc.classId, dayOfWeek: day, period: targetPeriod, isFixed: false }
            });
            if (occSchedule) {
              occupied.delete(slotKey);
              if (occSchedule.teacherId) {
                teacherOccupied.delete(occSchedule.teacherId + '-' + day + '-' + cls.shift + '-' + occSchedule.period);
              }
              displacedScheduleIds.push(occSchedule.id);
            }
          }

          if (!occupied.has(slotKey)) {
            placeOnGrid(fsc.classId, fixedConfig.subjectId, teacherId, day, targetPeriod, cls.shift);
            fixedSubjectPlaced.push({
              classId: fsc.classId,
              subjectId: fixedConfig.subjectId,
              teacherId,
              dayOfWeek: day,
              period: targetPeriod,
            });
          }
        }
      }
    }

    // Delete displaced schedules from DB (moved to make room for fixedSubjectConfig)
    if (displacedScheduleIds.length > 0) {
      await prisma.schedule.deleteMany({ where: { id: { in: displacedScheduleIds } } });
    }

    // Build set of class+subject pairs already placed by fixed schedules
    const fixedClassSubjectPairs = new Set<string>();
    for (const s of finalFixedSchedules) {
      fixedClassSubjectPairs.add(s.classId + '-' + s.subjectId);
    }
    for (const fs of fixedSubjectPlaced) {
      fixedClassSubjectPairs.add(fs.classId + '-' + fs.subjectId);
    }

    const toSchedule: ToScheduleItem[] = [];
    for (const curr of curriculums) {
      // Skip aliased subjects (e.g., "Cultura Geral" mapped to "Capela")
      // These are already placed as fixed schedules and should not be redistributed
      if (aliasedSubjectIds.has(curr.subjectId)) continue;

      // Skip fixed-period subjects (e.g., "Bilingue" - same period every day)
      // These are already placed above
      if (fixedSubjectSubjectIds.has(curr.subjectId)) continue;

      // Skip subjects already placed via fixed schedules for this class
      if (fixedClassSubjectPairs.has(curr.classId + '-' + curr.subjectId)) continue;

      let already = 0;
      if (mode === 'REPAIR') already = currentSchedules.filter(s => s.classId === curr.classId && s.subjectId === curr.subjectId).length;
      const needed = curr.classesPerWeek - already;
      for (let i = 0; i < needed; i++) {
        toSchedule.push({
          classId: curr.classId,
          subjectId: curr.subjectId,
          teacherId: curr.teacherId,
          shift: curr.Class.shift,
          level: curr.Class.level,
          consecutiveCount: 0,
        });
      }
    }

    const placeItems = (
      items: { classId: string; subjectId: string; teacherId: string | null; shift: string; level: string; consecutiveCount?: number }[],
      strategy: string
    ): { placed: PlacedSlot[]; assigned: number } => {
      const occupiedLocal = new Set(occupied);
      const teacherOccupiedLocal = new Set(teacherOccupied);
      const teacherUnavailLocal = new Set(teacherUnavail);
      const classDayCountLocal = new Map(classDayCount);
      const classSubjectDayCountLocal = new Map(classSubjectDayCount);
      const teacherDaySlotsLocal = new Map(teacherDaySlots);
      const classDaySubjectsLocal = new Map(classDaySubjects);

      const placeOnGridLocal = (cid: string, sid: string, tid: string | null, day: number, period: number, shift: string) => {
        occupiedLocal.add(cid + '-' + day + '-' + period);
        if (tid) {
          teacherOccupiedLocal.add(tid + '-' + day + '-' + shift + '-' + period);
          if (!teacherDaySlotsLocal.has(tid)) teacherDaySlotsLocal.set(tid, new Map());
          const dm = teacherDaySlotsLocal.get(tid)!;
          if (!dm.has(day)) dm.set(day, []);
          const level = classMap.get(cid)?.level || 'FUND2';
          const slot = slotLookup.get(level + '-' + shift + '-' + day + '-' + period);
          if (slot) dm.get(day)!.push(slot);
        }
        if (!classDayCountLocal.has(cid)) classDayCountLocal.set(cid, new Map());
        const dc = classDayCountLocal.get(cid)!;
        dc.set(day, (dc.get(day) || 0) + 1);
        if (!classSubjectDayCountLocal.has(cid)) classSubjectDayCountLocal.set(cid, new Map());
        const csm = classSubjectDayCountLocal.get(cid)!;
        if (!csm.has(sid)) csm.set(sid, new Map());
        csm.get(sid)!.set(day, (csm.get(sid)!.get(day) || 0) + 1);
        if (!classDaySubjectsLocal.has(cid)) classDaySubjectsLocal.set(cid, new Map());
        const cds = classDaySubjectsLocal.get(cid)!;
        if (!cds.has(day)) cds.set(day, new Map());
        const subjMap = cds.get(day)!;
        subjMap.set(sid, (subjMap.get(sid) || 0) + 1);
      };

      const canPlaceLocal = (cid: string, sid: string, tid: string | null, day: number, period: number, shift: string, level: string): boolean => {
        if (occupiedLocal.has(cid + '-' + day + '-' + period)) return false;
        const maxP = getMaxPeriods(level, day, shift, config);
        if ((classDayCountLocal.get(cid)?.get(day) || 0) >= maxP) return false;
        if ((classSubjectDayCountLocal.get(cid)?.get(sid)?.get(day) || 0) >= 2) return false;
        if (!tid) return true;
        if (teacherUnavailLocal.has(tid + '-' + day + '-' + shift + '-' + period)) return false;
        if (teacherOccupiedLocal.has(tid + '-' + day + '-' + shift + '-' + period)) return false;
        const mySlot = slotLookup.get(level + '-' + shift + '-' + day + '-' + period);
        if (!mySlot) return true;
        const tSlots = teacherDaySlotsLocal.get(tid)?.get(day);
        if (!tSlots || tSlots.length === 0) return true;
        for (const ts of tSlots) {
          if (doTimeSlotsOverlap(mySlot, ts)) return false;
        }
        return true;
      };

      const canPlaceDoubleLocal = (cid: string, sid: string, day: number): boolean => {
        if (!config.doublePeriods.enabled) return true;
        const maxConsecutive = config.doublePeriods.maxConsecutive;
        if (maxConsecutive >= 99) return true;
        const existingCount = classDaySubjectsLocal.get(cid)?.get(day)?.get(sid) || 0;
        if (existingCount < maxConsecutive) return true;
        return false;
      };

      const countGapsForClass = (cid: string, day: number, maxP: number, shift: string, overridePeriod?: number, overrideHas?: boolean): number => {
        let gaps = 0;
        let prevFilled = false;
        for (let p = 1; p <= maxP; p++) {
          let filled: boolean;
          if (overridePeriod !== undefined && p === overridePeriod) {
            filled = overrideHas !== undefined ? overrideHas : true;
          } else {
            filled = occupiedLocal.has(cid + '-' + day + '-' + p);
          }
          if (filled) {
            if (prevFilled === false && p > 1) {
              let hasPrevFilled = false;
              for (let q = 1; q < p; q++) {
                if (occupiedLocal.has(cid + '-' + day + '-' + q)) { hasPrevFilled = true; break; }
              }
              if (hasPrevFilled) gaps++;
            }
            prevFilled = true;
          } else {
            prevFilled = false;
          }
        }
        return gaps;
      };

      const wouldCreateGap = (cid: string, day: number, period: number, shift: string): boolean => {
        const maxP = getMaxPeriods(classMap.get(cid)?.level || 'FUND2', day, shift, config);
        const gapsBefore = countGapsForClass(cid, day, maxP, shift);
        const gapsAfter = countGapsForClass(cid, day, maxP, shift, period, true);
        return gapsAfter > gapsBefore;
      };

      const fillsGap = (cid: string, day: number, period: number, shift: string): boolean => {
        const maxP = getMaxPeriods(classMap.get(cid)?.level || 'FUND2', day, shift, config);
        const gapsBefore = countGapsForClass(cid, day, maxP, shift);
        const gapsAfter = countGapsForClass(cid, day, maxP, shift, period, true);
        return gapsAfter < gapsBefore;
      };

      const sortedItems = sortItems(items, strategy);
      const days = [1, 2, 3, 4, 5];
      const periods = [1, 2, 3, 4, 5, 6];
      const placed: PlacedSlot[] = [];

      for (const curr of sortedItems) {
        const existingDays = classSubjectDayCountLocal.get(curr.classId)?.get(curr.subjectId);
        const candidates: { day: number; period: number; score: number }[] = [];

        for (const day of days) {
          if ((classDayCountLocal.get(curr.classId)?.get(day) || 0) >= getMaxPeriods(curr.level, day, curr.shift, config)) continue;
          for (const period of periods) {
            if (canPlaceLocal(curr.classId, curr.subjectId, curr.teacherId, day, period, curr.shift, curr.level)) {
              if (!canPlaceDoubleLocal(curr.classId, curr.subjectId, day)) continue;
              let score = 0;
              if (existingDays?.has(day)) score += 10;
              score -= (classDayCountLocal.get(curr.classId)?.get(day) || 0) * 0.5;
              if (config.advanced.preference === 'MORNING' && curr.shift === 'MORNING') score += 2;
              if (config.advanced.preference === 'AFTERNOON' && curr.shift === 'AFTERNOON') score += 2;
              if (wouldCreateGap(curr.classId, day, period, curr.shift)) score -= 150;
              if (fillsGap(curr.classId, day, period, curr.shift)) score += 50;
              candidates.push({ day, period, score });
            }
          }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
          const best = candidates[0];
          placeOnGridLocal(curr.classId, curr.subjectId, curr.teacherId, best.day, best.period, curr.shift);
          placed.push({
            classId: curr.classId,
            subjectId: curr.subjectId,
            teacherId: curr.teacherId,
            dayOfWeek: best.day,
            period: best.period,
            shift: curr.shift,
            level: curr.level,
          });
        }
      }

      return { placed, assigned: placed.length };
    };

    const backtrackResult = runBacktracker(placeItems, toSchedule, config);

    // ── SINCRONIZAR ESTADO GLOBAL COM RESULTADO DO BACKTRACKER ──
    // O backtracker usa placeOnGridLocal (cópias locais), mas o fill loop
    // precisa do estado global atualizado
    for (const slot of backtrackResult.placed) {
      occupied.add(slot.classId + '-' + slot.dayOfWeek + '-' + slot.period);
      if (slot.teacherId) {
        const cls = classMap.get(slot.classId);
        const shift = cls?.shift || slot.shift;
        teacherOccupied.add(slot.teacherId + '-' + slot.dayOfWeek + '-' + shift + '-' + slot.period);
        if (!teacherDaySlots.has(slot.teacherId)) teacherDaySlots.set(slot.teacherId, new Map());
        const dm = teacherDaySlots.get(slot.teacherId)!;
        if (!dm.has(slot.dayOfWeek)) dm.set(slot.dayOfWeek, []);
        const mySlot = slotLookup.get(slot.level + '-' + shift + '-' + slot.dayOfWeek + '-' + slot.period);
        if (mySlot && !dm.get(slot.dayOfWeek)!.some(s => s.startTime === mySlot.startTime && s.endTime === mySlot.endTime)) {
          dm.get(slot.dayOfWeek)!.push(mySlot);
        }
      }
    }

    // ── LOOP DE PREENCHIMENTO DE AULAS FALTANTES ──────────────
    const classDayCountPlaced = new Map<string, Map<number, number>>();
    for (const s of backtrackResult.placed) {
      if (!classDayCountPlaced.has(s.classId)) classDayCountPlaced.set(s.classId, new Map());
      const dm = classDayCountPlaced.get(s.classId)!;
      dm.set(s.dayOfWeek, (dm.get(s.dayOfWeek) || 0) + 1);
    }

    const placedClassSubject = new Set<string>();
    for (const s of backtrackResult.placed) placedClassSubject.add(s.classId + '-' + s.subjectId);
    const unplacedItems = toSchedule.filter(item => !placedClassSubject.has(item.classId + '-' + item.subjectId));

    let fillIterations = 0;
    let placedNew = true;
    while (placedNew && fillIterations < 20 && unplacedItems.length > 0) {
      placedNew = false;
      fillIterations++;

      for (let i = unplacedItems.length - 1; i >= 0; i--) {
        const item = unplacedItems[i];
        const cls = classMap.get(item.classId);
        if (!cls) { unplacedItems.splice(i, 1); continue; }
        const maxP = getMaxPeriods(cls.level, 1, cls.shift, config);

        let itemPlaced = false;

        for (const day of [1, 2, 3, 4, 5]) {
          if (itemPlaced) break;
          const dayCount = classDayCountPlaced.get(item.classId)?.get(day) || 0;
          if (dayCount >= maxP) continue;

          for (let period = 1; period <= maxP; period++) {
            if (occupied.has(item.classId + '-' + day + '-' + period)) continue;
            if (item.teacherId) {
              if (teacherUnavail.has(item.teacherId + '-' + day + '-' + cls.shift + '-' + period)) continue;
              if (teacherOccupied.has(item.teacherId + '-' + day + '-' + cls.shift + '-' + period)) continue;
              const mySlot = slotLookup.get(cls.level + '-' + cls.shift + '-' + day + '-' + period);
              if (mySlot) {
                const tSlots = teacherDaySlots.get(item.teacherId)?.get(day);
                if (tSlots) {
                  let overlap = false;
                  for (const ts of tSlots) {
                    if (doTimeSlotsOverlap(mySlot, ts)) { overlap = true; break; }
                  }
                  if (overlap) continue;
                }
              }
            }

            placeOnGrid(item.classId, item.subjectId, item.teacherId, day, period, cls.shift);
            backtrackResult.placed.push({
              classId: item.classId,
              subjectId: item.subjectId,
              teacherId: item.teacherId,
              dayOfWeek: day,
              period,
              shift: cls.shift,
              level: cls.level,
            });
            if (!classDayCountPlaced.has(item.classId)) classDayCountPlaced.set(item.classId, new Map());
            const dm = classDayCountPlaced.get(item.classId)!;
            dm.set(day, (dm.get(day) || 0) + 1);
            unplacedItems.splice(i, 1);
            placedNew = true;
            itemPlaced = true;
            break;
          }
        }
      }
    }

    const countGaps = (periods: Set<number>, maxP: number): number => {
      const sorted = Array.from(periods).sort((a, b) => a - b);
      let gaps = 0;
      for (let i = 1; i < sorted.length; i++) {
        gaps += sorted[i] - sorted[i - 1] - 1;
      }
      return gaps;
    };

    const eliminateGaps = (placed: PlacedSlot[]): PlacedSlot[] => {
      const result = [...placed];
      const classDayPeriods = new Map<string, Map<number, Set<number>>>();
      for (const slot of result) {
        if (!classDayPeriods.has(slot.classId)) classDayPeriods.set(slot.classId, new Map());
        const dayMap = classDayPeriods.get(slot.classId)!;
        if (!dayMap.has(slot.dayOfWeek)) dayMap.set(slot.dayOfWeek, new Set());
        dayMap.get(slot.dayOfWeek)!.add(slot.period);
      }

      let totalIterations = 0;
      let madeImprovement = true;
      while (madeImprovement && totalIterations < 500) {
        madeImprovement = false;
        totalIterations++;

        // Sort class-days by gap count (most gaps first)
        const entries: { classId: string; day: number; periods: Set<number>; gaps: number }[] = [];
        for (const [classId, dayMap] of classDayPeriods) {
          const cls = classMap.get(classId);
          if (!cls) continue;
          for (const [day, periods] of dayMap) {
            const maxP = getMaxPeriods(cls.level, day, cls.shift, config);
            const gaps = countGaps(periods, maxP);
            if (gaps > 0) entries.push({ classId, day, periods, gaps });
          }
        }
        entries.sort((a, b) => b.gaps - a.gaps);

        for (const entry of entries) {
          const { classId, day, periods } = entry;
          const cls = classMap.get(classId);
          if (!cls) continue;
          const maxP = getMaxPeriods(cls.level, day, cls.shift, config);
          const gapsBefore = countGaps(periods, maxP);
          if (gapsBefore === 0) continue;

          let bestMove: { slotIdx: number; newPeriod: number; gapsAfter: number } | null = null;

          for (const slotIdx of result.keys()) {
            const slot = result[slotIdx];
            if (slot.classId !== classId || slot.dayOfWeek !== day) continue;

            const oldPeriod = slot.period;
            const oldPeriods = new Set(periods);
            oldPeriods.delete(oldPeriod);

            for (let targetPeriod = 1; targetPeriod <= maxP; targetPeriod++) {
              if (targetPeriod === oldPeriod) continue;
              if (periods.has(targetPeriod)) continue;

              const testPeriods = new Set(oldPeriods);
              testPeriods.add(targetPeriod);
              const gapsAfter = countGaps(testPeriods, maxP);

              if (gapsAfter >= gapsBefore) continue;

              const targetKey = classId + '-' + day + '-' + targetPeriod;
              if (occupied.has(targetKey)) continue;

              if (slot.teacherId) {
                if (teacherOccupied.has(slot.teacherId + '-' + day + '-' + cls.shift + '-' + targetPeriod)) continue;
                if (teacherUnavail.has(slot.teacherId + '-' + day + '-' + cls.shift + '-' + targetPeriod)) continue;
                // Check time overlap with teacher's other slots
                const mySlot = slotLookup.get(cls.level + '-' + cls.shift + '-' + day + '-' + targetPeriod);
                if (mySlot) {
                  const tSlots = teacherDaySlots.get(slot.teacherId)?.get(day);
                  if (tSlots) {
                    let overlap = false;
                    for (const ts of tSlots) {
                      if (doTimeSlotsOverlap(mySlot, ts)) { overlap = true; break; }
                    }
                    if (overlap) continue;
                  }
                }
              }

              if (!bestMove || gapsAfter < bestMove.gapsAfter) {
                bestMove = { slotIdx, newPeriod: targetPeriod, gapsAfter };
              }
            }
          }

          if (bestMove) {
            const slot = result[bestMove.slotIdx];
            const oldPeriod = slot.period;

            occupied.delete(classId + '-' + day + '-' + oldPeriod);
            occupied.add(classId + '-' + day + '-' + bestMove.newPeriod);
            if (slot.teacherId) {
              teacherOccupied.delete(slot.teacherId + '-' + day + '-' + cls.shift + '-' + oldPeriod);
              teacherOccupied.add(slot.teacherId + '-' + day + '-' + cls.shift + '-' + bestMove.newPeriod);
              // Update teacherDaySlots
              const tDaySlots = teacherDaySlots.get(slot.teacherId)?.get(day);
              if (tDaySlots) {
                const oldSlotDef = slotLookup.get(cls.level + '-' + cls.shift + '-' + day + '-' + oldPeriod);
                const newSlotDef = slotLookup.get(cls.level + '-' + cls.shift + '-' + day + '-' + bestMove.newPeriod);
                if (oldSlotDef) {
                  const idx = tDaySlots.indexOf(oldSlotDef);
                  if (idx >= 0) {
                    if (newSlotDef) tDaySlots[idx] = newSlotDef;
                    else tDaySlots.splice(idx, 1);
                  }
                } else if (newSlotDef) {
                  tDaySlots.push(newSlotDef);
                }
              }
            }

            periods.delete(oldPeriod);
            periods.add(bestMove.newPeriod);
            result[bestMove.slotIdx] = { ...slot, period: bestMove.newPeriod };
            madeImprovement = true;
          }
        }
      }
      return result;
    };

    backtrackResult.placed = eliminateGaps(backtrackResult.placed);

    const originalSet = new Set<string>();
    for (const s of finalFixedSchedules) {
      const c = classMap.get(s.classId);
      const shift = c?.shift || 'MORNING';
      originalSet.add(s.classId + '-' + s.dayOfWeek + '-' + s.period);
    }
    if (mode === 'REPAIR') for (const s of currentSchedules) originalSet.add(s.classId + '-' + s.dayOfWeek + '-' + s.period);

    const toSave = backtrackResult.placed.filter(a => !originalSet.has(a.classId + '-' + a.dayOfWeek + '-' + a.period));

    const allToSave = [
      ...toSave.map(a => ({
        classId: a.classId,
        subjectId: a.subjectId,
        teacherId: a.teacherId,
        dayOfWeek: a.dayOfWeek,
        period: a.period,
        isFixed: false,
      })),
      ...fixedSubjectPlaced.filter(a => !originalSet.has(a.classId + '-' + a.dayOfWeek + '-' + a.period)).map(a => ({
        classId: a.classId,
        subjectId: a.subjectId,
        teacherId: a.teacherId,
        dayOfWeek: a.dayOfWeek,
        period: a.period,
        isFixed: true,
      })),
    ];

    // Remove entries that exceed max periods per day
    const filteredToSave = [];
    for (const entry of allToSave) {
      const cls = classMap.get(entry.classId);
      if (!cls) { filteredToSave.push(entry); continue; }
      const maxP = getMaxPeriods(cls.level, entry.dayOfWeek, cls.shift, config);
      if (entry.period <= maxP) {
        filteredToSave.push(entry);
      }
    }

    // Deduplicate: keep only one entry per class+day+period
    const dedupedToSave = [];
    const seenSlots = new Set<string>();
    for (const entry of filteredToSave) {
      const key = entry.classId + '-' + entry.dayOfWeek + '-' + entry.period;
      if (!seenSlots.has(key)) {
        seenSlots.add(key);
        dedupedToSave.push(entry);
      }
    }

    if (dedupedToSave.length > 0) {
      await prisma.schedule.createMany({
        data: dedupedToSave,
      });
    }

    // Cleanup: Remove any extra fixedSubject entries beyond what's configured
    // For each fixedSubjectConfig, ensure only the expected number of entries exist per class
    for (const fixedConfig of fixedSubjectConfigs) {
      for (const fsc of fixedConfig.FixedSubjectClass) {
        // Count all schedule entries for this class+subject
        const allEntries = await prisma.schedule.findMany({
          where: { classId: fsc.classId, subjectId: fixedConfig.subjectId },
          orderBy: { dayOfWeek: 'asc' },
        });

        // Fixed entries (from fixedSchedules) should always be kept
        const fixedEntries = allEntries.filter(e => e.isFixed);
        const nonFixedEntries = allEntries.filter(e => !e.isFixed);

        // If we have more non-fixed entries than needed, remove extras
        const maxNonFixed = Math.max(0, fixedConfig.classesPerWeek - fixedEntries.length);
        if (nonFixedEntries.length > maxNonFixed) {
          const toRemove = nonFixedEntries.slice(maxNonFixed);
          await prisma.schedule.deleteMany({
            where: {
              id: { in: toRemove.map(e => e.id) },
            },
          });
        }
      }
    }

    return {
      success: toSave.length === toSchedule.length,
      assigned: toSave.length + fixedSubjectPlaced.length,
      total: toSchedule.length + fixedSubjectPlaced.length,
      timeout: false,
      score: backtrackResult.score,
      config,
    };

  } catch (e: any) {
    console.error('Engine error:', e);
    return { success: false, assigned: 0, total: 0, timeout: false, error: e.message, config };
  }
}
