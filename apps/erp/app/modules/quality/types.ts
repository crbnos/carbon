import type { getNonConformanceTypes } from "./quality.service";

export type NonConformanceType = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceTypes>>["data"]
>[number];
