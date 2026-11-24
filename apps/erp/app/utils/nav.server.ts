// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import {
  anyOf,
  landingOf,
  type ModuleId,
  pagesOf
} from "@carbon/database/access";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

/**
 * The loader of a module's `_index`: refuses a person who can view none of
 * the module's pages, and sends the others to their landing page.
 */
export function moduleIndexLoader(module: ModuleId) {
  return async ({ request }: LoaderFunctionArgs): Promise<never> => {
    const { permissions, companyId } = await authorize(
      request,
      anyOf(pagesOf(module), "View")
    );
    throw redirect(
      landingOf(module, permissions, companyId)?.path ??
        path.to.authenticatedRoot
    );
  };
}
