// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

const DEFINITION = /\bdefineServerFn\s*\(/;

/**
 * Every `@carbon/server-functions` entry point is built with `defineServerFn`,
 * whose required `permissions` field is the caller check. Server functions
 * bypass RLS and are called from routes, services, the public API and jobs,
 * which do not all check the permission the function needs.
 */
export const serverFnAuthorizesCaller: ConformanceCheck = {
  id: "server-fn-authorizes-caller",
  description:
    "Every server function is built with defineServerFn, which declares the permissions its caller needs.",
  provenance: {
    deprecates: "trusting the caller's own permission check",
    replacedBy: "defineServerFn({ permissions })"
  },
  scan(file, contents) {
    if (DEFINITION.test(contents)) return [];
    const violation: Violation = {
      file,
      line: 0,
      snippet: file.split("/").pop() ?? file,
      message:
        'Not a server function: build the export with defineServerFn({ name, input, permissions, run }) — permissions is the caller check ("system" when only servers call it).'
    };
    return [violation];
  }
};
