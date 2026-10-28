// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  API_KEYS_PAGING,
  CUSTOM_FIELD_TABLES_PAGING,
  getApiKeys,
  getCustomFieldsTables,
  getItemSerialSequences,
  getSequences,
  getWebhooks,
  ITEM_SERIAL_SEQUENCES_PAGING,
  SEQUENCES_PAGING,
  WEBHOOKS_PAGING
} from "~/modules/settings/settings.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

export const apiKeysList = {
  key: "api-keys",
  permission: { update: "users" },
  ...API_KEYS_PAGING,
  // The key hash never leaves the server: not to the page, not to an export.
  query: async (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) => {
    const result = await getApiKeys(client, companyId, {
      search: params.get("search"),
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
    return {
      ...result,
      data: result.data?.map(({ keyHash: _keyHash, ...rest }) => rest) ?? null
    };
  }
} satisfies ListDefinition;

export const sequencesList = searchList({
  key: "sequences",
  permission: { view: "settings", role: "employee" },
  paging: SEQUENCES_PAGING,
  service: getSequences
});

export const itemSerialSequencesList = searchList({
  key: "serial-numbers",
  permission: { view: "settings", role: "employee" },
  paging: ITEM_SERIAL_SEQUENCES_PAGING,
  service: getItemSerialSequences
});

export const webhooksList = searchList({
  key: "webhooks",
  permission: { view: "settings" },
  paging: WEBHOOKS_PAGING,
  service: getWebhooks
});

// The settings lists. Each entry follows `sales.server.ts`.
export const customFieldTablesList = searchList({
  key: "custom-field-tables",
  permission: { view: "settings", role: "employee" },
  paging: CUSTOM_FIELD_TABLES_PAGING,
  service: getCustomFieldsTables
});

export const settingsLists: Record<string, ListDefinition> = {
  [apiKeysList.key]: apiKeysList,
  [customFieldTablesList.key]: customFieldTablesList,
  [sequencesList.key]: sequencesList,
  [itemSerialSequencesList.key]: itemSerialSequencesList,
  [webhooksList.key]: webhooksList
};
