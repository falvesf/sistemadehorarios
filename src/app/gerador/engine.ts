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
  const morningPeriods = [1, 2, 3, 4, 5, 6];
  const afternoonPeriods = [7, 8, 9, 10, 11, 12];

  function getPeriods(shift: string) {
    return shift === 'MORNING' ? morningPeriods : afternoonPeriods;
  }

  function isValid(teacherId: string | null, classId: string, day: number, period: number, level: string, shift: string) {
    // Check class conflict
    if (assignments.some(a => a.classId === classId && a.dayOfWeek === day && a.period === period)) {
      return false;
    }

    if (!teacherId) return true; // If no teacher assigned yet, any slot for the class is fine

    // Check teacher availability restriction
    const isUnavail = availabilities.some(a => a.teacherId === teacherId && a.dayOfWeek === day && a.period === period && !a.isAvailable);
    if (isUnavail) return false;

    // Check teacher time overlap
    const mySlot = timeSlots.find((ts: any) => ts.level === level && ts.shift === shift && ts.dayOfWeek === day && ts.period === period);
    if (!mySlot) return true; // fallback if no timeslot defined

    const teacherAssignments = assignments.filter(a => a.teacherId === teacherId && a.dayOfWeek === day);
    for (const ta of teacherAssignments) {
      // Find the timeslot for this assignment
      const taClass = classes.find(c => c.id === ta.classId);
      if (!taClass) continue;
      const taSlot = timeSlots.find((ts: any) => ts.level === taClass.level && ts.shift === taClass.shift && ts.dayOfWeek === day && ts.period === ta.period);
      if (taSlot) {
        if (doTimeSlotsOverlap(mySlot, taSlot)) {
          return false;
        }
      } else {
        // Fallback: if no timeslot, just check if exact same period
        if (ta.period === period) return false;
      }
    }

    return true;
  }

  let nodesExplored = 0;
  const MAX_NODES = 50000; // Fail-safe timeout

  function backtrack(index: number): boolean {
    if (index === toSchedule.length) return true; // All scheduled
    if (nodesExplored++ > MAX_NODES) return false;

    const curr = toSchedule[index];
    const periods = getPeriods(curr.shift);

    // Heuristic: try to group same subject on same day (double classes)
    const existingDays = assignments.filter(a => a.classId === curr.classId && a.subjectId === curr.subjectId).map(a => a.dayOfWeek);
    
    const sortedDays = [...days].sort((a, b) => {
      const aHas = existingDays.includes(a);
      const bHas = existingDays.includes(b);
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return 0;
    });

    for (const day of sortedDays) {
      for (const period of periods) {
        if (isValid(curr.teacherId, curr.classId, day, period, curr.level, curr.shift)) {
          // Check max 2 classes of same subject per day
          const classesThisDay = assignments.filter(a => a.classId === curr.classId && a.subjectId === curr.subjectId && a.dayOfWeek === day).length;
          if (classesThisDay >= 2) continue;

          // Make assignment
          const newAssignment = {
            id: 'temp-' + nodesExplored,
            classId: curr.classId,
            subjectId: curr.subjectId,
            teacherId: curr.teacherId,
            dayOfWeek: day,
            period: period,
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

  // Sort `toSchedule` to put constrained items first
  toSchedule.sort((a, b) => {
    const aCount = toSchedule.filter(t => t.teacherId === a.teacherId).length;
    const bCount = toSchedule.filter(t => t.teacherId === b.teacherId).length;
    return bCount - aCount;
  });

  const success = backtrack(0);

  // 4. Save to DB
  const newSchedules = assignments.filter(a => typeof a.id === 'string' && a.id.startsWith('temp-'));
  
  if (newSchedules.length > 0) {
    await prisma.schedule.createMany({
      data: newSchedules.map(a => ({
        classId: a.classId,
        subjectId: a.subjectId,
        teacherId: a.teacherId,
        dayOfWeek: a.dayOfWeek,
        period: a.period,
        isFixed: false
      }))
    });
  }

  return { success, assigned: newSchedules.length, total: toSchedule.length, timeout: nodesExplored > MAX_NODES };
}
