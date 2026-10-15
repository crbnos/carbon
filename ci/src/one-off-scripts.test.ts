// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverOneOffScripts,
  ONE_OFF_SCRIPT_DEFERRED,
  oneOffScriptEnv,
  oneOffScriptOutcome,
  selectPendingScripts,
  supavisorUrl
} from "./one-off-scripts";

function withFiles<T>(names: string[], fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "one-off-"));
  try {
    for (const name of names) writeFileSync(join(dir, name), "");
    return fn(`${dir}/`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("discovers kebab-case scripts in a stable order, with absolute paths", () => {
  withFiles(["b-second.ts", "a-first.ts", "README.md"], (dir) => {
    const scripts = discoverOneOffScripts(dir);
    assert.deepEqual(
      scripts.map((s) => s.name),
      ["a-first", "b-second"]
    );
    assert.ok(scripts.every((s) => s.path.startsWith("/")));
    assert.ok(scripts.every((s) => s.path.endsWith(".ts")));
  });
});

// The blocker this guard exists for: `scripts/lib/` colocates `*.test.ts` with
// its sources, so a dev following that convention here would otherwise ship a
// test file that runs against every production database.
test("refuses a colocated test file rather than running it", () => {
  withFiles(["migrate-thing.ts", "migrate-thing.test.ts"], (dir) => {
    assert.throws(
      () => discoverOneOffScripts(dir),
      /migrate-thing\.test\.ts/,
      "a .test.ts file must be refused, never discovered as a script"
    );
  });
});

test("refuses any other unrecognised file rather than silently skipping it", () => {
  for (const name of ["notes.txt", "helper.d.ts", "Thing.ts", "with_underscore.ts"]) {
    withFiles(["migrate-thing.ts", name], (dir) => {
      assert.throws(
        () => discoverOneOffScripts(dir),
        new RegExp(name.replace(/[.]/g, "\\.")),
        `${name} must be refused`
      );
    });
  }
});

test("a README-only folder yields no scripts", () => {
  withFiles(["README.md"], (dir) => {
    assert.deepEqual(discoverOneOffScripts(dir), []);
  });
});

function ledgerStub(
  rows: { name: string }[] | null,
  error: { message: string } | null = null
) {
  return {
    from: () => ({ select: () => ({ in: async () => ({ data: rows, error }) }) })
  } as unknown as Parameters<typeof selectPendingScripts>[0];
}

const SCRIPTS = [
  { name: "a", path: "/tmp/a.ts" },
  { name: "b", path: "/tmp/b.ts" }
];

test("selects only the scripts with no ledger row", async () => {
  assert.deepEqual(
    (await selectPendingScripts(ledgerStub([{ name: "a" }]), SCRIPTS)).map(
      (s) => s.name
    ),
    ["b"]
  );
  assert.equal(
    (await selectPendingScripts(ledgerStub([]), SCRIPTS)).length,
    2
  );
  assert.equal(
    (
      await selectPendingScripts(
        ledgerStub([{ name: "a" }, { name: "b" }]),
        SCRIPTS
      )
    ).length,
    0
  );
});

// An unreadable ledger means we cannot tell what has already run. Re-running
// blind is how a non-idempotent script corrupts a production database.
test("throws when the ledger cannot be read, rather than re-running everything", async () => {
  await assert.rejects(
    () => selectPendingScripts(ledgerStub(null, { message: "no relation" }), SCRIPTS),
    /no relation/
  );
});

test("does not query the ledger when there are no scripts", async () => {
  const exploding = {
    from: () => assert.fail("must not query the ledger for an empty script list")
  } as unknown as Parameters<typeof selectPendingScripts>[0];
  assert.deepEqual(await selectPendingScripts(exploding, []), []);
});

test("reads a script's exit code as completed, deferred or failed", () => {
  assert.equal(oneOffScriptOutcome(0), "completed");
  assert.equal(oneOffScriptOutcome(ONE_OFF_SCRIPT_DEFERRED), "deferred");
  assert.equal(oneOffScriptOutcome(1), "failed");
  // Killed by a signal: no exit code.
  assert.equal(oneOffScriptOutcome(undefined), "failed");
});

test("passes a script the Postgres URL and not the database password", () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_DB_PASSWORD: "secret"
  };
  assert.deepEqual(
    oneOffScriptEnv(env, {
      poolerUrl: "postgresql://pooler",
      connectionString: null
    }),
    {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_DB_URL: "postgresql://pooler"
    }
  );
  assert.equal(
    oneOffScriptEnv(env, {
      poolerUrl: null,
      connectionString: "postgresql://self-hosted"
    }).SUPABASE_DB_URL,
    "postgresql://self-hosted"
  );
  // Neither: no URL, and the script that needs one defers.
  assert.equal(
    oneOffScriptEnv(env, { poolerUrl: null, connectionString: "db.example" })
      .SUPABASE_DB_URL,
    undefined
  );
});

test("builds the IPv4 Supavisor URL of the primary database", () => {
  const pooler = {
    db_user: "postgres.abcdef",
    db_host: "aws-0-us-east-1.pooler.supabase.com",
    db_port: 6543,
    db_name: "postgres"
  };
  assert.equal(
    supavisorUrl(
      [
        { ...pooler, database_type: "READ_REPLICA", db_host: "replica" },
        { ...pooler, database_type: "PRIMARY" }
      ],
      "p@ss/word"
    ),
    "postgresql://postgres.abcdef:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
  );
  assert.equal(
    supavisorUrl([{ ...pooler, database_type: "READ_REPLICA" }], "x"),
    null
  );
});

// The runner records nothing for a deferred script and does not fail the
// deploy, so a workspace with no Postgres URL retries it on a later deploy.
test("journal-legacy-documents defers when it has no Postgres URL", () => {
  const script = fileURLToPath(
    new URL("../../scripts/one-off/journal-legacy-documents.ts", import.meta.url)
  );
  const cwd = mkdtempSync(join(tmpdir(), "one-off-env-"));
  try {
    const { SUPABASE_DB_URL: _url, ...env } = process.env;
    const result = spawnSync("tsx", [script, "--dry-run"], {
      cwd,
      env,
      encoding: "utf8"
    });
    assert.equal(result.status, ONE_OFF_SCRIPT_DEFERRED, result.stderr);
    assert.match(result.stderr, /deferred/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
