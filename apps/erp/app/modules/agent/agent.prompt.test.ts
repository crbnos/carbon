// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { buildSystemPrompt } from "./agent.prompt";

it("gives the model the company's date, not the server's", () => {
  expect(buildSystemPrompt({ today: "2026-09-30" })).toContain(
    "Today's date is 2026-09-30."
  );
});
