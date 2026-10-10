// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { Trans } from "@lingui/react/macro";
import type { AccountProfileData } from "../types";
import { AccountSettingsPane } from "./AccountSettingsLayout";
import AccountSettingsSkeleton from "./AccountSettingsSkeleton";
import { useAccountEndpoints, useAccountSettingsConfig } from "./context";
import ProfileForm from "./ProfileForm";

export default function ProfileSettings() {
  const { companyId } = useAccountSettingsConfig();
  const endpoints = useAccountEndpoints();
  const { data } = useLoaderQuery<AccountProfileData>(endpoints.profile);

  return (
    <AccountSettingsPane
      title={<Trans>Profile</Trans>}
      description={
        <Trans>
          This information will be visible to all users, so be careful what you
          share.
        </Trans>
      }
    >
      {!data ? (
        <AccountSettingsSkeleton />
      ) : data.user ? (
        <ProfileForm
          user={data.user}
          action={endpoints.profile}
          photo={{ action: endpoints.profile, companyId }}
          variant="plain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>Your profile could not be loaded.</Trans>
        </p>
      )}
    </AccountSettingsPane>
  );
}
