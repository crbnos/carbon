import { z } from "zod";

export enum GantEventLevel {
  TRACE = "TRACE",
  DEBUG = "DEBUG",
  INFO = "INFO",
  LOG = "LOG",
  WARN = "WARN",
  ERROR = "ERROR",
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
    isCancelled: boolean;
  };
};

const variant = z.enum(["primary"]);

const accessoryItem = z.object({
  text: z.string(),
  variant: z.string().optional(),
  url: z.string().optional(),
});
export type AccessoryItem = z.infer<typeof accessoryItem>;

const accessory = z.object({
  items: z.array(accessoryItem),
  style: z.enum(["person"]).optional(),
});
export type Accessory = z.infer<typeof accessory>;

export const gantEventStyle = z
  .object({
    icon: z.string().optional(),
    variant: variant.optional(),
    accessory: accessory.optional(),
  })
  .default({
    icon: undefined,
    variant: undefined,
  });
export type GantEventStyle = z.infer<typeof gantEventStyle>;
