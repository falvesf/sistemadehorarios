export interface LevelConfig {
  INFANTIL: number;
  FUND1: number;
  FUND2: number;
  MEDIO: number;
}

export interface ShiftConfig {
  morning: LevelConfig;
  afternoon: LevelConfig;
}

export interface DayGroupConfig {
  weekdays: ShiftConfig;
  friday: ShiftConfig;
}

export interface DoublePeriodConfig {
  enabled: boolean;
  flexible: boolean;
  maxConsecutive: 1 | 2 | 3;
}

export type Preference = 'BALANCED' | 'MORNING' | 'AFTERNOON';

export interface GapWeights {
  classWeight: number;
  teacherWeight: number;
}

export interface AdvancedConfig {
  preference: Preference;
  gapWeights: GapWeights;
  maxAttempts: number;
}

export interface ScheduleConfig {
  classDistribution: DayGroupConfig;
  doublePeriods: DoublePeriodConfig;
  advanced: AdvancedConfig;
}

export interface GenerationResult {
  success: boolean;
  assigned: number;
  total: number;
  timeout: boolean;
  error?: string;
  score?: ScoreBreakdown;
  config: ScheduleConfig;
}

export interface ScoreBreakdown {
  allocation: number;
  teacherBalance: number;
  gapMinimization: number;
  preferenceRespect: number;
  subjectGrouping: number;
  total: number;
}

export interface PlacedSlot {
  classId: string;
  subjectId: string;
  teacherId: string | null;
  dayOfWeek: number;
  period: number;
  shift: string;
  level: string;
}

export interface ToScheduleItem {
  classId: string;
  subjectId: string;
  teacherId: string | null;
  shift: string;
  level: string;
  consecutiveCount: number;
}

export const DEFAULT_CONFIG: ScheduleConfig = {
  classDistribution: {
    weekdays: {
      morning: { INFANTIL: 5, FUND1: 5, FUND2: 6, MEDIO: 6 },
      afternoon: { INFANTIL: 5, FUND1: 5, FUND2: 6, MEDIO: 6 },
    },
    friday: {
      morning: { INFANTIL: 5, FUND1: 5, FUND2: 6, MEDIO: 6 },
      afternoon: { INFANTIL: 3, FUND1: 3, FUND2: 4, MEDIO: 4 },
    },
  },
  doublePeriods: {
    enabled: true,
    flexible: false,
    maxConsecutive: 2,
  },
  advanced: {
    preference: 'BALANCED',
    gapWeights: { classWeight: 10, teacherWeight: 10 },
    maxAttempts: 50,
  },
};
