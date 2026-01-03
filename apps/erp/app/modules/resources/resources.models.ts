import { z } from "zod/v3";
import { zfd } from "zod-form-data";
import { processTypes, standardFactorType } from "../shared";

export const abilityCurveValidator = z.object({
  data: z
    .string()
    .startsWith("[", { message: "Invalid JSON" })
    .endsWith("]", { message: "Invalid JSON" }),
  shadowWeeks: zfd.numeric(
    z.number().min(0, { message: "Time shadowing is required" })
  )
});

export const abilityNameValidator = z.object({
  name: z.string().min(1, { message: "Name is required" })
});

export const abilityValidator = z
  .object({
    name: z.string().min(1, { message: "Name is required" }),
    startingPoint: zfd.numeric(
      z.number().min(0, { message: "Learning curve is required" })
    ),
    weeks: zfd.numeric(z.number().min(0, { message: "Weeks is required" })),
    shadowWeeks: zfd.numeric(
      z.number().min(0, { message: "Shadow is required" })
    ),
    employees: z
      .array(z.string().min(1, { message: "Invalid selection" }))
      .min(1, { message: "Group members are required" })
      .optional()
  })
  .refine((schema) => schema.shadowWeeks <= schema.weeks, {
    message: "name is required when you send color on request"
  });

export const contractorValidator = z.object({
  id: z.string().min(1, { message: "Supplier Contact is required" }),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  hoursPerWeek: zfd.numeric(
    z.number().min(0, { message: "Hours are required" })
  ),
  // abilities: z
  //   .array(z.string().min(1, { message: "Invalid ability" }))
  //   .optional(),
  assignee: zfd.text(z.string().optional())
});

export const employeeAbilityValidator = z.object({
  employeeId: z.string().min(1, { message: "Employee is required" }),
  trainingStatus: z.string().min(1, { message: "Status is required" }),
  trainingPercent: zfd.numeric(z.number().optional()),
  trainingDays: zfd.numeric(z.number().optional())
});

export const maintenanceFailureModeType = [
  "Maintenance",
  "Quality",
  "Operations",
  "Other"
] as const;

export const failureModeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  type: z.enum(maintenanceFailureModeType)
});

export const locationValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    addressLine1: z.string().min(1, { message: "Address is required" }),
    addressLine2: z.string().optional(),
    city: z.string().min(1, { message: "City is required" }),
    stateProvince: z
      .string()
      .min(1, { message: "State / Province is required" }),
    postalCode: z.string().min(1, { message: "Postal Code is required" }),
    countryCode: z.string().min(1, { message: "Country is required" }),
    timezone: z.string().min(1, { message: "Timezone is required" }),
    latitude: zfd.numeric(z.number().optional()),
    longitude: zfd.numeric(z.number().optional())
  })
  .superRefine(({ latitude, longitude }, ctx) => {
    if ((latitude && !longitude) || (!latitude && longitude)) {
      ctx.addIssue({
        code: "custom",
        message: "Both latitude and longitude are required"
      });
    }
  });

export const maintenanceDispatchCommentValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceDispatchId: z.string().min(1, { message: "Dispatch is required" }),
  comment: z.string().min(1, { message: "Comment is required" })
});

export const maintenanceDispatchEventValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    maintenanceDispatchId: z
      .string()
      .min(1, { message: "Dispatch is required" }),
    employeeId: z.string().min(1, { message: "Employee is required" }),
    workCenterId: z.string().min(1, { message: "Work center is required" }),
    startTime: z.string().min(1, { message: "Start time is required" }),
    endTime: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.endTime) {
        return new Date(data.startTime) < new Date(data.endTime);
      }
      return true;
    },
    {
      message: "Start time must be before end time",
      path: ["endTime"]
    }
  );

export const maintenanceDispatchItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceDispatchId: z.string().min(1, { message: "Dispatch is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(z.number().min(1)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  unitCost: zfd.numeric(z.number().min(0).optional())
});

export const maintenanceDispatchPriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const MaintenanceKPIs = [
  { key: "mttr", label: "Mean Time To Repair" },
  { key: "mtbf", label: "Mean Time Between Failures" },
  { key: "sparePartCost", label: "Spare Part Cost" },
  { key: "worstPerformingMachines", label: "Worst Performing Machines" },
  { key: "sparePartConsumption", label: "Spare Part Consumption" }
] as const;

