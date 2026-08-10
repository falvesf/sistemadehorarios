import prisma from '@/lib/prisma';

function maxPeriods(level: string): number {
  if (level === 'INFANTIL' || level === 'FUND1') return 5;
  return 6;
}

function timeToMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function doTimeSlotsOverlap(ts1: { startTime: string; endTime: string }, ts2: { startTime: string; endTime: string }) {
  return Math.max(timeToMin(ts1.startTime), timeToMin(ts2.startTime)) < Math.min(timeToMin(ts1.endTime), timeToMin(ts2.endTime));
}

export async function runGenerator(mode: 'REPAIR' | 'SCRATCH') {
  try {
    const classes = await prisma.class.findMany();
    const curriculums = await prisma.curriculum.findMany({ include: { class: true } });
    const timeSlots = await prisma.timeSlot.findMany();
    const availabilities = await prisma.availability.findMany();
    const fixedSchedules = await prisma.schedule.findMany({ where: { isFixed: true } });
    const currentSchedules = await prisma.schedule.findMany({ where: { isFixed: false } });

    if (mode === 'SCRATCH') {
      await prisma.schedule.deleteMany({ where: { isFixed: false } });
    }

    const classMap = new Map(classes.map(c => [c.id, c]));

    const slotLookup = new Map<string, { startTime: string; endTime: string }>();
    for (const ts of timeSlots) {
      slotLookup.set(`${ts.level}-${ts.shift}-${ts.dayOfWeek}-${ts.period}`, ts);
    }

    const classOccupied = new Map<string, Set<string>>();
    const teacherDayPeriods = new Map<string, Map<number, Set<number>>>();
    const teacherUnavailable = new Map<string, Map<number, Set<number>>>();
    const classDayCount = new Map<string, Map<number, number>>();
    const classSubjectDayCount = new Map<string, Map<string, Map<number, number>>>();

    function norm(p: number, shift: string) { return shift === 'AFTERNOON' && p > 6 ? p - 6 : p; }
    function denorm(p: number, shift: string) { return shift === 'AFTERNOON' ? p + 6 : p; }

    function addAssign(cid: string, sid: string, tid: string | null, day: number, dp: number, shift: string) {
      if (!classOccupied.has(cid)) classOccupied.set(cid, new Set());
      classOccupied.get(cid)!.add(`${day}-${dp}`);

      if (tid) {
        if (!teacherDayPeriods.has(tid)) teacherDayPeriods.set(tid, new Map());
        const dm = teacherDayPeriods.get(tid)!;
        if (!dm.has(day)) dm.set(day, new Set());
        dm.get(day)!.add(norm(dp, shift));
      }

      if (!classDayCount.has(cid)) classDayCount.set(cid, new Map());
      const dc = classDayCount.get(cid)!;
      dc.set(day, (dc.get(day) || 0) + 1);

      if (!classSubjectDayCount.has(cid)) classSubjectDayCount.set(cid, new Map());
      const csm = classSubjectDayCount.get(cid)!;
      if (!csm.has(sid)) csm.set(sid, new Map());
      csm.get(sid)!.set(day, (csm.get(sid)!.get(day) || 0) + 1);
    }

    function removeAssign(cid: string, sid: string, tid: string | null, day: number, dp: number, shift: string) {
      classOccupied.get(cid)?.delete(`${day}-${dp}`);
      if (tid) teacherDayPeriods.get(tid)?.get(day)?.delete(norm(dp, shift));

      const dc = classDayCount.get(cid);
      if (dc) { const p = dc.get(day) || 0; p <= 1 ? dc.delete(day) : dc.set(day, p - 1); }

      const csm = classSubjectDayCount.get(cid)?.get(sid);
      if (csm) { const p = csm.get(day) || 0; p <= 1 ? csm.delete(day) : csm.set(day, p - 1); }
    }

    function loadExisting(s: any) {
      const c = classMap.get(s.classId);
      if (c) addAssign(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
    }

    if (mode === 'REPAIR') currentSchedules.forEach(loadExisting);
    fixedSchedules.forEach(loadExisting);

    for (const a of availabilities) {
      if (!a.isAvailable) {
        if (!teacherUnavailable.has(a.teacherId)) teacherUnavailable.set(a.teacherId, new Map());
        const dm = teacherUnavailable.get(a.teacherId)!;
        if (!dm.has(a.dayOfWeek)) dm.set(a.dayOfWeek, new Set());
        dm.get(a.dayOfWeek)!.add(a.period);
      }
    }

    // Build toSchedule
    const toSchedule: { classId: string; subjectId: string; teacherId: string | null; shift: string; level: string }[] = [];
    for (const curr of curriculums) {
      let already = 0;
      if (mode === 'REPAIR') already = currentSchedules.filter(s => s.classId === curr.classId && s.subjectId === curr.subjectId).length;
      const needed = curr.classesPerWeek - already;
      for (let i = 0; i < needed; i++) {
        toSchedule.push({ classId: curr.classId, subjectId: curr.subjectId, teacherId: curr.teacherId, shift: curr.class.shift, level: curr.class.level });
      }
    }

    // Sort: most constrained teachers first
    const teacherLoads = new Map<string, number>();
    for (const t of toSchedule) { if (t.teacherId) teacherLoads.set(t.teacherId, (teacherLoads.get(t.teacherId) || 0) + 1); }
    toSchedule.sort((a, b) => (teacherLoads.get(b.teacherId || '') || 0) - (teacherLoads.get(a.teacherId || '') || 0));

    const days = [1, 2, 3, 4, 5];
    const periods = [1, 2, 3, 4, 5, 6];

    function isValid(tid: string | null, cid: string, day: number, period: number, shift: string, level: string): boolean {
      const dp = denorm(period, shift);
      if (classOccupied.get(cid)?.has(`${day}-${dp}`)) return false;
      if ((classDayCount.get(cid)?.get(day) || 0) >= maxPeriods(level)) return false;

      const sMap = classSubjectDayCount.get(cid)?.get(toSchedule[curIdx]?.subjectId);
      if (sMap && (sMap.get(day) || 0) >= 2) return false;

      if (!tid) return true;
      if (teacherUnavailable.get(tid)?.get(day)?.has(dp)) return false;

      const np = norm(dp, shift);
      if (teacherDayPeriods.get(tid)?.get(day)?.has(np)) return false;

      const mySlot = slotLookup.get(`${level}-${shift}-${day}-${period}`);
      if (!mySlot) return true;

      const tPeriods = teacherDayPeriods.get(tid)?.get(day);
      if (!tPeriods || tPeriods.size === 0) return true;

      for (const taNP of tPeriods) {
        let taSlot = slotLookup.get(`${level}-MORNING-${day}-${taNP}`) || slotLookup.get(`${level}-AFTERNOON-${day}-${taNP}`);
        if (!taSlot) {
          for (const lv of ['INFANTIL', 'FUND1', 'FUND2']) {
            if (lv === level) continue;
            taSlot = slotLookup.get(`${lv}-MORNING-${day}-${taNP}`) || slotLookup.get(`${lv}-AFTERNOON-${day}-${taNP}`);
            if (taSlot) break;
          }
        }
        if (taSlot && doTimeSlotsOverlap(mySlot, taSlot)) return false;
      }

      return true;
    }

    let curIdx = 0;
    let nodesExplored = 0;
    const MAX_NODES = 200000;
    const placedAssignments: { classId: string; subjectId: string; teacherId: string | null; dayOfWeek: number; period: number }[] = new Array(toSchedule.length);

    function backtrack(index: number): boolean {
      if (index === toSchedule.length) return true;
      if (nodesExplored++ > MAX_NODES) return false;

      curIdx = index;
      const curr = toSchedule[index];
      const existingDays = classSubjectDayCount.get(curr.classId)?.get(curr.subjectId);

      const candidates: { day: number; period: number }[] = [];
      for (const day of days) {
        if ((classDayCount.get(curr.classId)?.get(day) || 0) >= maxPeriods(curr.level)) continue;
        for (const period of periods) {
          if (isValid(curr.teacherId, curr.classId, day, period, curr.shift, curr.level)) {
            candidates.push({ day, period });
          }
        }
      }

      candidates.sort((a, b) => {
        const aH = existingDays?.has(a.day) ? 1 : 0;
        const bH = existingDays?.has(b.day) ? 1 : 0;
        if (aH !== bH) return bH - aH;
        return (classDayCount.get(curr.classId)?.get(a.day) || 0) - (classDayCount.get(curr.classId)?.get(b.day) || 0);
      });

      for (const { day, period } of candidates) {
        const sMap = classSubjectDayCount.get(curr.classId)?.get(curr.subjectId);
        if (sMap && (sMap.get(day) || 0) >= 2) continue;

        const dp = denorm(period, curr.shift);
        addAssign(curr.classId, curr.subjectId, curr.teacherId, day, dp, curr.shift);
        placedAssignments[index] = { classId: curr.classId, subjectId: curr.subjectId, teacherId: curr.teacherId, dayOfWeek: day, period: dp };

        if (backtrack(index + 1)) return true;

        removeAssign(curr.classId, curr.subjectId, curr.teacherId, day, dp, curr.shift);
        placedAssignments[index] = undefined as any;
      }

      return false;
    }

    const success = backtrack(0);

    // Collect whatever was placed (works for both full and partial)
    const finalPlaced = placedAssignments.filter((a): a is NonNullable<typeof a> => !!a);

    // Filter out originals
    const originalSet = new Set<string>();
    for (const s of fixedSchedules) originalSet.add(`${s.classId}-${s.dayOfWeek}-${s.period}`);
    if (mode === 'REPAIR') for (const s of currentSchedules) originalSet.add(`${s.classId}-${s.dayOfWeek}-${s.period}`);

    const newAssignments = finalPlaced.filter(a => !originalSet.has(`${a.classId}-${a.dayOfWeek}-${a.period}`));

    if (newAssignments.length > 0) {
      await prisma.schedule.createMany({
        data: newAssignments.map(a => ({
          classId: a.classId,
          subjectId: a.subjectId,
          teacherId: a.teacherId,
          dayOfWeek: a.dayOfWeek,
          period: a.period,
          isFixed: false,
        })),
      });
    }

    return {
      success: success || newAssignments.length > 0,
      assigned: newAssignments.length,
      total: toSchedule.length,
      timeout: nodesExplored > MAX_NODES,
    };

  } catch (e: any) {
    console.error('Engine error:', e);
    return { success: false, assigned: 0, total: 0, timeout: false, error: e.message };
  }
}
