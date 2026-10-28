// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { createWorkflowCatalog } from "@carbon/ee/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createWorkflowServices } from "./services";

function services() {
  return createWorkflowServices({
    // Never reached: both refusals return before any executor runs.
    client: {} as SupabaseClient<Database>,
    catalog: createWorkflowCatalog(),
    companyId: "co1",
    companyGroupId: "cg1",
    ownerId: "u1",
    permissions: {},
    runId: "run1",
    workflowId: "wf1"
  });
}

describe("runAction", () => {
  // Routing off the id's shape would send this to the update executor, which
  // would write to a table no action declared.
  it("refuses an unknown id that merely looks like an update", async () => {
    expect(await services().runAction("madeUp.update", {})).toEqual({
      ok: false,
      error: "This step is no longer available."
    });
  });

  it("refuses a create when the app has installed no dispatcher", async () => {
    expect(await services().runAction("job.create", {})).toEqual({
      ok: false,
      error: "This step is not available in this environment."
    });
  });
});
