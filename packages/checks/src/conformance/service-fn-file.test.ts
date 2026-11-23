// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { serviceFnFile } from "./service-fn-file";

const FILE = "apps/erp/app/modules/sales/sales.server.ts";
const scan = (ts: string, file = FILE) =>
  serviceFnFile.scan(file, ts).map((v) => v.snippet);

describe("serviceFnFile", () => {
  it("passes service functions, types and plain constants", () => {
    expect(
      scan(`import { z } from "zod";
type Line = { id: string };
const logger = getLogger("erp", "sales");
const CLOSED = new Set(["Closed"]);
/** Send a quote. @mcp */
export const sendQuote = defineServiceFn({ input: z.object({}), permission: {}, async run() {} });`)
    ).toEqual([]);
  });

  it("flags a helper function, a function-valued const and a class", () => {
    expect(
      scan(`export async function lookup() {}
function local() {}
const toRow = (x: number) => x;
class Cache {}`)
    ).toEqual(["lookup", "local", "toRow", "Cache"]);
  });

  it("flags an export that is not a service function, and an unexported one", () => {
    expect(
      scan(`export const LIMIT = 5;
const hidden = defineServiceFn({});
export { thing } from "./x";`)
    ).toEqual(["LIMIT", "hidden", "ExportDeclaration"]);
  });

  it("reads a module's own server file, .ee variant included", () => {
    const ts = "export function helper() {}";
    expect(scan(ts, "apps/erp/app/modules/sales/sales.service.ts")).toEqual([]);
    expect(scan(ts, "apps/erp/app/modules/router.server.ts")).toEqual([]);
    expect(scan(ts, "apps/erp/app/modules/widget/widget.ee.server.ts")).toEqual(
      ["helper"]
    );
  });
});
