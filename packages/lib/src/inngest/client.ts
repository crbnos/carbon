// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createInngestLogger } from "@carbon/logger/inngest";
import { Inngest } from "inngest";

/**
 * The Inngest client for Carbon jobs.
 * This client is used to define functions and send events.
 * `ctx.logger` in every function flows into LogTape under ["carbon","jobs"].
 */
export const inngest = new Inngest({
  id: "carbon",
  logger: createInngestLogger()
});

// Re-export the typed client for use in functions
export type InngestClient = typeof inngest;
