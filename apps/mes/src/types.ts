import { z } from "zod";
import type { getUser } from "./services";

export type User = Awaited<ReturnType<typeof getUser>>["data"];
export type OutletContext = {
  user: User;
  signOut: () => Promise<void>;
};

export type JobSettings = {
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showEmployee: boolean;
  showProgress: boolean;
  showStatus: boolean;
};

const jobValidator = z.object({
  id: z.string(),
  workCenterId: z.string(),
  workCenterTypeId: z.string(),
  readableId: z.string(),
  part: z.string().optional(),
  customerId: z.string().optional(),
  employeeIds: z.array(z.string()).optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(), // 2024-05-28
  duration: z.number().optional(), // miliseconds
  deadlineType: z
    .enum(["ASAP", "HARD_DEADLINE", "SOFT_DEADLINE", "NO_DEADLINE"])
    .optional(),
  progress: z.number().optional(), // miliseconds
  order: z.number().optional(),
  status: z
    .enum([
      "CANCELED",
      "DONE",
      "IN_PROGRESS",
      "PAUSED",
      "READY",
      "TODO",
      "WAITING",
    ])
    .optional(),
});

export type Job = z.infer<typeof jobValidator>;
