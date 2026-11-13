// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { hash } = vi.hoisted(() => ({
  hash: { value: new Map<string, string>() as Map<string, string> | null }
}));
vi.mock("@carbon/kv", () => ({
  redis: {
    // A miss and an outage both answer empty through @carbon/kv.
    hgetall: async () => Object.fromEntries(hash.value ?? []),
    hset: async (_key: string, ...fields: string[]) => {
      for (let i = 0; i < fields.length; i += 2) {
        hash.value?.set(fields[i]!, fields[i + 1]!);
      }
      return fields.length / 2;
    }
  }
}));

import {
  EMPTY_STORED,
  readStoredLicence,
  updateStoredLicence
} from "./store.server";

beforeEach(() => {
  hash.value = new Map();
});

describe("licence store", () => {
  it("round-trips the fields it writes", async () => {
    await updateStoredLicence({ sealed: "crbn.v1.abc", licenseId: "lic_1" });
    expect(await readStoredLicence()).toEqual({
      ...EMPTY_STORED,
      sealed: "crbn.v1.abc",
      licenseId: "lic_1"
    });
  });

  it("reads a missing key as empty", async () => {
    expect(await readStoredLicence()).toEqual(EMPTY_STORED);
  });

  it("reads a field that does not parse as missing", async () => {
    hash.value?.set("sealed", "{not json");
    hash.value?.set("licenseId", JSON.stringify("lic_1"));
    expect(await readStoredLicence()).toEqual({
      ...EMPTY_STORED,
      licenseId: "lic_1"
    });
  });

  // The resolver writes state after every verify; it must never undo a
  // revocation the check-in wrote in between.
  it("keeps the fields a later write does not name", async () => {
    await updateStoredLicence({ revokedLicenseId: "lic_1", sealed: null });
    await updateStoredLicence({ state: EMPTY_STORED.state });
    expect(await readStoredLicence()).toMatchObject({
      revokedLicenseId: "lic_1",
      sealed: null
    });
  });

  it("reads an outage as empty", async () => {
    hash.value = null;
    expect(await readStoredLicence()).toEqual(EMPTY_STORED);
  });
});
