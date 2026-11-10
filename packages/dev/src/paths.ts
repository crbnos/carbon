// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { homedir } from "node:os";
import { join } from "pathe";

// Every file crbn keeps outside the repo. Functions, not constants: tests
// point HOME at a temp dir.
const carbonHome = () => join(homedir(), ".carbon");

export const paths = {
  /** Per-worktree slots: ports, redis index, a copy of the JWT. */
  registry: () => join(carbonHome(), "dev-ports.json"),
  /** The machine-wide JWT secret and keys every worktree shares. */
  devJwt: () => join(carbonHome(), "dev-jwt.json"),
  /** A worktree stack's own state: its mode and hibernation files. */
  stackDir: (slug: string) => join(carbonHome(), "stacks", slug),
  stackMode: (slug: string) => join(carbonHome(), "stacks", slug, "mode"),
  /** The files the running crbn-shared containers were started from. */
  shared: () => join(carbonHome(), "shared"),
  portlessUpdateCheck: () => join(carbonHome(), "portless-update.json"),
  /** portless's own state, resolved the way portless does (cli.js resolveStateDir). */
  portless: () => process.env.PORTLESS_STATE_DIR || join(homedir(), ".portless")
};
