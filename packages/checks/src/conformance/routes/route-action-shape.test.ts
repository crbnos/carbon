// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { routeActionShape } from "./route-action-shape";

// The plugin rule's own cases are in sources/oxlint.test.ts.
describe("routeActionShape", () => {
  it("reports the plugin's route-action-shape findings and no other rule's", () => {
    const violation = (snippet: string) => ({
      file: "apps/erp/app/routes/x+/job+/$id.tsx",
      line: 3,
      snippet,
      message: "Move it."
    });
    expect(
      routeActionShape.find({
        findings: [
          {
            checkId: "route-action-shape",
            violation: violation('client.from("job").update')
          },
          { checkId: "other-rule", violation: violation("db.updateTable") }
        ]
      })
    ).toEqual([violation('client.from("job").update')]);
  });
});
