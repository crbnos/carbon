// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createWorkflow, deleteWorkflow } from "./workflows.server";

/** The workflows module's operations, by entity. */
export const workflows = {
  workflow: { create: createWorkflow, delete: deleteWorkflow }
};
