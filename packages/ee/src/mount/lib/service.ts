// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export { MOUNT_INTEGRATION_ID } from "./constants";

import { MOUNT_INTEGRATION_ID } from "./constants";

export async function getMountIntegration(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", MOUNT_INTEGRATION_ID)
    .limit(1);
}
