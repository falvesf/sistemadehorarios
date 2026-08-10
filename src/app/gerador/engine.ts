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
      slotLookup.set(ts.level + '-' + ts.shift + '-' + ts.dayOfWeek + '-' + ts.period, ts);
    }

    // Lookup sets for O(1) checks
    const occupied = new Set<string>();
    const teacherOccupied = new Set<string>();
    const teacherUnavail = new Set<string>();
    const classDayCount = new Map<string, Map<number, number>>();
    const classSubjectDayCount = new Map<string, Map<string, Map<number, number>>>();
    const teacherDaySlots = new Map<string, Map<number, { startTime: string; endTime: string }[]>>();

    const np = (p: number, shift: string) => shift === 'AFTERNOON' && p > 6 ? p - 6 : p;
    const dp = (p: number, shift: string) => shift === 'AFTERNOON' ? p + 6 : p;

    const placeOnGrid = (cid: string, sid: string, tid: string | null, day: number, denormP: number, shift: string) => {
      occupied.add(cid + '-' + day + '-' + denormP);
      if (tid) {
        const normalizedP = np(denormP, shift);
        teacherOccupied.add(tid + '-' + day + '-' + normalizedP);
        if (!teacherDaySlots.has(tid)) teacherDaySlots.set(tid, new Map());
        const dm = teacherDaySlots.get(tid)!;
        if (!dm.has(day)) dm.set(day, []);
        const level = classMap.get(cid)?.level || 'FUND2';
        const slot = slotLookup.get(level + '-' + shift + '-' + day + '-' + normalizedP);
        if (slot) dm.get(day)!.push(slot);
      }
      if (!classDayCount.has(cid)) classDayCount.set(cid, new Map());
      const dc = classDayCount.get(cid)!;
      dc.set(day, (dc.get(day) || 0) + 1);
      if (!classSubjectDayCount.has(cid)) classSubjectDayCount.set(cid, new Map());
      const csm = classSubjectDayCount.get(cid)!;
      if (!csm.has(sid)) csm.set(sid, new Map());
      csm.get(sid)!.set(day, (csm.get(sid)!.get(day) || 0) + 1);
    }

    const canPlace = (cid: string, sid: string, tid: string | null, day: number, period: number, shift: string, level: string): boolean => {
      const denormP = dp(period, shift);
      if (occupied.has(cid + '-' + day + '-' + denormP)) return false;
      if ((classDayCount.get(cid)?.get(day) || 0) >= maxPeriods(level)) return false;
      if ((classSubjectDayCount.get(cid)?.get(sid)?.get(day) || 0) >= 2) return false;
      if (!tid) return true;
      if (teacherUnavail.has(tid + '-' + day + '-' + denormP)) return false;
      const normalizedP = np(denormP, shift);
      if (teacherOccupied.has(tid + '-' + day + '-' + normalizedP)) return false;
      const mySlot = slotLookup.get(level + '-' + shift + '-' + day + '-' + period);
      if (!mySlot) return true;
      const tSlots = teacherDaySlots.get(tid)?.get(day);
      if (!tSlots || tSlots.length === 0) return true;
      for (const ts of tSlots) {
        if (doTimeSlotsOverlap(mySlot, ts)) return false;
      }
      return true;
    }

    // Priority 1: Load fixed schedules (capela)
    for (const s of fixedSchedules) {
      const c = classMap.get(s.classId);
      if (c) placeOnGrid(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
    }

    // Priority 2: Load current schedules in REPAIR mode
    if (mode === 'REPAIR') {
      for (const s of currentSchedules) {
        const c = classMap.get(s.classId);
        if (c) placeOnGrid(s.classId, s.subjectId, s.teacherId, s.dayOfWeek, s.period, c.shift);
      }
    }

    // Teacher unavailability
    for (const a of availabilities) {
      if (!a.isAvailable) teacherUnavail.add(a.teacherId + '-' + a.dayOfWeek + '-' + a.period);
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

    // Greedy placement: place each item in first valid slot
    const newAssignments: { classId: string; subjectId: string; teacherId: string | null; dayOfWeek: number; period: number }[] = [];

    for (const curr of toSchedule) {
      const existingDays = classSubjectDayCount.get(curr.classId)?.get(curr.subjectId);
      const candidates: { day: number; period: number }[] = [];

      for (const day of days) {
        if ((classDayCount.get(curr.classId)?.get(day) || 0) >= maxPeriods(curr.level)) continue;
        for (const period of periods) {
          if (canPlace(curr.classId, curr.subjectId, curr.teacherId, day, period, curr.shift, curr.level)) {
            candidates.push({ day, period });
          }
        }
      }

      // Prefer grouping same subject on same day, then least occupied
      candidates.sort((a, b) => {
        const aH = existingDays?.has(a.day) ? 1 : 0;
        const bH = existingDays?.has(b.day) ? 1 : 0;
        if (aH !== bH) return bH - aH;
        return (classDayCount.get(curr.classId)?.get(a.day) || 0) - (classDayCount.get(curr.classId)?.get(b.day) || 0);
      });

      if (candidates.length > 0) {
        const best = candidates[0];
        const denormP = dp(best.period, curr.shift);
        placeOnGrid(curr.classId, curr.subjectId, curr.teacherId, best.day, denormP, curr.shift);
        newAssignments.push({ classId: curr.classId, subjectId: curr.subjectId, teacherId: curr.teacherId, dayOfWeek: best.day, period: denormP });
      }
    }

    // Filter out originals
    const originalSet = new Set<string>();
    for (const s of fixedSchedules) originalSet.add(s.classId + '-' + s.dayOfWeek + '-' + s.period);
    if (mode === 'REPAIR') for (const s of currentSchedules) originalSet.add(s.classId + '-' + s.dayOfWeek + '-' + s.period);

    const toSave = newAssignments.filter(a => !originalSet.has(a.classId + '-' + a.dayOfWeek + '-' + a.period));

    if (toSave.length > 0) {
      await prisma.schedule.createMany({
        data: toSave.map(a => ({
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
      success: toSave.length === toSchedule.length,
      assigned: toSave.length,
      total: toSchedule.length,
      timeout: false,
    };

  } catch (e: any) {
    console.error('Engine error:', e);
    return { success: false, assigned: 0, total: 0, timeout: false, error: e.message };
  }
}
