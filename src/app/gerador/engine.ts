import prisma from '@/lib/prisma';

function timeToMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function doTimeSlotsOverlap(ts1: any, ts2: any) {
  if (!ts1 || !ts2) return false;
  return Math.max(timeToMin(ts1.startTime), timeToMin(ts2.startTime)) < Math.min(timeToMin(ts1.endTime), timeToMin(ts2.endTime));
}

export async function runGenerator(mode: 'REPAIR' | 'SCRATCH') {
  // 1. Fetch all data
  const classes = await prisma.class.findMany();
  const curriculums = await prisma.curriculum.findMany({ include: { class: true } });
  const timeSlots = await prisma.timeSlot.findMany();
  const availabilities = await prisma.availability.findMany();
  const fixedSchedules = await prisma.schedule.findMany({ where: { isFixed: true } });
  const currentSchedules = await prisma.schedule.findMany({ where: { isFixed: false } });

  // If SCRATCH, we clear all non-fixed schedules
  if (mode === 'SCRATCH') {
    await prisma.schedule.deleteMany({ where: { isFixed: false } });
  }

  // 2. Determine what needs to be scheduled
  const toSchedule: { classId: string, subjectId: string, teacherId: string | null, shift: string, level: string }[] = [];
  
  for (const curr of curriculums) {
    let alreadyScheduled = 0;
    if (mode === 'REPAIR') {
      alreadyScheduled = currentSchedules.filter(s => s.classId === curr.classId && s.subjectId === curr.subjectId).length;
    }
    const needed = curr.classesPerWeek - alreadyScheduled;
    for (let i = 0; i < needed; i++) {
      toSchedule.push({ 
        classId: curr.classId, 
        subjectId: curr.subjectId, 
        teacherId: curr.teacherId,
        shift: curr.class.shift,
        level: curr.class.level
      });
    }
  }

  // 3. Current assignments state
  const assignments: any[] = [];
  if (mode === 'REPAIR') {
    currentSchedules.forEach(s => assignments.push(s));
  }
  fixedSchedules.forEach(s => assignments.push(s));
  
  const days = [1, 2, 3, 4, 5];
  const periods = [1, 2, 3, 4, 5, 6];

  function getPeriods(shift: string) {
    return periods;
  }

  function normalizePeriod(period: number, shift: string): number {
    if (shift === 'AFTERNOON' && period > 6) return period - 6;
    return period;
  }

  function denormalizePeriod(period: number, shift: string): number {
    if (shift === 'AFTERNOON') return period + 6;
    return period;
  }

  function isValid(teacherId: string | null, classId: string, day: number, period: number, level: string, shift: string) {
    // Check class conflict (use denormalized period for comparison with existing assignments)
    const denormPeriod = denormalizePeriod(period, shift);
    if (assignments.some(a => a.classId === classId && a.dayOfWeek === day && a.period === denormPeriod)) {
      return false;
    }

    if (!teacherId) return true;

    // Check teacher availability restriction (availability uses denormalized periods 1-12)
    const isUnavail = availabilities.some(a => a.teacherId === teacherId && a.dayOfWeek === day && a.period === denormPeriod && !a.isAvailable);
    if (isUnavail) return false;

    // Check teacher time overlap - use normalized period for TimeSlot lookup
    const normPeriod = normalizePeriod(period, shift);
    const mySlot = timeSlots.find((ts: any) => ts.level === level && ts.shift === shift && ts.dayOfWeek === day && ts.period === normPeriod);
    if (!mySlot) return true;

    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId && a.dayOfWeek === day);
    for (const ta of teacherAssignments) {
      const taClass = classes.find(c => c.id === ta.classId);
      if (!taClass) continue;
      const taNormPeriod = normalizePeriod(ta.period, taClass.shift);
      const taSlot = timeSlots.find((ts: any) => ts.level === taClass.level && ts.shift === taClass.shift && ts.dayOfWeek === day && ts.period === taNormPeriod);
      if (taSlot) {
        if (doTimeSlotsOverlap(mySlot, taSlot)) {
          return false;
        }
      } else {
        if (ta.period === denormPeriod) return false;
      }
    }

    return true;
  }

  // Pre-compute teacher loads for sorting
  const teacherLoads = new Map<string, number>();
  for (const item of toSchedule) {
    if (item.teacherId) {
      teacherLoads.set(item.teacherId, (teacherLoads.get(item.teacherId) || 0) + 1);
    }
  }

  // Sort `toSchedule`: most constrained first (teacher with most classes, then classes with most subjects)
  const classLoads = new Map<string, number>();
  for (const item of toSchedule) {
    classLoads.set(item.classId, (classLoads.get(item.classId) || 0) + 1);
  }

  toSchedule.sort((a, b) => {
    const aTeacherLoad = a.teacherId ? teacherLoads.get(a.teacherId) || 0 : 0;
    const bTeacherLoad = b.teacherId ? teacherLoads.get(b.teacherId) || 0 : 0;
    if (aTeacherLoad !== bTeacherLoad) return bTeacherLoad - aTeacherLoad;
    const aClassLoad = classLoads.get(a.classId) || 0;
    const bClassLoad = classLoads.get(b.classId) || 0;
    return bClassLoad - aClassLoad;
  });

  let nodesExplored = 0;
  const MAX_NODES = 500000; // Increased limit
  let bestAssignments: any[] = [];
  let bestAssigned = 0;

  function backtrack(index: number): boolean {
    if (index === toSchedule.length) return true; // All scheduled
    if (nodesExplored++ > MAX_NODES) return false;

    // Track best partial solution
    const currentAssigned = assignments.filter(a => typeof a.id === 'string' && a.id.startsWith('temp-')).length;
    if (currentAssigned > bestAssigned) {
      bestAssigned = currentAssigned;
      bestAssignments = assignments.filter(a => typeof a.id === 'string' && a.id.startsWith('temp-')).map(a => ({...a}));
    }

    const curr = toSchedule[index];
    const periodsList = getPeriods(curr.shift);

    // Heuristic: try to group same subject on same day (double classes)
    const existingDays = assignments
      .filter(a => a.classId === curr.classId && a.subjectId === curr.subjectId)
      .map(a => a.dayOfWeek);
    
    // Day order: prefer days that already have this subject (for double classes), then spread
    const sortedDays = [...days].sort((a, b) => {
      const aHas = existingDays.includes(a);
      const bHas = existingDays.includes(b);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      // Secondary: prefer days with fewer total classes for this class (spread load)
      const aCount = assignments.filter(x => x.classId === curr.classId && x.dayOfWeek === a).length;
      const bCount = assignments.filter(x => x.classId === curr.classId && x.dayOfWeek === b).length;
      return aCount - bCount;
    });

    // Period order: sequential (1,2,3...) to pack schedule
    for (const day of sortedDays) {
      for (const period of periodsList) {
        if (isValid(curr.teacherId, curr.classId, day, period, curr.level, curr.shift)) {
          // Check max 2 classes of same subject per day
          const classesThisDay = assignments.filter(a => a.classId === curr.classId && a.subjectId === curr.subjectId && a.dayOfWeek === day).length;
          if (classesThisDay >= 2) continue;

          // Make assignment
          const denormPeriod = denormalizePeriod(period, curr.shift);
          const newAssignment = {
            id: 'temp-' + nodesExplored,
            classId: curr.classId,
            subjectId: curr.subjectId,
            teacherId: curr.teacherId,
            dayOfWeek: day,
            period: denormPeriod,
            isFixed: false
          };
          assignments.push(newAssignment);

          if (backtrack(index + 1)) return true;

          // Undo assignment
          assignments.pop();
        }
      }
    }

    return false; // Backtrack
  }

  const success = backtrack(0);

  // If backtracking failed or timed out, use best partial solution
  let finalAssignments = assignments.filter(a => typeof a.id === 'string' && a.id.startsWith('temp-'));
  if (!success && bestAssignments.length > finalAssignments.length) {
    finalAssignments = bestAssignments;
  }

  // 4. Save to DB
  if (finalAssignments.length > 0) {
    await prisma.schedule.createMany({
      data: finalAssignments.map(a => ({
        classId: a.classId,
        subjectId: a.subjectId,
        teacherId: a.teacherId,
        dayOfWeek: a.dayOfWeek,
        period: a.period,
        isFixed: false
      }))
    });
  }

  return { 
    success: success || finalAssignments.length > 0, 
    assigned: finalAssignments.length, 
    total: toSchedule.length, 
    timeout: nodesExplored > MAX_NODES 
  };
}