import { z } from "zod";
import { zfd } from "zod-form-data";
import { processTypes, standardFactorType } from "../shared";

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
  id: z.string().min(1, { message: "Supplier Contact is required" }),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  hoursPerWeek: zfd.numeric(
    z.number().min(0, { message: "Hours are required" })
  ),
  // abilities: z
  //   .array(z.string().min(1, { message: "Invalid ability" }))
  //   .optional(),
  assignee: zfd.text(z.string().optional()),
});

export const employeeAbilityValidator = z.object({
  employeeId: z.string().min(1, { message: "Employee is required" }),
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
    stateProvince: z
      .string()
      .min(1, { message: "State / Province is required" }),
    postalCode: z.string().min(1, { message: "Postal Code is required" }),
    countryCode: z.string().min(1, { message: "Country is required" }),
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
  id: z.string().min(1, { message: "Supplier Location is required" }),
  supplierId: zfd.text(z.string().optional()),
  hoursPerWeek: zfd.numeric(
    z.number().min(0, { message: "Hours are required" })
  ),
  // abilityId: z.string().min(1, { message: "Invalid ability" }),
});

export const processValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Process name is required" }),
    processType: z.enum(processTypes, {
      errorMap: () => ({ message: "Process type is required" }),
    }),
    defaultStandardFactor: z
      .enum(standardFactorType, {
        errorMap: () => ({ message: "Standard factor is required" }),
      })
      .optional(),
    workCenters: z
      .array(z.string().min(1, { message: "Invalid work center" }))
      .optional(),
    completeAllOnScan: zfd.checkbox(),
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

export const workCenterValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string(),
  defaultStandardFactor: z.enum(standardFactorType, {
    errorMap: (issue, ctx) => ({ message: "Standard factor is required" }),
  }),
  laborRate: zfd.numeric(z.number().min(0)),
  locationId: z.string().min(1, { message: "Location is required" }),
  machineRate: zfd.numeric(z.number().min(0)),
  overheadRate: zfd.numeric(z.number().min(0)),
  processes: z
    .array(z.string().min(1, { message: "Invalid process" }))
    .optional(),
  // requiredAbilityId: zfd.text(z.string().optional()),
});
