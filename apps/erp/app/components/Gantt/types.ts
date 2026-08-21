import { z } from "zod";

export enum GantEventLevel {
  TRACE = "TRACE",
  DEBUG = "DEBUG",
  INFO = "INFO",
  LOG = "LOG",
  WARN = "WARN",
  ERROR = "ERROR"
}

export type GanttEvent = {
  id: string;
  parentId: string | undefined;
  children: string[];
  hasChildren: boolean;
  level: number;
  data: {
    duration: number;
    offset: number;
    message: string;
    isRoot: boolean;
    isError: boolean;
    style: GantEventStyle;
    level: GantEventLevel;
    isPartial: boolean;
    /**
     * Placement derived from scheduled dates only (no capacity reservation).
     * Renders as a static striped bar — distinct from isPartial, which means
     * work is genuinely still running and animates.
     */
    isEstimated?: boolean;
    /**
     * A placeholder for an operation the scheduler could NOT place (no qualified
     * operator, no feasible slot). Set on the operation row AND its work-center
     * lane (any unplaceable child). Renders a distinct "can't be scheduled" alert
     * in the status column — a stronger signal than isError (a placed-but-late op).
     */
    isUnschedulable?: boolean;
    isCancelled: boolean;
    /**
     * Time spent waiting for capacity before the bar starts (queued at a
     * busy work center, waiting for an operator). Rendered as a faded ghost
     * segment that ends where the solid bar begins; `reason` is its tooltip.
     * Offset/duration in ms relative to the timeline window, like the bar's.
     */
    wait?: { offset: number; duration: number; reason?: string | null };
    /**
     * Aggregate/rollup rows (e.g. the location root) render a NEUTRAL bar with
     * red segments drawn only over these intervals — so the row reads gray for
     * its whole span and turns red only where a conflict actually falls, instead
     * of the whole rollup going red from a single late child. Offset/duration in
     * ms relative to the timeline window, like the bar's.
     */
    conflictSegments?: { offset: number; duration: number }[];
  };
};

const variant = z.enum(["primary", "maintenance"]);

const accessoryItem = z.object({
  text: z.string(),
  variant: z.string().optional(),
  url: z.string().optional()
});
export type AccessoryItem = z.infer<typeof accessoryItem>;

const accessory = z.object({
  items: z.array(accessoryItem),
  style: z.enum(["person"]).optional()
});
export type Accessory = z.infer<typeof accessory>;

export const gantEventStyle = z
  .object({
    icon: z.string().optional(),
    variant: variant.optional(),
    accessory: accessory.optional()
  })
  .default({
    icon: undefined,
    variant: undefined
  });
export type GantEventStyle = z.infer<typeof gantEventStyle>;
