// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getMountClient } from "./lib/client";

export async function mountHealthcheck(companyId: string) {
  return await getMountClient().healthcheck(companyId);
}
