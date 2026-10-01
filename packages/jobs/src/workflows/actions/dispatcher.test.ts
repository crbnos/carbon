// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getWorkflowDispatch,
  setWorkflowDispatch,
  type WorkflowDispatch
} from "./dispatcher";

describe("the workflow dispatch seam", () => {
  it("has nothing until the app registers one", () => {
    expect(getWorkflowDispatch()).toBeUndefined();
  });

  it("hands back exactly what was registered", async () => {
    const fake: WorkflowDispatch = async () => ({ success: true, data: null });
    setWorkflowDispatch(fake);
    expect(getWorkflowDispatch()).toBe(fake);
  });
});
