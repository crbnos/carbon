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
    const ts = "async function requireCaller";
    expect(edgeFunctionAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(1);
  });
});
