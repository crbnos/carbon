// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Edition } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { isIntegrationComingSoon } from "./plan";

const internalOnly = { id: "cad", internalOnly: true };
const customer = "buyer@example.com";

describe("isIntegrationComingSoon", () => {
  it("withholds an internal-only integration from a customer on Cloud", () => {
    expect(
      isIntegrationComingSoon(internalOnly, {
        edition: Edition.Cloud,
        email: customer
      })
    ).toBe(true);
  });

  it("offers it to Carbon staff on Cloud, whatever the casing", () => {
    for (const email of [
      "staff@carbon.ms",
      "Staff@Carbon.MS",
      "a@carbon.us.org"
    ]) {
      expect(
        isIntegrationComingSoon(internalOnly, { edition: Edition.Cloud, email })
      ).toBe(false);
    }
  });

  it("withholds it when the email is unknown", () => {
    expect(
      isIntegrationComingSoon(internalOnly, {
        edition: Edition.Cloud,
        email: null
      })
    ).toBe(true);
  });

  it("does not gate a self-hosted edition", () => {
    for (const edition of [
      Edition.Enterprise,
      Edition.Community,
      Edition.Test
    ]) {
      expect(
        isIntegrationComingSoon(internalOnly, { edition, email: customer })
      ).toBe(false);
    }
  });

  it("does not gate an integration that is not internal-only", () => {
    expect(
      isIntegrationComingSoon(
        { id: "cad" },
        {
          edition: Edition.Cloud,
          email: customer
        }
      )
    ).toBe(false);
  });
});
