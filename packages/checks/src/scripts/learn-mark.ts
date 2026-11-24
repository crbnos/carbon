// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The last step of /learn: marks this worktree's logged mistakes as handled,
// so the Stop hook stops asking about them.

import { appendSignal } from "../learn/inbox";
import { repoRoot } from "../sources/migrations";

appendSignal({
  kind: "learned",
  at: new Date().toISOString(),
  worktree: repoRoot()
});
