// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

export type Account = Database["public"]["Tables"]["user"]["Row"];

/**
 * What the ERP's account API routes return. The ERP loaders are typed against
 * these, so the panes and the routes cannot drift; the MES and the starter
 * read the same routes through their proxy.
 */
export type AccountProfileData = { user: Account | null };

export type AccountNotificationsData = {
  preferences: Pick<
    Database["public"]["Tables"]["notificationPreference"]["Row"],
    "topic" | "channel" | "enabled"
  >[];
  slackActive: boolean;
  emailPlanEnabled: boolean;
  /** Null hides every push control: the deployment has no push keys. */
  push: { publicKey: string } | null;
};

export type Passkey = {
  id: string;
  credentialName: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

export type AccountTotpFactor = {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string;
};

export type AccountSecurityData = {
  passkeys: Passkey[];
  totpFactors: AccountTotpFactor[];
};

/** The signed-in user, as each app's shell already has it. */
export type AccountSettingsUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
};
