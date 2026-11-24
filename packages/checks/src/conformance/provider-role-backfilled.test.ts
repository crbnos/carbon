// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findProviderRoleDrift } from "./provider-role-backfilled";

const config = (id: string, role?: string) => ({
  file: `packages/ee/src/${id}/config.tsx`,
  contents: `export const X = defineIntegration({
  name: "X",
  id: "${id}",${role ? `\n  providerRole: "${role}" as const,` : ""}
  active: true
});`
});

const migration = (file: string, sql: string) => ({ file, contents: sql });

const drift = (...args: Parameters<typeof findProviderRoleDrift>) =>
  findProviderRoleDrift(...args).map((v) => v.snippet);

describe("findProviderRoleDrift", () => {
  it("accepts roles set by IN lists and by equality, across migrations", () => {
    expect(
      drift(
        [
          config("xero", "accounting"),
          config("quickbooks", "accounting"),
          config("sense", "oee")
        ],
        [
          migration(
            "1_role.sql",
            `UPDATE "integration" SET "providerRole" = 'accounting'
  WHERE id IN ('xero', 'quickbooks')
    AND "providerRole" IS DISTINCT FROM 'accounting';`
          ),
          migration(
            "2_oee.sql",
            `UPDATE "integration" SET "providerRole" = 'oee'
  WHERE "id" = 'sense' AND "providerRole" IS DISTINCT FROM 'oee';`
          )
        ]
      )
    ).toEqual([]);
  });

  it("flags a declared role that no migration stored", () => {
    expect(drift([config("netsuite", "accounting")], [])).toEqual([
      "netsuite: accounting declared, NULL stored"
    ]);
  });

  it("reads the latest migration's role, not the first", () => {
    expect(
      drift(
        [config("ramp", "accounting")],
        [
          migration(
            "1.sql",
            `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id = 'ramp';`
          ),
          migration(
            "2.sql",
            `UPDATE "integration" SET "providerRole" = 'spend' WHERE id = 'ramp';`
          )
        ]
      )
    ).toEqual(["ramp: accounting declared, spend stored"]);
  });

  it("flags a stored role whose config declares none", () => {
    expect(
      drift(
        [config("ramp")],
        [
          migration(
            "1.sql",
            `UPDATE "integration" SET "providerRole" = 'spend' WHERE id = 'ramp';`
          )
        ]
      )
    ).toEqual(["ramp: spend stored, none declared"]);
  });
  it("does not read the id of an IS DISTINCT FROM test as the integration set", () => {
    expect(
      drift(
        [config("xero", "accounting")],
        [
          migration(
            "1_role.sql",
            `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id IS DISTINCT FROM 'xero';`
          )
        ]
      )
    ).toEqual(["xero: accounting declared, NULL stored"]);
  });

  it("reads only a constant role set on integration, for the ids the WHERE names", () => {
    const decoys = [
      `UPDATE "otherTable" SET "providerRole" = 'accounting' WHERE id = 'xero';`,
      `UPDATE "integration" SET "providerRole" = 'accounting' WHERE "name" = 'xero';`,
      `UPDATE "integration" SET "providerRole" = lower('ACCOUNTING') WHERE id = 'xero';`,
      `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id <> 'xero';`,
      `UPDATE "integration" SET "providerRole" = 'accounting' WHERE id NOT IN ('xero');`
    ];
    expect(
      drift(
        [config("xero", "accounting")],
        [migration("1_role.sql", decoys.join("\n"))]
      )
    ).toEqual(["xero: accounting declared, NULL stored"]);
  });
});
