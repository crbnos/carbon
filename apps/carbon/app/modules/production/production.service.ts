import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { jobValidator } from "./production.models";

export async function deleteJob(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client.from("job").delete().eq("id", jobId);
}

export async function getJob(client: SupabaseClient<Database>, id: string) {
  return client.from("jobs").select("*").eq("id", id).single();
}

export async function getJobDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  jobId: string
) {
  // TODO: get documents from sales order/quote line
  return client.storage.from("private").list(`${companyId}/job/${jobId}`);
}

export async function getJobs(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("jobs")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("jobId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "jobId", ascending: true },
    ]);
  }

  return query;
}

export async function getJobsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("job")
    .select("id, jobId")
    .eq("companyId", companyId)
    .order("jobId");
}

export async function upsertJob(
  client: SupabaseClient<Database>,
  job:
    | (Omit<z.infer<typeof jobValidator>, "id" | "jobId"> & {
        jobId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof jobValidator>, "id" | "jobId"> & {
        id: string;
        jobId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in job) {
    return client
      .from("job")
      .update(sanitize(job))
      .eq("id", job.id)
      .select("id")
      .single();
  } else {
    return client.from("job").insert([job]).select("id").single();
  }
}
