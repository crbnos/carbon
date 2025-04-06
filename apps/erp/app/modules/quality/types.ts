import type { Database } from "@carbon/database";
import type {
  getNonConformance,
  getNonConformanceWorkflow,
  getNonConformanceTypes,
} from "./quality.service";

export type NonConformanceStatus =
  Database["public"]["Enums"]["nonConformanceStatus"];

export type NonConformance = NonNullable<
  Awaited<ReturnType<typeof getNonConformance>>["data"]
>;

export type NonConformanceType = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceTypes>>["data"]
>[number];

export type NonConformanceWorkflow = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceWorkflow>>["data"]
>;
