// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CONTROLLED_ENVIRONMENT, IS_LOCAL_DEV } from "@carbon/auth";
import { useEdition } from "@carbon/react";
import { Edition, isInternalEmail } from "@carbon/utils";
import { useUser } from "./useUser";

export function useFlags() {
  const user = useUser();
  const edition = useEdition();
  const isInternal = isInternalEmail(user.email);

  return {
    isInternal,
    isCloud: edition === Edition.Cloud,
    isCommunity: edition === Edition.Community,
    isEnterprise: edition === Edition.Enterprise,
    isControlledEnvironment: CONTROLLED_ENVIRONMENT,
    isLocalDev: IS_LOCAL_DEV
  };
}
