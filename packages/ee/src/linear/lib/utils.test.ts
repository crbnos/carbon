// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { LinearWorkStateType, mapLinearStatusToCarbonStatus } from "./utils";

describe("mapLinearStatusToCarbonStatus", () => {
  it("maps a duplicate issue to Skipped, as a canceled one", () => {
    expect(mapLinearStatusToCarbonStatus(LinearWorkStateType.Duplicate)).toBe(
      "Skipped"
    );
    expect(mapLinearStatusToCarbonStatus(LinearWorkStateType.Canceled)).toBe(
      "Skipped"
    );
  });

  it("maps started to In Progress", () => {
    expect(mapLinearStatusToCarbonStatus(LinearWorkStateType.Started)).toBe(
      "In Progress"
    );
  });
});
