// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

/**
 * The old element panel URL. An element opens on its own page now, so this
 * redirects there, keeping the query (`?cr=` included). The plan line, job,
 * purchase order line, comment and delete routes below it stay where they
 * are; a fetcher posting to them never loads this route.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "projects" });
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");
  const { search } = new URL(request.url);
  throw redirect(`${path.to.projectElement(projectId, elementId)}${search}`);
}
