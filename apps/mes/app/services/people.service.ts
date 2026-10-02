// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase";

export async function getOpenClockEntry(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("timeCardEntry")
    .select("*")
    .eq("employeeId", employeeId)
    .eq("companyId", companyId)
    .is("clockOut", null)
    .maybeSingle();
}

export async function clockIn(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    createdBy: string;
  }
) {
  const existing = await getOpenClockEntry(
    client,
    args.employeeId,
    args.companyId
  );
  if (existing.data) {
    return { data: null, error: { message: "Already clocked in" } };
  }

  return client.from("timeCardEntry").insert({
    employeeId: args.employeeId,
    companyId: args.companyId,
    createdBy: args.createdBy
  });
}

export async function clockOut(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
    updatedBy: string;
    clockOut?: string;
    note?: string;
  }
) {
  const open = await getOpenClockEntry(client, args.employeeId, args.companyId);
  if (!open.data) {
    return { data: null, error: { message: "Not currently clocked in" } };
  }

  return client
    .from("timeCardEntry")
    .update(
      sanitize({
        clockOut: args.clockOut ?? new Date().toISOString(),
        note: args.note,
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", open.data.id);
}

export async function updateTimeCardEntry(
  client: SupabaseClient<Database>,
  args: {
    entryId: string;
    clockIn?: string;
    clockOut?: string | null;
    note?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("timeCardEntry")
    .update(
      sanitize({
        clockIn: args.clockIn,
        clockOut: args.clockOut,
        note: args.note,
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", args.entryId);
}
