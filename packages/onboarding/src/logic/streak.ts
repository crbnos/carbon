// The activation streak — Duolingo mechanics, recomputed from scratch on every
// run so there is no incremental drift:
//
// - A QUALIFYING business day extends the streak and the cumulative
//   "days on Carbon" counter.
// - A quiet business day consumes a Streak Freeze when one remains (the streak
//   survives, and the day is named kindly); with no freezes left the streak
//   resets to 0 — but the cumulative counter and every milestone already
//   reached stay. Progress is never erased, only momentum.
// - Milestones at days 3, 5, and 10. Day 10 = ACTIVATED — the factory has run
//   on Carbon for ten straight business days and the hub's job is done.
//
// Pure: the cron feeds it the company's usage-day rows (business days only,
// company-local dates) from cutover forward; side effects (emails, Slack,
// closing the hub) belong to the caller.

export const USAGE_DAY_COLLECTION = "usageDay";

export const STREAK_FREEZES_PER_JOURNEY = 2;
export const STREAK_MILESTONES = [3, 5, 10] as const;
export const ACTIVATION_STREAK_DAYS = 10;

export interface UsageDayInput {
  date: string; // YYYY-MM-DD, company-local business day
  qualifying: boolean;
}

export interface StreakState {
  streak: number;
  best: number;
  daysOnCarbon: number; // cumulative qualifying days — never goes backward
  freezesRemaining: number;
  // Quiet business days a freeze absorbed, in order ("Tuesday was quiet — a
  // shield kept your streak").
  freezeDates: string[];
  // Milestone → the date the streak first reached it. Once reached, forever.
  milestoneDates: Partial<Record<(typeof STREAK_MILESTONES)[number], string>>;
  // The date the streak reached ACTIVATION_STREAK_DAYS, if it has.
  activatedOn: string | null;
}

export function reduceStreak(days: UsageDayInput[]): StreakState {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  const state: StreakState = {
    streak: 0,
    best: 0,
    daysOnCarbon: 0,
    freezesRemaining: STREAK_FREEZES_PER_JOURNEY,
    freezeDates: [],
    milestoneDates: {},
    activatedOn: null
  };

  for (const day of sorted) {
    if (day.qualifying) {
      state.streak += 1;
      state.daysOnCarbon += 1;
      state.best = Math.max(state.best, state.streak);
      for (const milestone of STREAK_MILESTONES) {
        if (state.streak >= milestone && !state.milestoneDates[milestone]) {
          state.milestoneDates[milestone] = day.date;
        }
      }
      if (state.streak >= ACTIVATION_STREAK_DAYS && !state.activatedOn) {
        state.activatedOn = day.date;
      }
      continue;
    }

    // A quiet business day. A freeze absorbs it; otherwise the streak resets —
    // momentum lost, progress kept.
    if (state.streak > 0 && state.freezesRemaining > 0) {
      state.freezesRemaining -= 1;
      state.freezeDates.push(day.date);
    } else if (state.streak > 0) {
      state.streak = 0;
    }
  }

  return state;
}

// Field keys the engine persists (single writer: the usage cron + the switch
// gate transition). Read by the Live scoreboard and the internal fleet view.
export const LIVE_FIELD_KEYS = {
  liveAt: "live.liveAt", // cutover date — the streak's start
  activatedAt: "live.activatedAt",
  streak: "live.streak",
  streakBest: "live.streakBest",
  daysOnCarbon: "live.daysOnCarbon",
  freezesRemaining: "live.freezesRemaining"
} as const;
