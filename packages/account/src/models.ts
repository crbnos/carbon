// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";
import { zfd } from "zod-form-data";

// The panes of the account settings modal. `?account=<tab>` on any URL of an
// app that mounts the modal opens it there.
export const accountSettingsTabs = [
  "profile",
  "notifications",
  "security"
] as const;

export type AccountSettingsTab = (typeof accountSettingsTabs)[number];

export function isAccountSettingsTab(
  value: string | null | undefined
): value is AccountSettingsTab {
  return accountSettingsTabs.some((tab) => tab === value);
}

export const accountProfileValidator = z.object({
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  about: z.string(),
  phone: zfd.text(z.string().optional())
});
