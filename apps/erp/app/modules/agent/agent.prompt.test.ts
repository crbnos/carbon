import { describe, expect, it, vi } from "vitest";

// The v2 branch reads the generated MCP tool metadata; the scope rules under test
// live in the shared intro and are identical either way.
vi.mock("~/routes/api+/mcp+/lib/tool-metadata.json", () => ({
  default: { tools: [] }
}));

import { buildSystemPrompt } from "./agent.prompt";

describe("agent system prompt", () => {
  // The agent is a Carbon assistant, not a general chatbot. Without an explicit
  // scope section the model answers arithmetic, writes Python, etc. — it has the
  // capability, and nothing else in the prompt tells it not to.
  it("declares Carbon-only scope", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("SCOPE — CARBON ONLY");
    expect(prompt).toContain("NOT a general-purpose");
  });

  it("names the out-of-scope categories that regressed", () => {
    const prompt = buildSystemPrompt();
    // The two the user actually hit: a math question and "write me a Python program".
    expect(prompt).toMatch(/math, arithmetic, calculations/);
    expect(prompt).toMatch(/writing, explaining, reviewing or debugging code/);
  });

  it("tells the model how to decline instead of only that it must", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("HOW TO DECLINE");
    // A refusal with no alternative reads as a dead end.
    expect(prompt).toContain(
      "offer\na concrete Carbon-related thing you CAN do"
    );
  });

  it("holds the scope against insistence and Carbon-framed smuggling", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("the scope does\nnot change");
    expect(prompt).toContain("write a Python script to call Carbon's API");
  });

  it("keeps Carbon-adjacent questions answerable", () => {
    const prompt = buildSystemPrompt();
    // Over-refusing is the failure mode on the other side: ERP/manufacturing
    // concept questions are the agent's whole job.
    expect(prompt).toContain("manufacturing/ERP/MES/QMS domain concepts");
    expect(prompt).toContain("answer the Carbon half and decline the rest");
  });
});
