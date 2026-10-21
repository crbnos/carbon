// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { getProjects } from "~/modules/accounting/accounting.service";
import { ProjectsTable } from "~/modules/accounting/ui/Projects";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// Projects moved to their own module; keep old links working.
export async function loader() {
  throw redirect(path.to.projects);
}

export const middleware = [redirectBeforeLoaders(loader)];
