// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { issueMaterial } from "../app/modules/inventory/inventory.service";
import { invokePosting } from "../app/modules/shared/shared.service";

// Handles that name their group, so the runner reads nothing: the bodies
// below refuse before they touch the database.
const handles = {
  db: {} as never,
  companyId: "company-1",
  userId: "user-1",
  companyGroupId: "group-1"
};

// `issue` throws a plain Error for this before any read.
const noChildren = {
  type: "trackedEntitiesToOperation" as const,
  parentTrackedEntityId: "lot-1",
  children: []
};

describe("a posting's refusal", () => {
  it("is a 400 from issue, whoever runs it", async () => {
    const fromHandles = await invokePosting(
      handles,
      "issue",
      noChildren,
      issueMaterial
    );
    const ctx = createServiceContext({
      actor: { type: "system", onBehalfOf: "user-1" },
      company: { id: "company-1", groupId: "group-1" },
      caller: {} as never,
      system: () => ({}) as never,
      pg: () => ({}) as never,
      kv: () => ({}) as never
    });
    const fromContext = await invokePosting(ctx, "issue", noChildren, issueMaterial);

    for (const result of [fromHandles, fromContext]) {
      expect(result.error).toMatchObject({
        status: 400,
        message: "Children are required"
      });
    }
  });

  it("is a 500 from a posting that names no status of its own", async () => {
    const result = await invokePosting(handles, "test-posting", {}, async () => {
      throw new Error("Children are required");
    });

    expect(result.error).toMatchObject({ status: 500 });
  });
});

describe("a caller's permission", () => {
  it("is resolved on the input as the posting's schema parses it", async () => {
    // The tests' service-role key: the caller is the system.
    const client = createClient("http://localhost", "test");

    const result = await invokePosting(
      { ...handles, client },
      "test-posting",
      { mode: "SCAN" },
      async (_ctx, input) => input,
      {
        as: { by: "mode", rules: { scan: {} } },
        schema: z.object({ mode: z.string().toLowerCase() })
      }
    );

    expect(result).toEqual({ data: { mode: "SCAN" }, error: null });
  });
});
