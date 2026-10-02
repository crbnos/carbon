// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createOpenAI } from "npm:@ai-sdk/openai@2.0.60";

export const openai = createOpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY") ?? "",
});
