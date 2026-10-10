// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { AccountSettingsUser } from "../types";

export type AccountSettingsConfig = {
  /**
   * Where the ERP's API routes are reached from this app: `/api` in the ERP,
   * the app's proxy to the ERP (`/x/proxy/api`) everywhere else.
   */
  api: string;
  user: AccountSettingsUser;
  /** The company the photo upload is staged under. */
  companyId: string;
  /**
   * The browser-push section of the Notifications pane. Only the ERP passes
   * it: the push service worker is registered on the ERP's origin.
   */
  renderBrowserNotifications?: (publicKey: string) => ReactNode;
  /**
   * The two-factor plan gate. Only the ERP knows the plan; elsewhere the
   * button always starts enrollment.
   */
  twoFactor?: {
    isGated: boolean;
    renderUpgrade: (props: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => ReactNode;
  };
};

const AccountSettingsContext = createContext<AccountSettingsConfig | null>(
  null
);

export const AccountSettingsProvider = AccountSettingsContext.Provider;

export function useAccountSettingsConfig() {
  const config = useContext(AccountSettingsContext);
  if (!config) {
    throw new Error(
      "Account settings panes must render inside AccountSettings"
    );
  }
  return config;
}

/** The ERP endpoints every pane calls, under the app's API base. */
export function useAccountEndpoints() {
  const { api } = useAccountSettingsConfig();
  return useMemo(
    () => ({
      profile: `${api}/account/profile`,
      notifications: `${api}/account/notifications`,
      security: `${api}/account/security`,
      mfaEnroll: `${api}/mfa/enroll`,
      mfaVerify: `${api}/mfa/verify`,
      mfaUnenroll: `${api}/mfa/unenroll`,
      passkeyRegisterOptions: `${api}/passkey/register/options`,
      passkeyRegisterVerify: `${api}/passkey/register/verify`
    }),
    [api]
  );
}
