import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OperationSettings = {
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showEmployee: boolean;
  showProgress: boolean;
  showStatus: boolean;
};

export type BaseOperation = NonNullable<
  Awaited<ReturnType<typeof getJobOperationsByWorkCenter>>["data"]
>[number];

export type Operation = BaseOperation & {
  duration: number;
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
};

export type WorkCenter = NonNullable<
  Awaited<ReturnType<typeof getJobOperationsByWorkCenter>>["data"]
>[number];

export type Location = NonNullable<
  Awaited<ReturnType<typeof getLocationsByCompany>>["data"]
>[number];

export async function getJobOperationsByWorkCenter(
  client: SupabaseClient<Database>,
  { locationId, workCenterId }: { locationId: string; workCenterId: string }
) {
  return client.rpc("get_job_operations_by_work_center", {
    location_id: locationId,
    work_center_id: workCenterId,
  });
}

export async function getWorkCentersByLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("workCenter")
    .select("*")
    .eq("locationId", locationId)
    .order("name", { ascending: true });
}

export async function getLocationsByCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("location")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}
