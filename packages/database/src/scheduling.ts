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
