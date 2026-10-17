// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { routeActionShape } from "./route-action-shape";

const ROUTE = "apps/erp/app/routes/x+/job+/$jobId.status.tsx";
const scan = (contents: string, file = ROUTE) =>
  routeActionShape.scan(file, contents).map((v) => v.snippet);

describe("route-action-shape", () => {
  it("flags a client write across lines", () => {
    expect(
      scan(
        `await client\n  .from("job")\n  .update({ status })\n  .eq("id", id);`
      )
    ).toEqual(['.from("job").update(']);
  });

  it("flags Kysely writes and postings", () => {
    expect(
      scan(
        'await db.updateTable("job").set({}).execute();\nawait invokeCreate(ctx, { type: "receiptDefault" });\nawait invokePosting(ctx, "post-receipt", {}, postReceipt);'
      )
    ).toEqual([".updateTable(", "invokeCreate(", "invokePosting("]);
  });

  it("leaves reads and non-database deletes alone", () => {
    expect(
      scan(
        'await client.from("job").select("id");\nformData.delete("intent");\nurl.searchParams.delete("x");'
      )
    ).toEqual([]);
  });

  it("only scans ERP routes", () => {
    expect(
      scan('await client.from("job").delete();', "apps/mes/app/routes/x.tsx")
    ).toEqual([]);
  });
});
