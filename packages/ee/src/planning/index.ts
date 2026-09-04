// @carbon/ee/planning — the planning engines (MRP + finite scheduling),
// relocated from the Supabase edge runtime to run in-process in Node. Every
// entry point takes an injected Kysely handle (and, for MRP, a service-role
// Supabase client); callers authenticate first. Server-only — pulls in
// pg/Kysely and @logtape, so import from route actions, *.service.ts,
// *.server.ts, or @carbon/jobs handlers, never client code.

// Material Requirements Planning (formerly the `mrp` edge function).
export { type MrpPayload, type MrpResult, runMrp } from "./mrp/mrp.ts";
// Finite scheduling (formerly reached via @carbon/database/scheduling).
export {
  type CalendarWindow,
  subtractIntervals
} from "./scheduling/calendar-utils.ts";
export {
  type LadderShiftRow,
  resolveLocationWindows,
  resolveWorkCenterWindows,
  type WorkCenterAvailabilityInput
} from "./scheduling/machine-availability.ts";
export {
  type ExpediteWhatIfResult,
  type LocationScheduleResult,
  type NewlyLateJob,
  runExpediteWhatIf,
  runLocationSchedule
} from "./scheduling/run-schedule.ts";
