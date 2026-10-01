// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, Spinner } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { lazy, Suspense } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getUnitOfMeasuresList } from "~/modules/items/items.service";
import {
  getBalloons,
  getGaugeTypesList,
  getInspectionDocument,
  getInspectionFeatures
} from "~/modules/quality";
import type { InspectionDocumentContent } from "~/modules/quality/types";
import type { SamplingRule } from "~/modules/quality/ui/InspectionDocument/SamplingRuleModal";
import { getCompanySettings } from "~/modules/settings";
import type { BreadcrumbSegment, Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const InspectionDocumentEditor = lazy(
  () =>
    import("~/modules/quality/ui/InspectionDocument/InspectionDocumentEditor")
);

export const handle: Handle = {
  breadcrumb: (_params: unknown, data: any): BreadcrumbSegment[] => {
    const segments: BreadcrumbSegment[] = [
      { breadcrumb: msg`Quality`, to: path.to.quality },
      { breadcrumb: msg`Inspection Plans`, to: path.to.inspectionDocuments }
    ];
    const name = data?.diagram?.name;
    return name ? [...segments, { breadcrumb: name }] : segments;
  },
  module: "quality"
};

// The editor saves itself, and each save's response already carries the
// saved rows — reloading the plan after every edit would only slow the next
// save down.
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formAction,
  defaultShouldRevalidate
}) => (formAction?.endsWith("/save") ? false : defaultShouldRevalidate);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const serviceRole = await getCarbonServiceRole();
  const [
    diagram,
    featuresResult,
    balloonsResult,
    unitOfMeasuresResult,
    gaugeTypesResult,
    companySettings
  ] = await Promise.all([
    getInspectionDocument(serviceRole, id, companyId),
    getInspectionFeatures(serviceRole, id),
    getBalloons(serviceRole, id),
    getUnitOfMeasuresList(client, companyId),
    getGaugeTypesList(client, companyId),
    getCompanySettings(client, companyId)
  ]);

  if (diagram.error) {
    throw redirect(
      path.to.inspectionDocuments,
      await flash(
        request,
        error(diagram.error, "Failed to load inspection plan")
      )
    );
  }

  if (!diagram.data) {
    throw redirect(path.to.inspectionDocuments);
  }

  if (diagram.data.companyId !== companyId) {
    throw redirect(path.to.inspectionDocuments);
  }

  const features = featuresResult.data ?? [];
  const balloons = balloonsResult.data ?? [];

  const unitOfMeasures = unitOfMeasuresResult?.data ?? [];

  return {
    diagram: diagram.data,
    features,
    balloons,
    unitOfMeasures,
    gaugeTypes: gaugeTypesResult.data ?? [],
    samplingStandard:
      ((companySettings.data as any)?.samplingStandard as
        | "ANSI_Z1_4"
        | "ISO_2859_1") ?? "ANSI_Z1_4"
  };
}

export default function BalloonDetailRoute() {
  const {
    diagram,
    features,
    balloons,
    unitOfMeasures,
    gaugeTypes,
    samplingStandard
  } = useLoaderData<typeof loader>();
  const content = diagram.content as InspectionDocumentContent | null;

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
      <ClientOnly
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        }
      >
        {() => (
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            }
          >
            <InspectionDocumentEditor
              key={diagram.id}
              diagramId={diagram.id}
              name={diagram.name}
              partId={diagram.partId}
              content={content}
              features={features}
              balloons={balloons}
              unitOfMeasures={unitOfMeasures}
              gaugeTypes={gaugeTypes}
              sampling={(diagram.sampling as SamplingRule | null) ?? null}
              samplingStandard={samplingStandard}
            />
          </Suspense>
        )}
      </ClientOnly>
    </div>
  );
}
