// Node-side re-export of the edge-runtime scheduling availability ladder (same
// pattern as sampling.ts). The ladder is pure TS over @internationalized/date,
// so the ERP forecast can compute the exact operating-hours windows the
// scheduler itself uses — one copy, no drift between the engine and the UI that
// shades non-working time.

export {
  type CalendarWindow,
  subtractIntervals
} from "../supabase/functions/lib/scheduling/calendar-utils.ts";
export {
  type LadderShiftRow,
  resolveLocationWindows,
  resolveWorkCenterWindows,
  type WorkCenterAvailabilityInput
} from "../supabase/functions/lib/scheduling/machine-availability.ts";

// Whole-location finite scheduling, run IN-PROCESS in Node (ERP app + jobs)
// instead of round-tripping to the `schedule` edge function. Server-only — pulls
// in the engine (pg/Kysely + @logtape), so import it from route actions,
// `*.service.ts`, `*.server.ts`, or `@carbon/jobs` handlers, never client code.
export {
  type ExpediteWhatIfResult,
  type LocationScheduleResult,
  type NewlyLateJob,
  runExpediteWhatIf,
  runLocationSchedule
} from "../supabase/functions/lib/scheduling/run-schedule.ts";
