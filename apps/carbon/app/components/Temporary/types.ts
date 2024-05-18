import { z } from "zod";

export enum TaskEventLevel {
  TRACE = "TRACE",
  DEBUG = "DEBUG",
  INFO = "INFO",
  LOG = "LOG",
  WARN = "WARN",
  ERROR = "ERROR",
}

export type RunEvent = {
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
    style: z.infer<typeof TaskEventStyle>;
    level: TaskEventLevel;
    isPartial: boolean;
    isCancelled: boolean;
  };
};

const Variant = z.enum(["primary"]);

const AccessoryItem = z.object({
  text: z.string(),
  variant: z.string().optional(),
  url: z.string().optional(),
});

const Accessory = z.object({
  items: z.array(AccessoryItem),
  style: z.enum(["person"]).optional(),
});

export const TaskEventStyle = z
  .object({
    icon: z.string().optional(),
    variant: Variant.optional(),
    accessory: Accessory.optional(),
  })
  .default({
    icon: undefined,
    variant: undefined,
  });
