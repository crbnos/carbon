// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Check, Provenance } from "./check";
import { CHECKS } from "./checks";
import {
  citedShas,
  expectsFinding,
  provenanceProblems,
  testCases
} from "./provenance";

const CONFORMANCE = join(__dirname, "conformance");

/**
 * Checks written before a check had to name the fix it encodes. Their tests
 * replay no past bug by sha, and no sha is invented for them here. The list
 * only shrinks: a check leaves it when its provenance gains `incidents`, and
 * a new check never joins it — it ships with the fix it was built from. The
 * nine checks main gained while this rule was in review joined it once, at the
 * merge, as the checks before them did.
 */
const UNPROVEN_CHECKS = new Set([
  "account-fk-classified",
  "account-fk-restrict",
  "deployments-set-required-env",
  "document-sequence-synced",
  "edge-function-authorizes-caller",
  "event-ignored-columns",
  "form-field-budget",
  "function-redefinition-keeps-changes",
  "index-redirect-before-loaders",
  "journal-status-filter",
  "lingui-macro-misuse",
  "list-select-covers-columns",
  "loader-reads-through-api",
  "mes-unit-write-resolves-unit",
  "module-shape",
  "moved-tables-covered",
  "no-authz-ddl-in-migrations",
  "no-bare-outlet",
  "no-db-client-in-service",
  "no-default-on-effects",
  "no-derived-percent-column",
  "no-duplicated-app-file",
  "no-foreign-key-without-on-delete",
  "no-inline-fraction-digits",
  "no-inline-sensor-options",
  "no-inline-unique-violation",
  "no-integration-id-branching",
  "no-interpolated-error-log",
  "no-legacy-rls",
  "no-local-timezone",
  "no-missing-audit-column",
  "no-module-permission-key",
  "no-noop-open-change",
  "no-numeric-precision",
  "no-postgres-changes",
  "no-raw-forwarded-headers",
  "no-raw-or-search",
  "no-raw-redirect",
  "no-raw-revalidator",
  "no-raw-rounding",
  "no-required-column-without-default",
  "no-server-code-in-client",
  "no-silent-test-pass",
  "no-state-copy-of-loader-data",
  "no-unguarded-submit",
  "no-unmounting-dialog",
  "no-unrounded-tracked-quantity",
  "no-unscoped-kysely-write",
  "no-view-without-invoker",
  "no-zero-concurrency",
  "offline-page-cache-bumped",
  "provider-role-backfilled",
  "registry-helpers-fresh",
  "route-action-shape",
  "route-gate-names-page",
  "route-maps-to-page",
  "scheduled-sql-constants",
  "service-fn-file",
  "side-effect-import-declared",
  "spdx-license-header",
  "stamp-matches-columns",
  "test-mocks-own-module",
  "test-reads-source"
]);

// The size the list was frozen at. Lower it when a check leaves; raising it
// lets an unproven check in, which is what this test exists to stop. It went
// from 61 to 63 once, when checks began to be read from the registry: the list
// had been built from file names, which hid `account-fk-classified` (it shares
// one file with `account-fk-restrict`) and `route-action-shape` (a lint plugin). Both
// predate this rule.
const UNPROVEN_CEILING = 63;

const isCheck = (value: unknown): value is Check =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "find" in value &&
  typeof value.find === "function";

/**
 * Every check a `conformance/` module exports, with that module's file: a
 * module may hold several checks, and they share its test file.
 */
const exported = (
  await Promise.all(
    readdirSync(CONFORMANCE)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map(async (file) => {
        const module: Record<string, unknown> = await import(
          `./conformance/${file}`
        );
        return Object.values(module)
          .filter(isCheck)
          .map((check) => ({ check, file }));
      })
  )
).flat();

describe("every registered check proves itself on the fix it encodes", () => {
  const ids = exported.map(({ check }) => check.id).sort();

  it("registers every check a module exports, once", () => {
    expect(CHECKS.map((check) => check.id).sort()).toEqual(ids);
  });

  it.each(exported.map((entry) => [entry.check.id, entry] as const))(
    "%s",
    (id, { check, file }) => {
      const testFile = file.replace(/\.ts$/, ".test.ts");
      const testPath = join(CONFORMANCE, testFile);
      const problems = provenanceProblems({
        id,
        provenance: check.provenance ?? null,
        testSource: existsSync(testPath)
          ? readFileSync(testPath, "utf8")
          : null,
        testFile,
        siblingIncidents: exported
          .filter((other) => other.file === file && other.check !== check)
          .flatMap((other) => other.check.provenance?.incidents ?? []),
        unproven: UNPROVEN_CHECKS.has(id)
      });
      expect(problems).toEqual([]);
    }
  );

  it("lists only registered checks as unproven, and never more of them", () => {
    expect([...UNPROVEN_CHECKS].filter((id) => !ids.includes(id))).toEqual([]);
    expect(UNPROVEN_CHECKS.size).toBeLessThanOrEqual(UNPROVEN_CEILING);
  });
});

