// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { attachments } from "./attachments";
import {
  liveAttachments,
  renderAttachment,
  renderDetachment,
  renderFor,
  syncAttachments
} from "./attachments-sync";

describe("rendering an attachment", () => {
  test("is one set_event_triggers call with every list spelled out", () => {
    expect(
      renderAttachment("customer", {
        before: ["a"],
        after: ["b", "c"],
        events: true,
        statement: ["z", "y"]
      })
    ).toBe(
      "SELECT set_event_triggers('customer', ARRAY['a']::text[], ARRAY['b', 'c']::text[], true, ARRAY['y', 'z']::text[]);"
    );
  });

  test("a table without an entry is detached", () => {
    expect(renderFor({}, "customer")).toBe(renderDetachment("customer"));
    expect(renderDetachment("customer")).toBe(
      "SELECT set_event_triggers('customer');"
    );
  });
});

// Runs against the local database: SUPABASE_DB_URL=… pnpm vitest run src/event-system
const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)("attachments against a migrated database", () => {
  const db = new Client({ connectionString: url });

  const definitions = async () =>
    (
      await db.query<{ definition: string }>(
        `SELECT pg_get_triggerdef(t.oid) AS definition
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg\\_event\\_%'
          ORDER BY c.relname, t.tgname`
      )
    ).rows.map((row) => row.definition);

  beforeAll(async () => {
    await db.connect();
    await db.query("BEGIN");
  });

  afterAll(async () => {
    await db.query("ROLLBACK");
    await db.end();
  });

  test("the database already has exactly what attachments.ts declares", async () => {
    expect(await syncAttachments(db, attachments, { dryRun: true })).toEqual(
      []
    );
  });

  test("re-applying every entry recreates each trigger with the same definition", async () => {
    const before = await definitions();
    for (const table of Object.keys(attachments)) {
      await db.query(renderFor(attachments, table));
    }
    expect(await definitions()).toEqual(before);
  });

  test("sync detaches a table that has no entry, and heals a missing trigger", async () => {
    const { customer: _, ...rest } = attachments;
    expect(await syncAttachments(db, rest, { dryRun: false })).toEqual([
      "customer"
    ]);
    expect((await liveAttachments(db)).has("customer")).toBe(false);

    expect(await syncAttachments(db, attachments, { dryRun: false })).toEqual([
      "customer"
    ]);
    await db.query(
      `DROP TRIGGER "trg_event_statement_broadcast_table_changes_upd" ON "customer"`
    );
    // A handler with one of its three triggers missing is still listed, so
    // the full definitions are what prove the heal.
    await db.query(renderFor(attachments, "customer"));
    expect(await syncAttachments(db, attachments, { dryRun: true })).toEqual(
      []
    );
  });
});