export const maintenanceDispatchStatus = [
  "Open",
  "Assigned",
  "In Progress",
  "Completed",
  "Cancelled"
] as const;

export const maintenanceDispatchValidator = z.object({
  id: zfd.text(z.string().optional()),
  status: z.enum(maintenanceDispatchStatus),
  priority: z.enum(maintenanceDispatchPriority),
  severity: z
    .enum([
      "Preventive",
      "Operator Performed",
      "Support Required",
      "OEM Required"
    ] as const)
    .optional(),
  source: z
    .enum(["Scheduled", "Reactive", "Non-Conformance"] as const)
    .optional(),
  oeeImpact: z
    .enum(["Down", "Planned", "Impact", "No Impact"] as const)
    .optional(),
  workCenterId: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  suspectedFailureModeId: zfd.text(z.string().optional()),
  plannedStartTime: zfd.text(z.string().optional()),
  plannedEndTime: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  content: zfd.text(z.string().optional())
});

export const maintenanceDispatchWorkCenterValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceDispatchId: z.string().min(1, { message: "Dispatch is required" }),
  workCenterId: z.string().min(1, { message: "Work center is required" })
});

export const maintenanceDispatchIssueValidator = z.object({
  maintenanceDispatchItemId: z
    .string()
    .min(1, { message: "Maintenance Dispatch Item is required" }),
  quantity: zfd.numeric(z.number()),
  adjustmentType: z.enum(["Positive Adjmt.", "Negative Adjmt."])
});

export const maintenanceDispatchIssueTrackedEntityValidator = z.object({
  maintenanceDispatchItemId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number()
    })
  )
});

export const maintenanceFrequency = [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Annual"
] as const;

export const maintenanceScheduleItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceScheduleId: z.string().min(1, { message: "Schedule is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(z.number().min(1)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" })
});

export const maintenanceScheduleValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  workCenterId: z.string().min(1, { message: "Work center is required" }),
  frequency: z.enum(maintenanceFrequency),
  priority: z.enum(maintenanceDispatchPriority),
  estimatedDuration: zfd.numeric(z.number().optional()),
  active: zfd.checkbox(),
  // Day-of-week fields for daily frequency
  monday: zfd.checkbox(),
  tuesday: zfd.checkbox(),
  wednesday: zfd.checkbox(),
  thursday: zfd.checkbox(),
  friday: zfd.checkbox(),
  saturday: zfd.checkbox(),
  sunday: zfd.checkbox(),
  // Skip holidays option
  skipHolidays: zfd.checkbox()
});

export const maintenanceSeverity = [
  "Preventive",
  "Operator Performed",
  "Support Required",
  "OEM Required"
] as const;

export const maintenanceSource = [
  "Scheduled",
  "Reactive",
  "Non-Conformance"
] as const;

export const oeeImpact = ["Down", "Planned", "Impact", "No Impact"] as const;

export const partnerValidator = z.object({
  id: z.string().min(1, { message: "Supplier Location is required" }),
  supplierId: zfd.text(z.string().optional()),
  hoursPerWeek: zfd.numeric(
    z.number().min(0, { message: "Hours are required" })
  )
  // abilityId: z.string().min(1, { message: "Invalid ability" }),
});

export const processValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Process name is required" }),
    processType: z.enum(processTypes, {
      errorMap: () => ({ message: "Process type is required" })
    }),
    defaultStandardFactor: z
      .enum(standardFactorType, {
        errorMap: () => ({ message: "Standard factor is required" })
      })
      .optional(),
    workCenters: z
      .array(z.string().min(1, { message: "Invalid work center" }))
      .optional(),
    completeAllOnScan: zfd.checkbox()
  })
  .refine((data) => {
    if (data.processType !== "Outside" && !data.workCenters) {
      return { workCenters: ["Work center is required for inside process"] };
    }
    return true;
  })
  .refine((data) => {
    if (data.processType !== "Outside" && !data.defaultStandardFactor) {
      return { defaultStandardFactor: ["Standard factor is required"] };
    }
    return true;
  });

