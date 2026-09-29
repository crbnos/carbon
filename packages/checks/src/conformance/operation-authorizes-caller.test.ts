import { describe, expect, it } from "vitest";
import { operationAuthorizesCaller } from "./operation-authorizes-caller";

const DIR = "packages/operations/src";

describe("operationAuthorizesCaller", () => {
  it("flags an operation with no caller check", () => {
    const ts = 'export const closeJob = (ctx) => ctx.db.updateTable("job");';
    const v = operationAuthorizesCaller.scan(`${DIR}/close-job`, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("close-job");
  });

  it.each([
    'await assertOperationPermissions(ctx, { update: "production" });',
    "assertSystemCaller(ctx);"
  ])("accepts %s", (ts) => {
    expect(operationAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(0);
  });

  it("does not accept a bare import of a gate", () => {
    const ts = 'import { assertOperationPermissions } from "../context";';
    expect(operationAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(1);
  });
});
