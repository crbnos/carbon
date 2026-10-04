// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Client } from "pg";
import type { Attachment, Attachments } from "./attachments";

/**
 * Makes a database's event triggers match attachments.ts, through
 * `set_event_triggers` — the same call a generated migration ships. Runs inside
 * the authz transaction, after the functions it attaches have been synced.
 */

type Resolved = {
  before: string[];
  after: string[];
  events: boolean;
  statement: string[];
};

const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const array = (names: readonly string[]) =>
  `ARRAY[${names.map(literal).join(", ")}]::text[]`;

// Statement handlers have no order of their own (Postgres fires same-kind
// triggers by name), so they are compared and written sorted.
const resolve = (attachment: Attachment): Resolved => ({
  before: [...(attachment.before ?? [])],
  after: [...(attachment.after ?? [])],
  events: attachment.events ?? false,
  statement: [...(attachment.statement ?? [])].sort()
});

/** The one statement that gives `table` exactly this attachment. */
export const renderAttachment = (table: string, attachment: Attachment) => {
  const { before, after, events, statement } = resolve(attachment);
  return `SELECT set_event_triggers(${literal(table)}, ${array(before)}, ${array(after)}, ${events}, ${array(statement)});`;
};

/** The statement for a table that is no longer in the manifest. */
export const renderDetachment = (table: string) =>
  `SELECT set_event_triggers(${literal(table)});`;

/** The statement for `table`: its attachment, or a detachment if it has none. */
export const renderFor = (attachments: Attachments, table: string) => {
  const attachment = (attachments as Record<string, Attachment>)[table];
  return attachment
    ? renderAttachment(table, attachment)
    : renderDetachment(table);
};

/** Every public table's event triggers, as the database has them now. */
export async function liveAttachments(db: Client) {
  const { rows } = await db.query<{ table: string } & Resolved>(
    `SELECT c.relname AS "table",
            coalesce((SELECT array_remove(string_to_array(encode(t.tgargs, 'escape'), E'\\\\000'), '')
               FROM pg_trigger t
              WHERE t.tgrelid = c.oid AND t.tgname = 'trg_event_sync_' || c.relname), '{}') AS before,
            coalesce((SELECT array_remove(string_to_array(encode(t.tgargs, 'escape'), E'\\\\000'), '')
               FROM pg_trigger t
              WHERE t.tgrelid = c.oid AND t.tgname = 'trg_event_after_sync_' || c.relname), '{}') AS after,
            (SELECT count(*) = 3 FROM pg_trigger t
              WHERE t.tgrelid = c.oid AND t.tgname LIKE 'trg\\_event\\_async\\_%') AS events,
            coalesce((SELECT array_agg(p.proname::text ORDER BY p.proname)
               FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid = c.oid AND t.tgname LIKE 'trg\\_event\\_statement\\_%\\_ins'), '{}') AS statement
       FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                       AND t.tgname LIKE 'trg\\_event\\_%')`
  );
  return new Map(rows.map(({ table, ...live }) => [table, live]));
}

/**
 * Give every table the triggers its entry declares, and remove the event
 * triggers of a table that has no entry. Returns the tables that differed.
 */
export async function syncAttachments(
  db: Client,
  attachments: Attachments,
  { dryRun }: { dryRun: boolean }
): Promise<string[]> {
  const live = await liveAttachments(db);
  const declared = attachments as Record<string, Attachment>;
  const tables = [
    ...new Set([...Object.keys(declared), ...live.keys()])
  ].sort();
  const changed: string[] = [];
  for (const table of tables) {
    const want = resolve(declared[table] ?? {});
    const have = live.get(table) ?? resolve({});
    if (JSON.stringify(want) === JSON.stringify(have)) continue;
    changed.push(table);
    if (!dryRun) await db.query(renderFor(attachments, table));
  }
  return changed;
}
