// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getClientCache, getCompanyId } from "./react-query";

describe("getCompanyId", () => {
  it("returns null when called during server rendering", () => {
    expect(() => getCompanyId()).not.toThrow();
    expect(getCompanyId()).toBeNull();
  });

  it("does not read the client cache during server rendering", () => {
    expect(() => getClientCache()).not.toThrow();
    expect(getClientCache()).toBeUndefined();
  });
});
