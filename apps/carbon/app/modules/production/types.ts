import type { getJob, getJobMethodTree } from "./production.service";

export type Job = NonNullable<Awaited<ReturnType<typeof getJob>>["data"]>;

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTree>>["data"]
>[number]["data"];
