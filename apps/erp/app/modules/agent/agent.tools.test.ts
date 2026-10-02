// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("./agent.kb", () => ({
  readDoc: vi.fn(),
  searchDocs: vi.fn()
}));
vi.mock("./agent.pages", () => ({
  findPages: vi.fn(),
  resolvePage: vi.fn()
}));

import { createAgentTools } from "./agent.tools";

describe("agent tools", () => {
  it("does not expose Change Notice deletion through the session agent", () => {
    const tools = createAgentTools();

    // The session agent is docs-only now. Change Notice deletion was previously
    // blocked behind call_tool, so keep the regression guard at that boundary.
    expect(tools).not.toHaveProperty("call_tool");
    expect(tools).not.toHaveProperty("items_deleteChangeNotice");
  });
});
