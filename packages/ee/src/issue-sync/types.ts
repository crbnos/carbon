// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";

/** The issue trackers a synced record can link to. */
export type IssueTracker = "linear" | "jira";

/** The Carbon tables whose rows can link to an issue. */
export type SyncedEntityType =
  | "nonConformanceActionTask"
  | "changeOrderActionTask";

/** The tracker-neutral fields the sync compares and copies. */
export type SyncedField =
  | "title"
  | "description"
  | "status"
  | "assignee"
  | "priority"
  | "dueDate";

/** Values of the synced fields, each as a string or null. */
export type FieldValues = Partial<Record<SyncedField, string | null>>;

/**
 * One field of the sync snapshot: what the last sync agreed on. `carbon` is
 * Carbon's canonical value, `remote` the tracker's raw value. Keeping both is
 * the echo guard: a write raises an event whose row equals `carbon`.
 */
export const SnapshotValueSchema = z.object({
  carbon: z.string().nullable(),
  remote: z.string().nullable()
});

export type SnapshotValue = z.infer<typeof SnapshotValueSchema>;

/** `metadata.sync` on a link (`externalIntegrationMapping`). */
export const LinkSyncSchema = z.object({
  values: z.record(z.string(), SnapshotValueSchema).default({}),
  refused: z
    .object({
      at: z.string(),
      fields: z.array(z.string()),
      reason: z.string()
    })
    .nullish()
});

export type LinkSync = z.infer<typeof LinkSyncSchema>;
