// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { ComponentProps } from "react";
import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AssemblyView } from "~/components/AssemblyView";
import { InspectionView } from "~/components/Inspection/InspectionView";
import { JobOperation } from "~/components/JobOperation";
import { userContext } from "~/context";
import { getMethodOperationPreview } from "~/services/preview.service";
import type { Handle } from "~/utils/handle";
import {
  OUTSIDE_PROCESSING_REFUSAL,
  resolveOperationView
} from "~/utils/operationView";
import { ERP_URL } from "~/utils/path";

const logger = getLogger("mes", "operation-preview");

export const handle: Handle = { chromeless: true };

/**
 * The ERP shows this page in its Operator Preview modal, so the ERP origin may
 * frame it. Every other MES page stays same-origin only.
 */
export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": `frame-ancestors 'self' ${new URL(ERP_URL).origin}`
});

/**
 * The real Operation, Assembly or Inspection screen for a Bill of Process
 * operation, before any job exists. The ERP shows it as the operator preview.
 * It is read-only: no record exists to act on, and the page is inert.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, { view: "parts" });
  // A shared console has a PIN-in gate the bare preview page does not show,
  // and a console never needs the preview, so it is refused there.
  if (context.get(userContext)?.consoleMode) {
    logger.warn("Operator preview refused in console mode", { companyId });
    throw new Response(
      "Open the operator preview from Carbon, not a console.",
      {
        status: 403
      }
    );
  }
  const { operationId: methodOperationId } = params;
  if (!methodOperationId) {
    logger.warn("Operator preview opened without an operation", { companyId });
    throw new Response("The operation could not be found.", { status: 400 });
  }

  const preview = await getMethodOperationPreview(
    getCarbonServiceRole(),
    methodOperationId,
    companyId
  );
  if (!preview) {
    logger.warn("Operation not found for preview", {
      companyId,
      methodOperationId
    });
    throw new Response("The operation could not be found.", { status: 404 });
  }
  if (preview.operationType === "Outside Processing") {
    logger.warn("Operator preview refused for Outside Processing", {
      companyId,
      methodOperationId
    });
    throw new Response(OUTSIDE_PROCESSING_REFUSAL, { status: 400 });
  }
  return { ...preview, openedAt: datetime.timestamp() };
}

const noQuantities = { scrap: 0, production: 0, rework: 0 };

// The preview records nothing. Every request that is not a read is refused,
// whatever started it. On top of that, clicks and keys other than switching
// tabs and moving between steps and slides are stopped, so no dialog opens.
const VIEW_ONLY_TEXT = new Set(["Details", "Model", "Instructions", "Chat"]);
const VIEW_ONLY_LABEL = /step|slide|unit|previous|next/i;

function allowsViewing(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const control = target.closest("button, a, [role='tab'], input, select");
  if (!control) return true;
  if (control.getAttribute("role") === "tab") return true;
  const label = control.getAttribute("aria-label") ?? "";
  if (label && VIEW_ONLY_LABEL.test(label)) return true;
  const text = control.textContent?.trim() ?? "";
  return VIEW_ONLY_TEXT.has(text) || text.startsWith("Skip");
}

function PreviewGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stopPointer = (event: Event) => {
      if (!allowsViewing(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const stopSubmit = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const stopKeys = (event: KeyboardEvent) => {
      if (!event.key.startsWith("Arrow") && event.key !== "Tab") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const realFetch = window.fetch;
    window.fetch = (input, init) => {
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      return /^(get|head)$/i.test(method)
        ? realFetch(input, init)
        : Promise.reject(new TypeError("The operator preview records nothing"));
    };
    const pointerEvents = ["pointerdown", "mousedown", "click"];
    for (const name of pointerEvents) {
      document.addEventListener(name, stopPointer, true);
    }
    document.addEventListener("submit", stopSubmit, true);
    document.addEventListener("keydown", stopKeys, true);
    return () => {
      window.fetch = realFetch;
      for (const name of pointerEvents) {
        document.removeEventListener(name, stopPointer, true);
      }
      document.removeEventListener("submit", stopSubmit, true);
      document.removeEventListener("keydown", stopKeys, true);
    };
  }, []);

  return <>{children}</>;
}

// The screens type their props as whole database rows but read only a few
// fields, so the preview data is cast to them instead of faking every column.
export default function OperationPreviewRoute() {
  const preview = useLoaderData<typeof loader>();
  const view = resolveOperationView(preview.operationType);

  return (
    <PreviewGuard>
      {view === "assembly" ? (
        <AssemblyView
          operationId={preview.operation.id}
          job={preview.job}
          operation={preview.operation}
          thumbnailPath={preview.thumbnailPath}
          trackedEntities={[]}
          trackedEntityId={null}
          materials={{ materials: preview.materials, trackedInputs: [] }}
          procedure={
            preview.procedure as unknown as ComponentProps<
              typeof AssemblyView
            >["procedure"]
          }
          tools={preview.tools}
          ncrs={[]}
          requiresSerialTracking={false}
          requiresBatchTracking={false}
          isFirstOperation
          openEvent={null}
          events={[]}
          nonConformanceActions={[]}
          autoStartOperationTimer={false}
          productionQuantities={noQuantities}
          workCenter={preview.workCenter}
          kanban={null}
          jobId={null}
          canOverrideComplete={false}
          slideModels={preview.slideModels}
          assemblyPlayback={preview.assemblyPlayback}
        />
      ) : view === "inspection" ? (
        <InspectionView
          {...({
            operationId: preview.operation.id,
            job: preview.job,
            operation: preview.operation,
            inspection: {
              id: "preview",
              inspectionId: "Preview",
              status: "In Progress",
              lotSize: 1,
              sampleSize: 1,
              acceptanceNumber: 0,
              rejectionNumber: 1,
              aql: null,
              codeLetter: null,
              inspectionLevel: null,
              samplingPlanType: null,
              severity: null,
              dispositionedAt: null,
              itemReadableId: preview.item?.readableIdWithRevision ?? null,
              item: null
            },
            samples: [],
            features: preview.inspection.features,
            measurements: [],
            gauges: [],
            recentGaugeIds: [],
            balloons: preview.inspection.balloons,
            documentName: preview.inspection.documentName,
            pdfUrl: preview.inspection.pdfUrl,
            model: preview.inspection.model,
            issueTypes: [],
            trackedEntities: [],
            requiresSerialTracking: false,
            requiresBatchTracking: false,
            // Opening a real inspection starts the labor clock. A running one
            // shows the same and keeps the screen from starting another.
            events: [
              {
                id: "preview",
                type: "Labor",
                startTime: preview.openedAt,
                endTime: null
              }
            ],
            productionQuantities: noQuantities,
            linkedSampleIds: [],
            linkedProductionQuantity: 0,
            jobId: null
          } as unknown as ComponentProps<typeof InspectionView>)}
        />
      ) : (
        <JobOperation
          {...({
            abilityWarning: null,
            batch: null,
            batchMaterialTotals: null,
            batchWorkInstructions: null,
            events: [],
            expiredEntityPolicy: "Block",
            autoSelectMaterialWithoutPickingList: false,
            files: Promise.resolve([]),
            kanban: null,
            materials: Promise.resolve({
              materials: preview.materials,
              trackedInputs: []
            }),
            method: {
              requiresSerialTracking: false,
              requiresBatchTracking: false
            },
            trackedEntities: [],
            isFirstOperation: true,
            nonConformanceActions: Promise.resolve([]),
            operation: preview.operation,
            procedure: Promise.resolve(preview.procedure),
            job: preview.job,
            thumbnailPath: preview.thumbnailPath,
            workCenter: Promise.resolve({
              data: preview.workCenter,
              error: null
            })
          } as unknown as ComponentProps<typeof JobOperation>)}
        />
      )}
    </PreviewGuard>
  );
}