describe("provenanceProblems", () => {
  const PROVENANCE: Provenance = {
    deprecates: "x",
    replacedBy: "y",
    incidents: ["de82a88cc6"]
  };
  const REPLAY = `const DE82A88CC6_PARENT = "…";
it("flags the code from before de82a88cc6", () => {
  expect(scan(DE82A88CC6_PARENT)).toEqual(["lock: period.status"]);
});
it("passes the de82a88cc6 fix", () => {
  expect(scan(FIX)).toEqual([]);
});`;
  const input = { id: "c", provenance: PROVENANCE, unproven: false };

  it("passes a check whose test replays each declared fix", () => {
    expect(provenanceProblems({ ...input, testSource: REPLAY })).toEqual([]);
  });

  it("names the fix a test cites but provenance does not declare", () => {
    expect(
      provenanceProblems({
        ...input,
        provenance: { ...PROVENANCE, incidents: [] },
        testSource: REPLAY
      })
    ).toEqual([
      "c declares no provenance.incidents: name the commit of the past fix it encodes, and replay its parent revision in c.test.ts (a new check cannot join UNPROVEN_CHECKS)"
    ]);
    expect(
      provenanceProblems({
        ...input,
        provenance: { ...PROVENANCE, incidents: ["2c9ef0dd8f"] },
        testSource: `${REPLAY}\n// 2c9ef0dd8f\nit("flags 2c9ef0dd8f", () => { expect(x).toHaveLength(1); });`
      })
    ).toEqual([
      "c: c.test.ts replays de82a88cc6, which provenance.incidents does not declare — add the fix to incidents"
    ]);
  });

  it("fails a declared fix whose only case expects nothing", () => {
    const passesOnly = `it("passes the de82a88cc6 fix", () => {
  expect(scan(FIX)).toEqual([]);
});`;
    expect(provenanceProblems({ ...input, testSource: passesOnly })).toEqual([
      "c: no case in c.test.ts names de82a88cc6 and expects a finding — replay the code from before de82a88cc6 (git show de82a88cc6^:<file>) and assert the check flags it"
    ]);
  });

  it("fails a declared fix the test never names, and a missing test", () => {
    expect(
      provenanceProblems({ ...input, testSource: "it('x', () => {});" })
    ).toEqual([
      "c: c.test.ts never names de82a88cc6, the fix provenance.incidents declares"
    ]);
    expect(provenanceProblems({ ...input, testSource: null })).toEqual([
      "c has no c.test.ts to replay de82a88cc6"
    ]);
  });

  it("leaves a fix another check of the module declares to that check", () => {
    expect(
      provenanceProblems({
        ...input,
        provenance: null,
        unproven: true,
        testSource: REPLAY,
        siblingIncidents: ["de82a88cc6"]
      })
    ).toEqual([]);
  });

  it("sends an unproven check that gained a fix off the list", () => {
    expect(
      provenanceProblems({ ...input, unproven: true, testSource: REPLAY })
    ).toEqual([
      "c is on UNPROVEN_CHECKS but its provenance or test names a fix (de82a88cc6): declare it in provenance.incidents and remove c from the list"
    ]);
  });
});

describe("test file reading", () => {
  it("cites a sha only when it mixes letters and digits", () => {
    expect(
      citedShas("de82a88cc6 1234567890 abcdefabcd 2c9ef0dd8f de82a88cc6")
    ).toEqual(["de82a88cc6", "2c9ef0dd8f"]);
  });

  it("reads each case whole, nested calls included", () => {
    expect(
      testCases(`describe("d", () => {
  it("a (x)", () => { expect(f(1)).toBe(2); });
  it.each([1])("b %s", (n) => {});
});`)
    ).toEqual([
      '("a (x)", () => { expect(f(1)).toBe(2); })',
      '("b %s", (n) => {})'
    ]);
  });

  it("counts any assertion except an empty result as a finding", () => {
    expect(expectsFinding("expect(scan(a)).toEqual([])")).toBe(false);
    expect(expectsFinding("expect(scan(a)).toHaveLength(0)")).toBe(false);
    expect(expectsFinding("expect(scan(a)).not.toHaveLength(0)")).toBe(true);
    expect(expectsFinding('expect(snippets(a)).toEqual(["f: t.c"])')).toBe(
      true
    );
  });
});
