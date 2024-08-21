import { z } from "zod";
import { zfd } from "zod-form-data";

export const standardFactorType = [
  "Hours/Piece",
  "Hours/100 Pieces",
  "Hours/1000 Pieces",
  "Minutes/Piece",
  "Minutes/100 Pieces",
  "Minutes/1000 Pieces",
  "Pieces/Hour",
  "Pieces/Minute",
  "Seconds/Piece",
  "Total Hours",
  "Total Minutes",
] as const;

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
      .array(z.string().min(36, { message: "Invalid selection" }))
      .min(1, { message: "Group members are required" })
      .optional(),
  })
  .refine((schema) => schema.shadowWeeks <= schema.weeks, {
    message: "name is required when you send color on request",
  });

export const abilityCurveValidator = z.object({
  data: z
    .string()
    .startsWith("[", { message: "Invalid JSON" })
    .endsWith("]", { message: "Invalid JSON" }),
  shadowWeeks: zfd.numeric(
    z.number().min(0, { message: "Time shadowing is required" })
  ),
});

export const abilityNameValidator = z.object({
  name: z.string().min(1, { message: "Name is required" }),
});

export const contractorValidator = z.object({
  id: z.string().min(20, { message: "Supplier Contact is required" }),
  supplierId: z.string().min(20, { message: "Supplier is required" }),
  hoursPerWeek: zfd.numeric(
    z.number().min(0, { message: "Hours are required" })
  ),
  abilities: z
    .array(z.string().min(20, { message: "Invalid ability" }))
    .optional(),
  assignee: zfd.text(z.string().optional()),
});

export const employeeAbilityValidator = z.object({
  employeeId: z.string().min(36, { message: "Employee is required" }),
  trainingStatus: z.string().min(1, { message: "Status is required" }),
  trainingPercent: zfd.numeric(z.number().optional()),
  trainingDays: zfd.numeric(z.number().optional()),
});

export const locationValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    addressLine1: z.string().min(1, { message: "Address is required" }),
    addressLine2: z.string().optional(),
    city: z.string().min(1, { message: "City is required" }),
    state: z.string().min(1, { message: "State is required" }),
    postalCode: z.string().min(1, { message: "Postal Code is required" }),
    // country: z.string().min(1, { message: "Country is required" }),
    timezone: z.string().min(1, { message: "Timezone is required" }),
    latitude: zfd.numeric(z.number().optional()),
    longitude: zfd.numeric(z.number().optional()),
  })
  .superRefine(({ latitude, longitude }, ctx) => {
    if ((latitude && !longitude) || (!latitude && longitude)) {
      ctx.addIssue({
        code: "custom",
        message: "Both latitude and longitude are required",
      });
    }
  });

export const partnerValidator = z.object({
  id: z.string().min(20, { message: "Supplier Location is required" }),
  supplierId: zfd.text(z.string().optional()),
  hoursPerWeek: zfd.numeric(
    z.number().min(0, { message: "Hours are required" })
  ),
  abilityId: z.string().min(20, { message: "Invalid ability" }),
});

export const processValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Process name is required" }),
  defaultStandardFactor: z.enum(standardFactorType, {
    errorMap: () => ({ message: "Standard factor is required" }),
  }),
});

export const workCenterValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string(),
  requiredAbilityId: zfd.text(z.string().optional()),
  quotingRate: zfd.numeric(z.number().min(0)),
  laborRate: zfd.numeric(z.number().min(0)),
  defaultStandardFactor: z.enum(standardFactorType, {
    errorMap: (issue, ctx) => ({ message: "Standard factor is required" }),
  }),
  processes: z.array(z.string().min(20, { message: "Invalid process" })),
});
