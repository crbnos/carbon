import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// Make the Switch — the T-minus plan, the Old-System Freeze Plan, and the
// go/no-go huddle. Slippage has friction, not shame; the freeze plan is the
// anti-habit ritual, deliberately a small ceremony.

export interface TMinusItem {
  key: string; // check:switch.<key>
  offset: MessageDescriptor; // "T-7 days"
  label: MessageDescriptor;
  detail: MessageDescriptor;
}

export const T_MINUS_ITEMS: TMinusItem[] = [
  {
    key: "open-pos",
    offset: msg`T-7 days`,
    label: msg`Enter your open purchase orders`,
    detail: msg`What you're still waiting to receive. Plan real hours for this — prioritize by expected receipt date.`
  },
  {
    key: "open-orders",
    offset: msg`T-7 days`,
    label: msg`Enter your open customer orders`,
    detail: msg`What you still owe customers. Orders due in the next 30 days first.`
  },
  {
    key: "bom-touchups",
    offset: msg`T-7 days`,
    label: msg`Final BOM touch-ups on active products`,
    detail: msg`Only what ships this month needs to be right on day one.`
  },
  {
    key: "stock-count",
    offset: msg`The weekend before`,
    label: msg`Count the stock`,
    detail: msg`Full count for simple factories; standard and complex can count the top movers covering ~80% of value and true up the tail in week one. Count sheets print from Carbon; quantities go in as opening stock.`
  }
];

// The Old-System Freeze Plan — one screen the owner fills in and signs with a
// typed name. The old systems named out loud, the moment named out loud, and
// the day-one rule written in their own words.
export interface FreezeField {
  key: string; // fieldValue key: freeze.<key>
  label: MessageDescriptor;
  placeholder: MessageDescriptor;
}

export const FREEZE_FIELDS: FreezeField[] = [
  {
    key: "systems",
    label: msg`The old systems, named out loud`,
    placeholder: msg`e.g. JobBOSS, the quoting spreadsheet, the whiteboard`
  },
  {
    key: "moment",
    label: msg`The freeze moment`,
    placeholder: msg`e.g. Friday 5:00 pm — last entry anywhere but Carbon`
  },
  {
    key: "archive",
    label: msg`Where the final backup or archive lives`,
    placeholder: msg`e.g. the export folder on the server, dated`
  },
  {
    key: "read-only",
    label: msg`Who keeps read-only access, and until when`,
    placeholder: msg`We recommend 90 days, then it's removed — permanent read-only is a back door for old habits`
  },
  {
    key: "rule",
    label: msg`The day-one rule, in your own words`,
    placeholder: msg`e.g. If it's not in Carbon, it didn't happen`
  },
  {
    key: "cancel-date",
    label: msg`For a legacy-ERP exit: the subscription's cancellation date`,
    placeholder: msg`Nothing ends parallel running like a canceled license`
  }
];

// The go/no-go huddle — four plain questions the owner reads out loud.
// Four yeses is a go.
export const HUDDLE_QUESTIONS: { key: string; label: MessageDescriptor }[] = [
  { key: "data-in", label: msg`Is the data in?` },
  {
    key: "first-task",
    label: msg`Does everyone know their first task tomorrow?`
  },
  { key: "pilot-passed", label: msg`Did the pilot pass?` },
  { key: "who-to-call", label: msg`Do we know who to call if we're stuck?` }
];

export const SWITCH_COPY = {
  dateGuidance: msg`If the books are moving too, switch on the first day of a month; otherwise any Monday works. Never your busiest season.`,
  pushDate: msg`Moving the date is allowed — it just asks why. Slippage should have friction, not shame.`,
  liveReframe: msg`You're on Carbon. Live comes next — ten straight days of running on it.`
};
