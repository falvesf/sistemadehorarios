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
  const timeoutMs = 120000; // 2 minutos para processamento exaustivo

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() - startTime > timeoutMs) break;

    let strategy: typeof strategies[number];
    if (attempt < strategies.length) {
      strategy = strategies[attempt];
    } else {
      strategy = 'random';
    }

    const result = placeFn(items, strategy);
    const score = calculateScore(result.placed, items.length, config);

    if (!bestResult || score.total > bestResult.score.total) {
      bestResult = { placed: result.placed, score };
    }

    // Para se alocação for 100% e gaps mínimos
    if (score.allocation >= 1 && score.gapMinimization >= 0.95) break;
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
