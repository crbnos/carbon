// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";

/**
 * Mount models customers and suppliers as one `Company` collection; a
 * `CompanyType` distinguishes them. Parts are not a native entity — they are
 * `Object` rows under an `ObjectDefinition`, so the definition to write into is
 * per-tenant configuration rather than a constant.
 */

export const MountCompanySchema = z.object({
  id: z.string(),
  identifier: z.string().nullable().optional(),
  name: z.string(),
  organizationNumber: z.string().nullable().optional(),
  vatNumber: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  typeId: z.string().nullable().optional(),
  statusId: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const MountObjectSchema = z.object({
  id: z.string(),
  identifier: z.string().nullable().optional(),
  title: z.string(),
  definitionId: z.string(),
  description: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const MountObjectDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  singular: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  identifierPrefix: z.string().nullable().optional(),
  enabled: z.boolean().nullable().optional()
});

export const MountDomainSchema = z.object({
  id: z.string(),
  identifier: z.string().nullable().optional(),
  title: z.string()
});

export const MountCompanyTypeSchema = z.object({
  id: z.string(),
  title: z.string(),
  identifier: z.string().nullish()
});

export type MountCompany = z.infer<typeof MountCompanySchema>;
export type MountObject = z.infer<typeof MountObjectSchema>;
export type MountObjectDefinition = z.infer<typeof MountObjectDefinitionSchema>;
export type MountCompanyType = z.infer<typeof MountCompanyTypeSchema>;

export const MOUNT_ENTITY_TYPES = ["customer", "supplier", "item"] as const;
export type MountEntityType = (typeof MOUNT_ENTITY_TYPES)[number];

export type MountCompanyInput = {
  identifier: string;
  name: string;
  organizationNumber?: string | null;
  vatNumber?: string | null;
  website?: string | null;
  typeId?: string | null;
};

export type MountObjectInput = {
  identifier: string;
  title: string;
  definitionId: string;
};

export type MountChange = {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
};

export class MountNotFoundError extends Error {
  constructor(collection: string, mountId: string) {
    super(`Mount ${collection} ${mountId} not found`);
    this.name = "MountNotFoundError";
  }
}

/**
 * A request Mount refused or never answered. The message carries Mount's own
 * explanation from the response body, because it is shown to the user next to
 * the record it blocked and "Request failed with status code 400" says nothing
 * they can act on.
 */
export class MountApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "MountApiError";
    this.status = status;
  }
}

/**
 * The outcome of the latest publish run for one entity type, kept on the
 * integration's metadata under `lastPublish.{entityType}`. The job writes it
 * when a run starts, after every batch and when the run ends; the integration
 * page reads it to show progress and what needs attention.
 *
 * Fields added after the first release are optional: records written before
 * them parse as a completed run.
 */
export const MountPublishRecordSchema = z.object({
  status: z.enum(["running", "completed", "failed"]).nullish(),
  trigger: z.enum(["manual", "schedule"]).nullish(),
  runId: z.string().nullish(),
  /** Set by the action route, so the page can tell its own run apart. */
  requestId: z.string().nullish(),
  startedAt: z.string().nullish(),
  at: z.string().nullish(),
  created: z.number().default(0),
  updated: z.number().default(0),
  more: z.boolean().default(false),
  ambiguous: z
    .array(
      z.object({
        entityId: z.string(),
        identifier: z.string(),
        matches: z.number()
      })
    )
    .default([]),
  failed: z
    .array(
      z.object({
        entityId: z.string(),
        identifier: z.string().nullish(),
        reason: z.string()
      })
    )
    .default([]),
  warnings: z.array(z.string()).default([]),
  /** Why the whole run failed, when it did. */
  error: z.string().nullish(),
  deferred: z.array(z.string()).default([])
});

export type MountPublishRecord = z.infer<typeof MountPublishRecordSchema>;

export function parseMountPublishRecords(
  metadata: unknown
): Partial<Record<MountEntityType, MountPublishRecord>> {
  const lastPublish =
    metadata && typeof metadata === "object"
      ? (metadata as { lastPublish?: unknown }).lastPublish
      : undefined;
  if (!lastPublish || typeof lastPublish !== "object") return {};

  const records: Partial<Record<MountEntityType, MountPublishRecord>> = {};
  for (const entityType of MOUNT_ENTITY_TYPES) {
    const parsed = MountPublishRecordSchema.safeParse(
      (lastPublish as Record<string, unknown>)[entityType]
    );
    if (parsed.success) records[entityType] = parsed.data;
  }
  return records;
}
