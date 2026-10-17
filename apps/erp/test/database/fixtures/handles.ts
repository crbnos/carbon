// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PostingHandles } from "../../../app/modules/shared/shared.service";

/** The handles a fixture's context holds, for a ported posting run as the system. */
export function handlesOf(ctx: {
  db: PostingHandles["db"];
  companyId: string;
  userId: string;
}): PostingHandles {
  return { db: ctx.db, companyId: ctx.companyId, userId: ctx.userId };
}
