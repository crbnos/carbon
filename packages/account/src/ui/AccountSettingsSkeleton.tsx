// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Skeleton, VStack } from "@carbon/react";

const AccountSettingsSkeleton = () => (
  <VStack spacing={4} className="w-full" aria-busy>
    <Skeleton className="h-40 w-full rounded-xl" />
    <Skeleton className="h-64 w-full rounded-xl" />
  </VStack>
);

export default AccountSettingsSkeleton;