export const trainingAssignmentStatusOptions = [
  "Completed",
  "Pending",
  "Overdue",
  "Not Required"
] as const;

export const trainingAssignmentValidator = z.object({
  id: zfd.text(z.string().optional()),
  trainingId: z.string().min(1, { message: "Training is required" }),
  groupIds: z
    .array(z.string())
    .min(1, { message: "At least one group is required" })
});

export const trainingCompletionValidator = z.object({
  trainingAssignmentId: z
    .string()
    .min(1, { message: "Training assignment is required" }),
  employeeId: z.string().min(1, { message: "Employee is required" }),
  period: zfd.text(z.string().optional())
});

export const trainingFrequency = ["Once", "Quarterly", "Annual"] as const;

export const trainingQuestionType = [
  "MultipleChoice",
  "TrueFalse",
  "MultipleAnswers",
  "MatchingPairs",
  "Numerical"
] as const;

export const trainingQuestionValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    trainingId: z.string().min(1, { message: "Training is required" }),
    question: z.string().min(1, { message: "Question is required" }),
    type: z.enum(trainingQuestionType, {
      errorMap: () => ({ message: "Type is required" })
    }),
    sortOrder: zfd.numeric(z.number().min(0).optional()),
    required: zfd.checkbox().optional(),

    // For MultipleChoice and MultipleAnswers
    options: z.array(z.string()).optional(),
    // Accept string (from Select) or array (from MultiSelect), normalize to array
    correctAnswers: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((val) => {
        if (!val) return undefined;
        if (Array.isArray(val)) return val.filter((v) => v.trim() !== "");
        return val.trim() !== "" ? [val] : undefined;
      }),

    // For TrueFalse - accept string "true"/"false" and transform to boolean
    correctBoolean: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => {
        if (typeof val === "boolean") return val;
        if (typeof val === "string") return val === "true";
        return false;
      }),

    // For MatchingPairs - stored as JSON string
    matchingPairs: zfd.text(z.string().optional()),

    // For Numerical
    correctNumber: zfd.numeric(z.number().optional()),
    tolerance: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      if (data.type === "MultipleChoice" || data.type === "MultipleAnswers") {
        return (
          !!data.options &&
          data.options.length >= 2 &&
          data.options.every((option) => option.trim() !== "")
        );
      }
      return true;
    },
    {
      message: "At least 2 options are required",
      path: ["options"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "MultipleChoice") {
        return !!data.correctAnswers && data.correctAnswers.length === 1;
      }
      return true;
    },
    {
      message: "Exactly one correct answer is required for multiple choice",
      path: ["correctAnswers"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "MultipleAnswers") {
        return !!data.correctAnswers && data.correctAnswers.length >= 1;
      }
      return true;
    },
    {
      message: "At least one correct answer is required",
      path: ["correctAnswers"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "MatchingPairs") {
        if (!data.matchingPairs) return false;
        try {
          const pairs = JSON.parse(data.matchingPairs);
          return (
            Array.isArray(pairs) &&
            pairs.length >= 2 &&
            pairs.every(
              (pair: { left?: string; right?: string }) =>
                pair.left?.trim() && pair.right?.trim()
            )
          );
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: "At least 2 matching pairs are required",
      path: ["matchingPairs"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "Numerical") {
        return data.correctNumber !== undefined && data.correctNumber !== null;
      }
      return true;
    },
    {
      message: "Correct number is required",
      path: ["correctNumber"]
    }
  );

export const trainingStatus = ["Draft", "Active", "Archived"] as const;

export const trainingType = ["Mandatory", "Optional"] as const;

export const trainingValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  content: zfd.text(z.string().optional())
});

export const workCenterValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string(),
  defaultStandardFactor: z.enum(standardFactorType, {
    errorMap: () => ({ message: "Standard factor is required" })
  }),
  laborRate: zfd.numeric(z.number().min(0)),
  locationId: z.string().min(1, { message: "Location is required" }),
  machineRate: zfd.numeric(z.number().min(0)),
  overheadRate: zfd.numeric(z.number().min(0)),
  processes: z
    .array(z.string().min(1, { message: "Invalid process" }))
    .optional()
  // requiredAbilityId: zfd.text(z.string().optional()),
});
