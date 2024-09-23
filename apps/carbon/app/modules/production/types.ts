import type {
  getJob,
  getJobMaterials,
  getJobMethodTree,
  getJobOperations,
} from "./production.service";

export type Job = NonNullable<Awaited<ReturnType<typeof getJob>>["data"]>;

export type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterials>>["data"]
>[number];

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTree>>["data"]
>[number]["data"];

export type JobOperation = NonNullable<
  Awaited<ReturnType<typeof getJobOperations>>["data"]
>[number];
