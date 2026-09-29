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
  title: z.string()
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
