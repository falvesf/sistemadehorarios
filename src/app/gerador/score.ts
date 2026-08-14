import { ScheduleConfig, ScoreBreakdown, PlacedSlot, ToScheduleItem } from './types';

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

function calcAllocationScore(assigned: number, total: number): number {
  if (total === 0) return 1;
  return Math.min(assigned / total, 1);
}

function calcTeacherBalanceScore(
  placed: PlacedSlot[],
  config: ScheduleConfig
): number {
  const teacherDayCounts = new Map<string, Map<number, number>>();

  for (const slot of placed) {
    if (!slot.teacherId) continue;
    if (!teacherDayCounts.has(slot.teacherId)) {
      teacherDayCounts.set(slot.teacherId, new Map());
    }
    const dayMap = teacherDayCounts.get(slot.teacherId)!;
    dayMap.set(slot.dayOfWeek, (dayMap.get(slot.dayOfWeek) || 0) + 1);
  }

  if (teacherDayCounts.size === 0) return 1;

  let totalVariance = 0;
  let teacherCount = 0;

  for (const [, dayMap] of teacherDayCounts) {
    const counts = Array.from(dayMap.values());
    const total = counts.reduce((a, b) => a + b, 0);
    const mean = total / 5;
    let variance = 0;
    for (let d = 1; d <= 5; d++) {
      const c = dayMap.get(d) || 0;
      variance += (c - mean) ** 2;
    }
    variance /= 5;
    totalVariance += variance;
    teacherCount++;
  }

  const avgVariance = totalVariance / teacherCount;
  return Math.max(0, 1 - avgVariance / 4);
}

function calcGapScore(
  placed: PlacedSlot[],
  config: ScheduleConfig
): number {
  const classDayPeriods = new Map<string, Map<number, Set<number>>>();
  const teacherDayPeriods = new Map<string, Map<number, Set<number>>>();

  for (const slot of placed) {
    const classKey = slot.classId;
    if (!classDayPeriods.has(classKey)) classDayPeriods.set(classKey, new Map());
    const dayMap = classDayPeriods.get(classKey)!;
    if (!dayMap.has(slot.dayOfWeek)) dayMap.set(slot.dayOfWeek, new Set());
    dayMap.get(slot.dayOfWeek)!.add(slot.period);

    if (slot.teacherId) {
      if (!teacherDayPeriods.has(slot.teacherId)) teacherDayPeriods.set(slot.teacherId, new Map());
      const tDayMap = teacherDayPeriods.get(slot.teacherId)!;
      if (!tDayMap.has(slot.dayOfWeek)) tDayMap.set(slot.dayOfWeek, new Set());
      tDayMap.get(slot.dayOfWeek)!.add(slot.period);
    }
  }

  let totalGaps = 0;
  let totalSlots = 0;

  for (const [, dayMap] of classDayPeriods) {
    for (const [, periods] of dayMap) {
      const sorted = Array.from(periods).sort((a, b) => a - b);
      if (sorted.length < 2) continue;
      totalSlots += sorted.length;
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i] - sorted[i - 1] - 1;
        if (gap > 0) totalGaps += gap;
      }
    }
  }

  if (totalSlots === 0) return 1;
  const gapRatio = totalGaps / totalSlots;
  return Math.max(0, 1 - gapRatio * config.advanced.gapWeights.classWeight / 2);
}

function calcPreferenceScore(
  placed: PlacedSlot[],
  config: ScheduleConfig
): number {
  if (config.advanced.preference === 'BALANCED') return 1;

  const targetShift = config.advanced.preference === 'MORNING' ? 'MORNING' : 'AFTERNOON';
  let preferred = 0;
  let total = 0;

  for (const slot of placed) {
    total++;
    if (slot.shift === targetShift) preferred++;
  }

  if (total === 0) return 1;
  return preferred / total;
}

function calcSubjectGroupingScore(
  placed: PlacedSlot[],
  config: ScheduleConfig
): number {
  if (!config.doublePeriods.enabled) return 1;

  const classDaySubject = new Map<string, Map<number, Map<string, number>>>();
  for (const slot of placed) {
    const key = slot.classId;
    if (!classDaySubject.has(key)) classDaySubject.set(key, new Map());
    const dayMap = classDaySubject.get(key)!;
    if (!dayMap.has(slot.dayOfWeek)) dayMap.set(slot.dayOfWeek, new Map());
    const subjMap = dayMap.get(slot.dayOfWeek)!;
    subjMap.set(slot.subjectId, (subjMap.get(slot.subjectId) || 0) + 1);
  }

  let grouped = 0;
  let totalSubjects = 0;

  for (const [, dayMap] of classDaySubject) {
    for (const [, subjMap] of dayMap) {
      for (const [, count] of subjMap) {
        totalSubjects++;
        if (count >= 2) grouped++;
      }
    }
  }

  if (totalSubjects === 0) return 1;
  if (config.doublePeriods.flexible) return 1;
  return 0.5 + (grouped / totalSubjects) * 0.5;
}

export function calculateScore(
  placed: PlacedSlot[],
  totalNeeded: number,
  config: ScheduleConfig
): ScoreBreakdown {
  const allocation = calcAllocationScore(placed.length, totalNeeded);
  const teacherBalance = calcTeacherBalanceScore(placed, config);
  const gapMinimization = calcGapScore(placed, config);
  const preferenceRespect = calcPreferenceScore(placed, config);
  const subjectGrouping = calcSubjectGroupingScore(placed, config);

  const total =
    allocation * 0.50 +
    teacherBalance * 0.10 +
    gapMinimization * 0.20 +
    preferenceRespect * 0.05 +
    subjectGrouping * 0.15;

  return {
    allocation,
    teacherBalance,
    gapMinimization,
    preferenceRespect,
    subjectGrouping,
    total,
  };
}
