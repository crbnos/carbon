// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { loadEdgeFunctions } from "../../sources/edge-functions";

// Who may do what: access decisions stay where they are authored. An edge
// function authorizes its caller itself, with one of the gates each
// self-contained function defines: each throws for the bare anon key, which
// verify_jwt alone lets through (it is a validly signed JWT, and the apps
// publish it in their HTML).
//
// A function passes only when it calls one of them; the declaration alone
// does not count. The call may be in any of the function's own `.ts` files
// (see `loadEdgeFunctions`).
export const edgeFunctionAuthorizesCaller = defineCheck({
  files: loadEdgeFunctions,
  id: "edge-function-authorizes-caller",
  description:
    "Every edge function authorizes its caller in-function (requireCaller / requireServiceRole).",
  provenance: {
    deprecates: "relying on verify_jwt, which accepts the published anon key",
    replacedBy: "requireCaller / requireServiceRole"
  },
  rule() {
    const authCall =
      /(?<!function\s+)\b(requireCaller|requireServiceRole)\s*\(/;
    return (file, contents) => {
      if (authCall.test(contents)) return [];
      return [
        {
          file,
          line: 0,
          snippet: file.split("/").pop() ?? file,
          message:
            "No in-function authorization: verify_jwt accepts the anon key. Call requireCaller (signed-in users, API keys, servers) or requireServiceRole (servers only)."
        }
      ];
    };
  }
});
