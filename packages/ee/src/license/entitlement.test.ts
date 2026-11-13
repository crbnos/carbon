// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Plan } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import {
  enforcesWithoutLicence,
  licenceAllows,
  pickLicenceNotice,
  type ResolvedLicence
} from "./entitlement";

const checkIn = (
  over: Partial<ResolvedLicence["checkIn"]>
): ResolvedLicence["checkIn"] => ({
  lastAt: null,
  status: null,
  error: null,
  seatsUsed: null,
  ...over
});
const licence = (over: Partial<ResolvedLicence> = {}): ResolvedLicence => ({
  kind: "licence",
  status: "active",
  plan: Plan.Business,
  overrides: {},
  error: null,
  licence: {
    license_id: "lic_1",
    kind: "instance",
    issued_to: "Acme",
    mode: "connected",
    issued_at: "2026-11-01T00:00:00Z",
    terminates_at: "2026-11-22T00:00:00Z",
    seats: 10
  },
  clockSuspect: false,
  checkIn: checkIn({ status: "ok", seatsUsed: 5 }),
  ...over
});
const floor = licence({
  kind: "floor",
  status: "none",
  plan: null,
  error: "missing",
  licence: null
});
const webhooks = { feature: "WEBHOOKS" } as const;

describe.each([
  ["active", licence(), true, true],
  ["expired (grace)", licence({ status: "expired" }), false, true],
  ["terminated", licence({ status: "terminated" }), false, false],
  ["none", floor, false, false]
])("a licence that is %s", (_, value, author, run) => {
  it(`${author ? "allows" : "refuses"} authoring`, () => {
    expect(licenceAllows(value, webhooks, "author")).toBe(author);
  });
  it(`${run ? "allows" : "refuses"} the feature at runtime`, () => {
    expect(licenceAllows(value, webhooks, "run")).toBe(run);
  });
});

describe("licenceAllows", () => {
  it("refuses a feature the licence plan lacks", () => {
    expect(
      licenceAllows(licence({ plan: Plan.Starter }), webhooks, "run")
    ).toBe(false);
  });

  it("lets an override grant a feature the plan lacks, and take one away", () => {
    expect(
      licenceAllows(
        licence({ plan: Plan.Starter, overrides: { WEBHOOKS: true } }),
        webhooks,
        "run"
      )
    ).toBe(true);
    expect(
      licenceAllows(
        licence({ overrides: { WEBHOOKS: false } }),
        webhooks,
        "run"
      )
    ).toBe(false);
  });

  it("compares a plan requirement with the licence plan", () => {
    expect(licenceAllows(licence(), { plan: Plan.Partner }, "run")).toBe(false);
    expect(
      licenceAllows(
        licence({ plan: Plan.Partner }),
        { plan: Plan.Partner },
        "run"
      )
    ).toBe(true);
  });
});

describe("enforcesWithoutLicence", () => {
  it("keeps access-control rules enforcing on Enterprise and Test", () => {
    expect(enforcesWithoutLicence("enterprise", "APPROVAL_RULES")).toBe(true);
    expect(enforcesWithoutLicence("test", "PERMISSIONS")).toBe(true);
  });

  it("asks the licence or plan for other features and editions", () => {
    expect(enforcesWithoutLicence("enterprise", "WEBHOOKS")).toBe(false);
    expect(enforcesWithoutLicence("cloud", "APPROVAL_RULES")).toBe(false);
    expect(enforcesWithoutLicence("community", "SALES_RULES")).toBe(false);
  });
});

describe("pickLicenceNotice", () => {
  const now = parseAbsolute("2026-11-03T00:00:00Z", "UTC");
  const pick = (value: ResolvedLicence) => pickLicenceNotice(value, now);

  it("shows nothing for a healthy licence", () => {
    expect(pick(licence())).toBeNull();
  });

  it("shows a missing licence", () => {
    expect(pick(floor)).toEqual({ reason: "none", until: null });
  });

  it("puts a terminated licence before every other notice", () => {
    expect(
      pick(licence({ status: "terminated", clockSuspect: true }))?.reason
    ).toBe("terminated");
  });

  it("gives the grace end for an expired licence", () => {
    expect(pick(licence({ status: "expired" }))).toMatchObject({
      reason: "expired",
      until: "2026-11-22T00:00:00Z"
    });
  });

  it("warns when check-ins have failed for more than 3 days", () => {
    const stale = licence({
      checkIn: checkIn({ status: "failed", seatsUsed: 5 })
    });
    expect(pick(stale)?.reason).toBeUndefined();
    expect(pickLicenceNotice(stale, now.add({ days: 2 }))?.reason).toBe(
      "check-in"
    );
  });

  it("warns about seats above the licence, then a suspect clock", () => {
    expect(
      pick(licence({ checkIn: checkIn({ status: "ok", seatsUsed: 11 }) }))
        ?.reason
    ).toBe("seats");
    expect(pick(licence({ clockSuspect: true }))?.reason).toBe("clock");
  });
});
