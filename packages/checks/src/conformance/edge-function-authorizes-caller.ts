// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/**
 * The gates each self-contained edge function defines for itself. Each one
 * throws for the bare anon key, which verify_jwt alone lets through: it is a
 * validly signed JWT, and the apps publish it in their HTML.
 */
const AUTH_CALL = /(?<!function\s+)\b(requireCaller|requireServiceRole)\s*\(/;

export const edgeFunctionAuthorizesCaller: ConformanceCheck = {
  id: "edge-function-authorizes-caller",
  description:
    "Every edge function authorizes its caller in-function (requireCaller / requireServiceRole).",
  provenance: {
    deprecates: "relying on verify_jwt, which accepts the published anon key",
    replacedBy: "requireCaller / requireServiceRole"
  },
  scan(file, contents) {
    const name = file.split("/").pop() ?? file;
    if (AUTH_CALL.test(contents)) return [];
    const violation: Violation = {
      file,
      line: 0,
      snippet: name,
      message:
        "No in-function authorization: verify_jwt accepts the anon key. Call requireCaller (signed-in users, API keys, servers) or requireServiceRole (servers only)."
    };
    return [violation];
  }
};
