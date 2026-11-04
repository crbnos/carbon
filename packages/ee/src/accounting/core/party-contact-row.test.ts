// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { partyContactRow } from "./party-contact-row";

const row = (id: string, contactEmail: string | null) => ({ id, contactEmail });

describe("partyContactRow", () => {
  it("picks the first contact with an email over earlier ones without", () => {
    expect(
      partyContactRow([row("a", null), row("b", " "), row("c", "c@x.co")])
    ).toEqual(row("c", "c@x.co"));
  });

  it("falls back to the first row when no contact has an email", () => {
    expect(partyContactRow([row("a", null), row("b", "")])).toEqual(
      row("a", null)
    );
  });

  it("returns undefined for a party with no rows", () => {
    expect(partyContactRow([])).toBeUndefined();
  });
});
