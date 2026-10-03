// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { edgeFunctionAuthorizesCaller } from "./edge-function-authorizes-caller";

const DIR = "packages/database/supabase/functions";

describe("edgeFunctionAuthorizesCaller", () => {
  it("flags a function with no in-function auth", () => {
    const ts =
      'serve(async (req) => jsonResponse(await db.selectFrom("job")));';
    const v = edgeFunctionAuthorizesCaller.scan(`${DIR}/post-picking`, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("post-picking");
  });

  it.each([
    "await requireCaller(req);",
    "requireServiceRole(req);"
  ])("accepts %s", (ts) => {
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(0);
  });

  it("does not accept a gate that is only declared", () => {
    const ts =
      "async function requireCaller(req: Request): Promise<void> {}\nDeno.serve(() => ok());";
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(1);
  });

  it("accepts a declared gate that is also called", () => {
    const ts =
      "async function requireServiceRole(req: Request) {}\nawait requireServiceRole(req);";
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(0);
  });
});
