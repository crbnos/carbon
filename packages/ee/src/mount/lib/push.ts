// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { MOUNT_INTEGRATION_ID } from "./service";
import {
  type MountChange,
  type MountCompany,
  type MountCompanyInput,
  type MountEntityType,
  MountNotFoundError,
  type MountObject,
  type MountObjectInput
} from "./types";

export type MountMappingPort = {
  getExternalId(
    entityType: string,
    entityId: string,
    integration: string
  ): Promise<string | null>;
  link(
    entityType: string,
    entityId: string,
    integration: string,
    externalId: string,
    options?: {
      metadata?: Record<string, unknown>;
      allowDuplicateExternalId?: boolean;
      lastSyncedAt?: string;
    }
  ): Promise<void>;
};

export type MountApiPort = {
  findCompaniesByIdentifier(
    companyId: string,
    identifier: string
  ): Promise<MountCompany[]>;
  createCompany(
    companyId: string,
    input: MountCompanyInput
  ): Promise<MountCompany>;
  updateCompany(
    companyId: string,
    mountId: string,
    input: Partial<MountCompanyInput>
  ): Promise<MountChange[]>;
  findObjectsByIdentifier(
    companyId: string,
    definitionId: string,
    identifier: string
  ): Promise<MountObject[]>;
  createObject(
    companyId: string,
    input: MountObjectInput
  ): Promise<MountObject>;
  updateObject(
    companyId: string,
    mountId: string,
    input: Partial<MountObjectInput>
  ): Promise<MountChange[]>;
};

export type PushOutcome =
  | { status: "created"; externalId: string }
  | { status: "updated"; externalId: string }
  | { status: "ambiguous"; identifier: string; matches: number };

export async function pushCompanyToMount(
  mappings: MountMappingPort,
  api: MountApiPort,
  companyId: string,
  entityType: Extract<MountEntityType, "customer" | "supplier">,
  entityId: string,
  input: MountCompanyInput,
  readAt?: string
): Promise<PushOutcome> {
  const externalId = await mappings.getExternalId(
    entityType,
    entityId,
    MOUNT_INTEGRATION_ID
  );

  if (externalId) {
    try {
      await api.updateCompany(companyId, externalId, input);
      await link(mappings, entityType, entityId, externalId, input, readAt);
      return { status: "updated", externalId };
    } catch (error) {
      if (!(error instanceof MountNotFoundError)) throw error;
    }
  }

  const existing = await api.findCompaniesByIdentifier(
    companyId,
    input.identifier
  );

  if (existing.length > 1) {
    return {
      status: "ambiguous",
      identifier: input.identifier,
      matches: existing.length
    };
  }

  const [match] = existing;

  let mountId: string;
  if (match) {
    await api.updateCompany(companyId, match.id, input);
    mountId = match.id;
  } else {
    mountId = (await api.createCompany(companyId, input)).id;
  }

  await link(mappings, entityType, entityId, mountId, input, readAt);

  return { status: match ? "updated" : "created", externalId: mountId };
}

export async function pushItemToMount(
  mappings: MountMappingPort,
  api: MountApiPort,
  companyId: string,
  entityId: string,
  input: MountObjectInput,
  readAt?: string
): Promise<PushOutcome> {
  const externalId = await mappings.getExternalId(
    "item",
    entityId,
    MOUNT_INTEGRATION_ID
  );

  if (externalId) {
    try {
      await api.updateObject(companyId, externalId, input);
      await link(mappings, "item", entityId, externalId, input, readAt);
      return { status: "updated", externalId };
    } catch (error) {
      if (!(error instanceof MountNotFoundError)) throw error;
    }
  }

  const existing = await api.findObjectsByIdentifier(
    companyId,
    input.definitionId,
    input.identifier
  );

  if (existing.length > 1) {
    return {
      status: "ambiguous",
      identifier: input.identifier,
      matches: existing.length
    };
  }

  const [match] = existing;

  let mountId: string;
  if (match) {
    await api.updateObject(companyId, match.id, input);
    mountId = match.id;
  } else {
    mountId = (await api.createObject(companyId, input)).id;
  }

  await link(mappings, "item", entityId, mountId, input, readAt);

  return { status: match ? "updated" : "created", externalId: mountId };
}

async function link(
  mappings: MountMappingPort,
  entityType: MountEntityType,
  entityId: string,
  mountId: string,
  sent: MountCompanyInput | MountObjectInput,
  readAt?: string
) {
  await mappings.link(entityType, entityId, MOUNT_INTEGRATION_ID, mountId, {
    metadata: sent,
    lastSyncedAt: readAt,
    // A Mount part is per part number, and each Carbon revision is its own
    // item. When a new revision is released it takes over the Mount record,
    // while the superseded revision's row still points at it.
    allowDuplicateExternalId: entityType === "item"
  });
}
