// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  getApiKeys,
  getCompanies,
  getCustomField,
  getCustomFieldsTables,
  getIntegrations,
  getItemSerialSequences,
  getSequences,
  getSubsidiaries,
  getWebhooks
} from "./settings.service";

export type ApiKey = NonNullable<
  Awaited<ReturnType<typeof getApiKeys>>["data"]
>[number];

export type Company = NonNullable<
  Awaited<ReturnType<typeof getCompanies>>["data"]
>[number];

export type CustomField = NonNullable<
  Awaited<ReturnType<typeof getCustomField>>["data"]
>;

export type CustomFieldsTableType = NonNullable<
  Awaited<ReturnType<typeof getCustomFieldsTables>>["data"]
>[number];

export type Integration = NonNullable<
  Awaited<ReturnType<typeof getIntegrations>>["data"]
>[number];

export type Subsidiary = NonNullable<
  Awaited<ReturnType<typeof getSubsidiaries>>["data"]
>[number];

export type Sequence = NonNullable<
  Awaited<ReturnType<typeof getSequences>>["data"]
>[number];

export type ItemSerialSequence = NonNullable<
  Awaited<ReturnType<typeof getItemSerialSequences>>["data"]
>[number];

export type Webhook = NonNullable<
  Awaited<ReturnType<typeof getWebhooks>>["data"]
>[number];

/** An Active make method with a pulled, stocked line missing a Pull From. */
export type MethodMissingPullFrom = {
  makeMethodId: string;
  itemId: string;
  itemType: string;
  readableId: string;
  name: string;
  version: number;
  /** The pulled, stocked materials on this version with a gap. */
  materials: string[];
  /** The locations at least one of those materials has no Pull From at. */
  locations: string[];
};

/** An open job whose next backflush strict backflush would refuse. */
export type JobMissingStorageUnit = {
  id: string;
  jobId: string;
  status: Database["public"]["Enums"]["jobStatus"];
  readableId: string | null;
  locationName: string | null;
  /** The materials the backflush would refuse: no storage unit. */
  materials: string[];
};
