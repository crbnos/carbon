// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { maintenanceVerdict } from "./maintenance.server";

describe("maintenanceVerdict", () => {
  it("lets every request through when maintenance is off", () => {
    expect(maintenanceVerdict(false, "/x/sales")).toBeNull();
    expect(maintenanceVerdict(false, "/health")).toBeNull();
  });

  it("keeps the health check passing during maintenance", () => {
    expect(maintenanceVerdict(true, "/health")).toBe("healthy");
  });

  it("keeps serving Auth's email templates during maintenance", () => {
    expect(maintenanceVerdict(true, "/templates/magic-link.html")).toBeNull();
  });

  it("refuses pages, the API, webhooks and job callbacks", () => {
    for (const pathname of [
      "/",
      "/x/sales",
      "/api/v1/items",
      "/api/webhook/stripe",
      "/api/inngest",
      "/health/deep"
    ]) {
      expect(maintenanceVerdict(true, pathname)).toBe("refuse");
    }
  });
});
