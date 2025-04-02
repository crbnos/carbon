import type {
  getNonConformanceWorkflow,
  getNonConformanceTypes,
} from "./quality.service";

export type NonConformanceType = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceTypes>>["data"]
>[number];

export type NonConformanceWorkflow = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceWorkflow>>["data"]
>;
