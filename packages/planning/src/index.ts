// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @carbon/planning — the planning engines (MRP + finite scheduling), run
// in-process in Node. Every entry point takes an injected Kysely handle (and,
// for MRP, a service-role Supabase client); callers authenticate first.
// Server-only — pulls in pg/Kysely and @logtape, so import from route actions,
// *.service.ts, *.server.ts, or @carbon/jobs handlers, never client code.

// Material Requirements Planning.
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
  type QuoteLeadTimeForecast,
  type QuoteLeadTimeScenario,
  runQuoteLeadTimeWhatIf
} from "./scheduling/quote-lead-time.ts";
export {
  type ExpediteWhatIfResult,
  type LocationScheduleResult,
  type NewlyLateJob,
  runExpediteWhatIf,
  runLocationSchedule
} from "./scheduling/run-schedule.ts";
