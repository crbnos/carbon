import type {
  getNonConformanceTemplate,
  getNonConformanceTypes,
} from "./quality.service";

export type NonConformanceType = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceTypes>>["data"]
>[number];

export type NonConformanceTemplate = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceTemplate>>["data"]
>;
