// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getLinearClient } from "./lib/client";

export async function linearHealthcheck(
  companyId: string,
  _: Record<string, unknown>
) {
  const linear = getLinearClient();
  return await linear.healthcheck(companyId);
}
