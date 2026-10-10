// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { isAccountSettingsTab } from "~/modules/account";
import { path } from "~/utils/path";

// Account settings is a modal now. The old pages stay as links into it —
// emails, the MES and the notification bell still point here.
export async function loader({ params }: LoaderFunctionArgs) {
  const tab = isAccountSettingsTab(params.tab) ? params.tab : "profile";
  throw redirect(path.to.accountSettings(tab));
}

export const middleware = [redirectBeforeLoaders(loader)];
