// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { moduleLanding } from "~/utils/nav";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { permissions, companyId } = await authorize(request);
  throw redirect(
    moduleLanding("users", permissions, companyId) ?? path.to.employeeAccounts
  );
}

export const middleware = [redirectBeforeLoaders(loader)];
