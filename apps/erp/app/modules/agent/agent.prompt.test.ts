// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./agent.prompt";

const prompt = buildSystemPrompt({ today: "2026-09-30" });

describe("agent system prompt", () => {
  it("gives the model the company's date, not the server's", () => {
    expect(prompt).toContain("Today's date is 2026-09-30.");
  });

  // The agent is a Carbon assistant, not a general chatbot. Without an explicit
  // scope section the model answers arithmetic, writes Python, etc. — it has the
  // capability, and nothing else in the prompt tells it not to.
  it("declares Carbon-only scope", () => {
    expect(prompt).toContain("SCOPE — CARBON ONLY");
    expect(prompt).toContain("NOT a general-purpose");
  });

  it("names the out-of-scope categories that regressed", () => {
    // The two the user actually hit: a math question and "write me a Python program".
    expect(prompt).toMatch(/math, arithmetic, calculations/);
    expect(prompt).toMatch(/writing, explaining, reviewing or debugging code/);
  });

  it("tells the model how to decline instead of only that it must", () => {
    expect(prompt).toContain("HOW TO DECLINE");
    // A refusal with no alternative reads as a dead end.
    expect(prompt).toContain(
      "offer\na concrete Carbon-related thing you CAN do"
    );
  });

  it("holds the scope against insistence and Carbon-framed smuggling", () => {
    expect(prompt).toContain("the scope does\nnot change");
    expect(prompt).toContain("write a Python script to call Carbon's API");
  });

  it("keeps Carbon-adjacent questions answerable", () => {
    // Over-refusing is the failure mode on the other side: ERP/manufacturing
    // concept questions are the agent's whole job.
    expect(prompt).toContain("manufacturing/ERP/MES/QMS domain concepts");
    expect(prompt).toContain("answer the Carbon half and decline the rest");
  });
});
