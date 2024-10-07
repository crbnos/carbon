import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@vercel/remix";
import * as cookie from "cookie";
import { path, requestReferrer } from "~/utils/path";
import {
  getLocationsByCompany,
  getWorkCentersByLocation,
} from "./jobs.service";

const locationCookieName = "location";
const workCenterCookieName = "workCenter";

export function getLocation(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader
    ? cookie.parse(cookieHeader)[locationCookieName]
    : null;
  return parsed || null;
}

export function setLocation(location: string) {
  return cookie.serialize(locationCookieName, location, {
    path: "/",
    maxAge: 31536000,
  });
}

export function getWorkCenter(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  const parsed = cookieHeader
    ? cookie.parse(cookieHeader)[workCenterCookieName]
    : null;
  return parsed || null;
}

export function setWorkCenter(workCenter: string) {
  return cookie.serialize(workCenterCookieName, workCenter, {
    path: "/",
    maxAge: 31536000,
  });
}

export async function updateLocationAndWorkCenter(
  request: Request,
  client: SupabaseClient<Database>,
  args: { companyId: string }
) {
  const location = await getLocationsByCompany(client, args.companyId!);
  if (!location.data || location.data.length === 0) {
    throw redirect(
      requestReferrer(request) ?? path.to.authenticatedRoot,
      await flash(request, error(null, "Location not found"))
    );
  }
  const workCenters = await getWorkCentersByLocation(
    client,
    location.data[0].id
  );
  if (!workCenters.data || workCenters.data.length === 0) {
    throw redirect(
      requestReferrer(request) ?? path.to.authenticatedRoot,
      await flash(request, error(null, "Location not found"))
    );
  }

  return {
    locationId: location.data[0].id,
    workCenterId: workCenters.data[0].id,
  };
}

export function setLocationAndWorkCenter(
  currentLocation: string,
  workCenter: string
) {
  return [
    cookie.serialize(locationCookieName, currentLocation, {
      path: "/",
      maxAge: 31536000,
    }),
    cookie.serialize(workCenterCookieName, workCenter, {
      path: "/",
      maxAge: 31536000,
    }),
  ].join(",");
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
  let location = getLocation(request);
  let workCenter = getWorkCenter(request);

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
      setLocation(location);
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

  if (!location) throw new Error("Failed to get a valid location");

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

  if (!workCenter) throw new Error("Failed to get a valid work center");

  return { location, workCenter, updated };
}
