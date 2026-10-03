// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { ComponentProps } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { AssemblyView } from "~/components/AssemblyView";
import { getAssemblyScreen } from "~/services/screens.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  // The manager override is decided from these, inside the shared read. They
  // are loaded HERE because this is the web's claims cache; the API has its
  // own (see `AssemblyScreenArgs.claims`).
  const claims = await getUserClaims(userId, companyId);

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const serviceRole = await getCarbonServiceRole();

  // The read itself lives in `~/services/screens.server` so this screen and
  // `GET /api/v1/operations/:id/assembly` cannot drift.
  const screen = await getAssemblyScreen(serviceRole, {
    companyId,
    userId,
    operationId,
    unit: url.searchParams.get("unit"),
    trackedEntityId: url.searchParams.get("trackedEntityId"),
    claims
  });

  if (!screen.ok) {
    const { failure } = screen;
    // The wrong-view guard carries the selected unit across the hop.
    if ((failure.details as { view?: string } | undefined)?.view) {
      throw redirect(`${failure.redirectTo}${url.search}`);
    }
    // An empty message is how the loader's one bare redirect is reported.
    if (!failure.message) {
      throw redirect(failure.redirectTo ?? path.to.operations);
    }
    throw redirect(
      failure.redirectTo ?? path.to.operations,
      await flash(request, error(failure.details ?? null, failure.message))
    );
  }

  return screen.data;
}

export default function AssemblyRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  // The generated DB types leave JSONB columns as `Json`; the slide annotations
  // are written exclusively by the ERP editors through slideAnnotationValidator,
  // so the view's narrowed pin type is the real runtime shape.
  const procedure = data.procedure as unknown as ComponentProps<
    typeof AssemblyView
  >["procedure"];
  return (
    <AssemblyView {...data} procedure={procedure} operationId={operationId} />
  );
}
