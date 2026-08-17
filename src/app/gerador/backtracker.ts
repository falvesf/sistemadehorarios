import { ScheduleConfig, ScoreBreakdown } from './types';
import { calculateScore } from './score';

export interface BacktrackResult {
  placed: {
    classId: string;
    subjectId: string;
    teacherId: string | null;
    dayOfWeek: number;
    period: number;
    shift: string;
    level: string;
  }[];
  score: ScoreBreakdown;
}

export interface PlaceFnItem {
  classId: string;
  subjectId: string;
  teacherId: string | null;
  shift: string;
  level: string;
  consecutiveCount?: number;
}

type PlaceFn = (
  items: PlaceFnItem[],
  orderStrategy: 'default' | 'reverse' | 'random' | 'teacher-first' | 'subject-first'
) => { placed: { classId: string; subjectId: string; teacherId: string | null; dayOfWeek: number; period: number; shift: string; level: string }[]; assigned: number };

export function runBacktracker(
  placeFn: PlaceFn,
  items: { classId: string; subjectId: string; teacherId: string | null; shift: string; level: string }[],
  config: ScheduleConfig
): BacktrackResult {
  const maxAttempts = Math.max(config.advanced.maxAttempts, 200);
  let bestResult: BacktrackResult | null = null;

  const strategies: ('default' | 'reverse' | 'random' | 'teacher-first' | 'subject-first')[] = [
    'default',
    'teacher-first',
    'subject-first',
    'reverse',
  ];

  const startTime = Date.now();
  const timeoutMs = 110000;

  // Ciclo 1: Estratégias fixas
  for (let attempt = 0; attempt < strategies.length; attempt++) {
    if (Date.now() - startTime > timeoutMs) break;
    const result = placeFn(items, strategies[attempt]);
    const score = calculateScore(result.placed, items.length, config);
    if (!bestResult || score.total > bestResult.score.total) {
      bestResult = { placed: result.placed, score };
    }
    if (score.allocation >= 1 && score.gapMinimization >= 0.95) return bestResult;
  }

  // Ciclo 2: Múltiplas tentativas aleatórias
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() - startTime > timeoutMs) break;
    const result = placeFn(items, 'random');
    const score = calculateScore(result.placed, items.length, config);
    if (!bestResult || score.total > bestResult.score.total) {
      bestResult = { placed: result.placed, score };
    }
    if (score.allocation >= 1 && score.gapMinimization >= 0.95) return bestResult;
  }

  if (!bestResult) {
    const result = placeFn(items, 'default');
    const score = calculateScore(result.placed, items.length, config);
    bestResult = { placed: result.placed, score };
  }

  return bestResult;
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
