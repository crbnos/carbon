import type { getAccount, getPublicAttributes } from "./account.service";

export type Account = NonNullable<
  Awaited<ReturnType<typeof getAccount>>["data"]
>;

export type PersonalData = {};

export type PublicAttributes = NonNullable<
  Awaited<ReturnType<typeof getPublicAttributes>>["data"]
>[number];

export type PrivateAttributes = PublicAttributes;
