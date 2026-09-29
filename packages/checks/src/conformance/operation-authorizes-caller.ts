import type { ConformanceCheck, Violation } from "../check";

const GATE = /\b(assertOperationPermissions|assertSystemCaller)\s*\(/;

/**
 * Every `@carbon/operations` entry point checks its caller before touching data.
 * Operations are called from routes, services, the public API and jobs, and
 * those callers do not all check the permission the operation needs — the edge
 * function each one replaces checked in-function too (`requirePermissions`),
 * and the port must not lose that.
 */
export const operationAuthorizesCaller: ConformanceCheck = {
  id: "operation-authorizes-caller",
  description:
    "Every operation checks its caller in-operation (assertOperationPermissions / assertSystemCaller).",
  provenance: {
    deprecates: "trusting the caller's own permission check",
    replacedBy: "assertOperationPermissions / assertSystemCaller"
  },
  scan(file, contents) {
    if (GATE.test(contents)) return [];
    const name = file.split("/").pop() ?? file;
    const violation: Violation = {
      file,
      line: 0,
      snippet: name,
      message:
        "No caller check: call assertOperationPermissions(ctx, { <action>: <module> }) before touching data, or assertSystemCaller(ctx) when only servers call it."
    };
    return [violation];
  }
};
