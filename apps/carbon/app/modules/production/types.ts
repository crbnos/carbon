import type { getJob } from "./production.service";

export type Job = NonNullable<Awaited<ReturnType<typeof getJob>>["data"]>;
