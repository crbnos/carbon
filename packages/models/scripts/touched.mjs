// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fingerprints, readCoverage } from "./coverage.mjs";

/**
 * Prints every model whose covered code no longer reads as it did when the
 * model was last confirmed, and exits 2 when any does. It compares content,
 * not history, so a squash merge or a rebase changes nothing.
 */

let touched = false;
for (const [name, model] of Object.entries(readCoverage())) {
  const now = fingerprints(model);
  const changed = Object.keys(now).filter(
    (key) => now[key] !== model.fingerprints?.[key]
  );
  if (changed.length > 0) touched = true;
  console.log(
    changed.length > 0
      ? `${name}: TOUCHED since ${model.confirmedAt}:\n  ${changed.join("\n  ")}`
      : `${name}: unchanged since ${model.confirmedAt}`
  );
}
process.exit(touched ? 2 : 0);
