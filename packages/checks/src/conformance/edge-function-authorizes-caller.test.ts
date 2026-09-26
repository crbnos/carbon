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
    "await requirePermissions(req, companyId, userId, {});",
    "await requireCaller(req);",
    "requireServiceRole(req);",
    "const client = await getSupabaseServiceRole(auth, apiKey, companyId);"
  ])("accepts %s", (ts) => {
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(0);
  });

  it("does not accept a bare import of a gate", () => {
    const ts = 'import { requirePermissions } from "../lib/supabase.ts";';
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(1);
  });

  it("skips allowlisted functions", () => {
    expect(
      edgeFunctionAuthorizesCaller.scan(`${DIR}/logo-resizer`, "serve(f);")
    ).toHaveLength(0);
  });
});
