import type { JobTravelerData } from "./types";

/** Merge-field variable map for a Job Traveler. */
export function buildJobTravelerVars(
  data: Pick<JobTravelerData, "job" | "item" | "customer" | "company">
): Record<string, string> {
  const { job, item, customer, company } = data;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "job.number": str(job?.jobId),
    "job.startDate": str(job?.startDate),
    "job.dueDate": str(job?.dueDate),
    "item.readableId": str(
      job?.itemReadableIdWithRevision ?? item?.readableIdWithRevision
    ),
    "item.name": str(item?.name),
    "customer.name": str(customer?.name),
    "company.name": str(company?.name),
    "company.city": str(company?.city),
    "company.country": str(company?.countryCode)
  };
}
