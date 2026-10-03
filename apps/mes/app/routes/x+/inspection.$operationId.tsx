// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { InspectionView } from "~/components/Inspection/InspectionView";
import { getDatabaseClient } from "~/services/database.server";
import { getInspectionDocumentWithBalloons } from "~/services/quality.service";
import { getInspectionScreen } from "~/services/screens.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const serviceRole = await getCarbonServiceRole();

  // The read itself lives in `~/services/screens.server` so this screen and
  // `GET /api/v1/operations/:id/inspection` cannot drift.
  const screen = await getInspectionScreen(serviceRole, getDatabaseClient(), {
    companyId,
    userId,
    operationId
  });

  if (!screen.ok) {
    const { failure } = screen;
    // The wrong-view guard carries the selected unit across the hop.
    if ((failure.details as { view?: string } | undefined)?.view) {
      throw redirect(`${failure.redirectTo}${url.search}`);
    }
    // An empty message is how the loader's two bare redirects are reported.
    if (!failure.message) {
      throw redirect(failure.redirectTo ?? path.to.operations);
    }
    throw redirect(
      failure.redirectTo ?? path.to.operations,
      await flash(request, error(failure.details ?? null, failure.message))
    );
  }

  // The drawing pane is web-only: `react-konva` + `react-pdf` cannot run on
  // React Native, so this read stays here rather than in the shared screen.
  const inspection = screen.data.inspection as {
    inspectionDocumentId?: string | null;
  };
  const document = inspection.inspectionDocumentId
    ? await getInspectionDocumentWithBalloons(
        serviceRole,
        inspection.inspectionDocumentId
      )
    : null;

  return {
    ...screen.data,
    balloons: document?.data?.balloons ?? [],
    documentName: document?.data?.name ?? null,
    pdfUrl: document?.data?.pdfUrl ?? null
  };
}

export default function InspectionRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  return <InspectionView {...data} operationId={operationId} />;
}
