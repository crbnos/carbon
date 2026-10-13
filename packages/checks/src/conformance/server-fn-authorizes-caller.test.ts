// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { serverFnAuthorizesCaller } from "./server-fn-authorizes-caller";

const DIR = "packages/server-functions/src";

describe("serverFnAuthorizesCaller", () => {
  it("flags an entry point not built with defineServerFn", () => {
    const ts = 'export const closeJob = (ctx) => ctx.db.updateTable("job");';
    const v = serverFnAuthorizesCaller.scan(`${DIR}/close-job`, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("close-job");
  });

  it("accepts a defineServerFn definition", () => {
    const ts =
      'export const closeJob = defineServerFn({ name: "close-job", input, permissions: { update: "production" }, run });';
    expect(serverFnAuthorizesCaller.scan(`${DIR}/close-job`, ts)).toHaveLength(
      0
    );
  });

  it("does not accept a bare import", () => {
    const ts = 'import { defineServerFn } from "../define-server-fn";';
    expect(serverFnAuthorizesCaller.scan(`${DIR}/x`, ts)).toHaveLength(1);
  });
});
