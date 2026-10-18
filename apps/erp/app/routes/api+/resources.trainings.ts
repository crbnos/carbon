// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";
import { getOutstandingTrainingsForUser } from "~/modules/resources/resources.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId, userId } = await authorize(request, {});

  return await getOutstandingTrainingsForUser(
    getCarbonServiceRole(),
    companyId,
    userId
  );
}
