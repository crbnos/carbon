import { notFound } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cookie from "cookie";

export function getCompanySettings(
  request: Request,
  companyId: string
):
  | { location: string; workCenter: string }
  | { location: undefined; workCenter: undefined } {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader ? cookie.parse(cookieHeader)[companyId] : null;
  if (parsed) {
    const [location, workCenter] = parsed.split(":");
    return { location, workCenter };
  }
  return {
    location: undefined,
    workCenter: undefined,
  };
}

export function setLocationAndWorkCenter(
  companyId: string,
  currentLocation: string,
  workCenter: string
) {
  return cookie.serialize(companyId, `${currentLocation}:${workCenter}`, {
    path: "/",
    maxAge: 31536000,
  });
}

export async function getLocationAndWorkCenter(
  request: Request,
  client: SupabaseClient<Database>,
  args: {
    userId: string;
    companyId: string;
  }
) {
  const { userId, companyId } = args;
  let { location, workCenter } = getCompanySettings(request, companyId);

  let updated = false;

  if (!location) {
    const employeeJob = await client
      .from("employeeJob")
      .select("locationId")
      .eq("id", userId)
      .eq("companyId", companyId)
      .single();

    if (employeeJob.data && employeeJob.data.locationId) {
      location = employeeJob.data.locationId;
      updated = true;
    } else {
      const locations = await client
        .from("location")
        .select("id")
        .eq("companyId", companyId);
      if (locations.data && locations.data.length > 0) {
        location = locations.data[0].id;
        updated = true;
      }
    }
  }

  if (!location) throw notFound("Failed to get a valid location");

  if (!workCenter) {
    const workCenters = await client
      .from("workCenter")
      .select("id")
      .eq("locationId", location);

    if (workCenters.data && workCenters.data.length > 0) {
      workCenter = workCenters.data[0].id;
      updated = true;
    }
  }

  if (!workCenter) throw notFound("Failed to get a valid work center");
  if (updated) {
    setLocationAndWorkCenter(companyId, location, workCenter);
  }

  return { location, workCenter, updated };
}
