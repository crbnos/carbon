import type {
  getApiKeys,
  getCompanies,
  getCustomField,
  getCustomFieldsTables,
  getIntegrations,
  getSequences,
  getWebhooks,
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

export type Sequence = NonNullable<
  Awaited<ReturnType<typeof getSequences>>["data"]
>[number];

export type Webhook = NonNullable<
  Awaited<ReturnType<typeof getWebhooks>>["data"]
>[number];
