// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { testMocksOwnModule } from "./test-mocks-own-module";

const scan = (contents: string) =>
  testMocksOwnModule.scan("apps/erp/app/x.test.ts", contents);

describe("testMocksOwnModule", () => {
  it.each([
    ['vi.mock("./x.service")', 'vi.mock("./x.service")'],
    ["vi.mock('../../db', () => ({}))", 'vi.mock("../../db")'],
    ["vi.doMock(`~/modules/items`)", 'vi.doMock("~/modules/items")'],
    ['vi.mock(import("./client"), () => ({}))', 'vi.mock("./client")']
  ])("flags %s", (source, snippet) => {
    expect(scan(source).map((v) => v.snippet)).toEqual([snippet]);
  });

  it("accepts mocks of packages and node built-ins", () => {
    expect(
      scan(`vi.mock("@carbon/auth/client.server");
vi.mock("node:fs");
vi.mock("@lingui/core/macro", () => ({}));`)
    ).toEqual([]);
  });

  it("reports the line of each mock", () => {
    expect(
      scan(`import { vi } from "vitest";
vi.mock("./a");

vi.mock("./b");`).map((v) => v.line)
    ).toEqual([2, 4]);
  });
});
