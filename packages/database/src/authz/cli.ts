import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { loadEnv } from "../datasets/cli";
import { loadHelpers } from "./helpers";
import { renderMigration, unshipped } from "./migration";
import { syncAuthz } from "./sync";

// pnpm --filter @carbon/database authz <check|sync|migration <name>>
//   check             report what sync would change (reads only)
//   sync              make the database match manifest.ts and helpers/
//   migration <name>  write a migration shipping every rule and helper production does
//                     not have yet (see migration.ts; migration.test.ts fails until it does)
async function main() {
  const command = process.argv[2];
  if (command === "migration") {
    const name = process.argv[3];
    if (!name) {
      console.error("usage: authz migration <name>");
      process.exit(2);
    }
    const { manifest } = await import("./manifest");
    const helpers = await loadHelpers();
    const todo = await unshipped(manifest, helpers);
    if (todo.problems.length)
      throw new Error(
        `authz migration: fix these first:\n${todo.problems.join("\n")}`
      );
    if (!todo.tables.length && !todo.helpers.length) {
      console.log("authz: production already has every rule and helper");
      return;
    }
    const sql = await renderMigration(
      manifest,
      helpers.filter((h) => todo.helpers.includes(h.name)),
      todo.tables
    );
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      ".."
    );
    const created = execFileSync(
      "pnpm",
      ["exec", "supabase", "migration", "new", name],
      { cwd: root, encoding: "utf8" }
    );
    const file = /supabase\/migrations\/\S+\.sql/.exec(created)?.[0];
    if (!file)
      throw new Error(
        `authz migration: could not find the new file in: ${created}`
      );
    writeFileSync(path.join(root, file), sql);
    console.log(
      `authz: wrote ${file} (${[...todo.helpers, ...todo.tables].join(", ")})`
    );
    return;
  }

  if (!["check", "sync"].includes(command ?? "")) {
    console.error("usage: authz <check|sync|migration <name>>");
    process.exit(2);
  }

  loadEnv();
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set SUPABASE_DB_URL (or DATABASE_URL).");
    process.exit(2);
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const { manifest } = await import("./manifest");
    const result = await syncAuthz(db, manifest, {
      dryRun: command === "check"
    });
    const verb = command === "check" ? "would change" : "changed";
    console.log(`authz: ${verb} ${result.helpers.length} helper(s)`);
    for (const name of result.helpers) console.log(`  ${name}`);
    console.log(`authz: ${verb} ${result.changed.length} table(s)`);
    for (const table of result.changed) console.log(`  ${table}`);
    if (result.unmanaged.length) {
      console.error(
        `authz: tables with no rule in manifest.ts (left as they are):\n${result.unmanaged
          .map((t) => `  ${t}`)
          .join("\n")}`
      );
      process.exit(1);
    }
    // 3, not 1: CI tells "the database differs from the manifest" apart from a failure.
    if (
      command === "check" &&
      (result.changed.length || result.helpers.length)
    ) {
      process.exit(3);
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
