import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, Spinner } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { lazy, Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getUnitOfMeasuresList } from "~/modules/items/items.service";
import {
  getBalloons,
  getInspectionDocument,
  getInspectionFeatures
} from "~/modules/production";
import type { InspectionDocumentContent } from "~/modules/production/types";
import type { SamplingRule } from "~/modules/production/ui/InspectionDocument/SamplingRuleModal";
import { getCompanySettings } from "~/modules/settings";
import type { BreadcrumbSegment, Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const InspectionDocumentEditor = lazy(
  () =>
    import(
      "~/modules/production/ui/InspectionDocument/InspectionDocumentEditor"
    )
);

export const handle: Handle = {
  breadcrumb: (_params: unknown, data: any): BreadcrumbSegment[] => {
    const segments: BreadcrumbSegment[] = [
      { breadcrumb: msg`Production`, to: path.to.production },
      { breadcrumb: msg`Inspection Plans`, to: path.to.inspectionDocuments }
    ];
    const name = data?.diagram?.name;
    return name ? [...segments, { breadcrumb: name }] : segments;
  },
  module: "production"
};

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
    companySettings
  ] = await Promise.all([
    getInspectionDocument(serviceRole, id, companyId),
    getInspectionFeatures(serviceRole, id),
    getBalloons(serviceRole, id),
    getUnitOfMeasuresList(client, companyId),
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
    samplingStandard:
      ((companySettings.data as any)?.samplingStandard as
        | "ANSI_Z1_4"
        | "ISO_2859_1") ?? "ANSI_Z1_4"
  };
}

export default function BalloonDetailRoute() {
  const { diagram, features, balloons, unitOfMeasures, samplingStandard } =
    useLoaderData<typeof loader>();
  const content = diagram.content as InspectionDocumentContent | null;

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
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
              diagramId={diagram.id}
              name={diagram.name}
              partId={diagram.partId}
              content={content}
              features={features}
              balloons={balloons}
              unitOfMeasures={unitOfMeasures}
              sampling={(diagram.sampling as SamplingRule | null) ?? null}
              samplingStandard={samplingStandard}
            />
          </Suspense>
        )}
      </ClientOnly>
    </div>
  );
}
