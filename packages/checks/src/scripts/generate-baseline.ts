// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { keyOf, writeBaseline } from "../baseline";
import { collectFindings } from "../run";

collectFindings().then((findings) => {
  const keys = [...new Set(findings.map((f) => keyOf(f.checkId, f.violation)))];
  writeBaseline(keys);
  console.log(`Wrote ${keys.length} baselined conformance violations.`);
});
