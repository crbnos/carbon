// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";

// Readers for the files the cross-file checks compare, so each check stays a
// pure function of its inputs.

export const read = (root: string, file: string): SourceFile => ({
  file,
  contents: readFileSync(join(root, file), "utf8")
});

export const readIfPresent = (root: string, files: string[]): SourceFile[] =>
  files
    .filter((file) => existsSync(join(root, file)))
    .map((f) => read(root, f));

/** Each integration descriptor: `packages/ee/src/<id>/config.ts(x)`. */
export function loadIntegrationConfigs(root: string): SourceFile[] {
  const dir = "packages/ee/src";
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name }) =>
      readIfPresent(root, [
        `${dir}/${name}/config.tsx`,
        `${dir}/${name}/config.ts`
      ])
    );
}

const EVENT_FUNCTIONS_DIR = "packages/database/src/event-system/functions";

/** The event-system functions and the audit config, for `event-ignored-columns`. */
export function loadEventFunctionSources(root: string) {
  return {
    functions: readdirSync(join(root, EVENT_FUNCTIONS_DIR))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => read(root, `${EVENT_FUNCTIONS_DIR}/${file}`)),
    auditConfig: read(root, "packages/database/src/audit.config.ts")
  };
}

const SCHEDULED = "packages/jobs/src/inngest/functions/scheduled";

/**
 * pg_cron wakes a scheduled function only when its `util.*_has_work()` says a
 * run would do something, and that SQL repeats the function's constants. A
 * constant changed on one side only either wakes the function for nothing or
 * leaves work undone. `{NAME}` is the constant's value; a string array is
 * written as SQL literals, `'a', 'b'`. Read by `scheduled-sql-constants`.
 */
export const SCHEDULED_WORK_CHECKS = [
  {
    fn: "util.notification_digest_has_work",
    constants: `${SCHEDULED}/notification-digest.ts`,
    expected: [
      "c.total >= {DIGEST_THRESHOLD}",
      "interval '{DIGEST_MIN_AGE_MIN} minutes'"
    ]
  },
  {
    fn: "util.workflow_run_retention_has_work",
    constants: `${SCHEDULED}/workflow-run-retention.ts`,
    expected: [
      "interval '{STALE_RUN_HOURS} hours'",
      "interval '{FULL_DETAIL_DAYS} days'",
      "interval '{COMPACT_DETAIL_DAYS} days'",
      "interval '{RUN_HEADER_DAYS} days'",
      "IN ({TERMINAL})"
    ]
  }
];

/** The constants file of each `SCHEDULED_WORK_CHECKS` entry that exists. */
export function loadScheduledConstantSources(root: string): SourceFile[] {
  return readIfPresent(
    root,
    SCHEDULED_WORK_CHECKS.map(({ constants }) => constants)
  );
}

/** The three files `document-sequence-synced` compares. */
export type DocumentSequenceSources = {
  seedData: SourceFile;
  attachments: SourceFile;
  interceptor: SourceFile;
};

export function loadDocumentSequenceSources(
  root: string
): DocumentSequenceSources {
  return {
    seedData: read(root, "packages/database/src/seed-data.ts"),
    attachments: read(
      root,
      "packages/database/src/event-system/attachments.ts"
    ),
    interceptor: read(
      root,
      "packages/database/src/event-system/handlers/sync_advance_document_sequence.sql"
    )
  };
}
