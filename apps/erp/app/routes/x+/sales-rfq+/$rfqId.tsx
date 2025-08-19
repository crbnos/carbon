import { VStack, type JSONContent } from "@carbon/react";
import { supportedModelTypes } from "@carbon/utils";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import { Outlet, useParams, useSubmit } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";

import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import type { SalesRFQLine } from "~/modules/sales";
import {
  getOpportunity,
  getOpportunityDocuments,
  getSalesRFQ,
  getSalesRFQLines,
} from "~/modules/sales";
import {
  SalesRFQExplorer,
  SalesRFQHeader,
  SalesRFQProperties,
} from "~/modules/sales/ui/SalesRFQ";
import { useOptimisticDocumentDrag } from "~/modules/sales/ui/SalesRFQ/useOptimiticDocumentDrag";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "RFQs",
  to: path.to.salesRfqs,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const serviceRole = await getCarbonServiceRole();

  const [rfqSummary, lines] = await Promise.all([
    getSalesRFQ(serviceRole, rfqId),
    getSalesRFQLines(serviceRole, rfqId),
  ]);

  const opportunity = await getOpportunity(
    serviceRole,
    rfqSummary.data?.opportunityId ?? null
  );

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (rfqSummary.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(
        request,
        error(rfqSummary.error, "Failed to load sales RFQ summary")
      )
    );
  }

  if (lines.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(lines.error, "Failed to load RFQ lines"))
    );
  }

  return defer({
    rfqSummary: rfqSummary.data,
    lines:
      lines.data.map((line: SalesRFQLine) => ({
        ...line,
        id: line.id ?? "",
        order: line.order ?? 0,
        unitOfMeasureCode: line.unitOfMeasureCode ?? "",
        customerPartId: line.customerPartId ?? "",
        customerPartRevision: line.customerPartRevision ?? "",
        description: line.description ?? "",
        externalNotes: (line.externalNotes ?? {}) as JSONContent,
        internalNotes: (line.internalNotes ?? {}) as JSONContent,
        itemId: line.itemId ?? "",
        quantity: line.quantity ?? [1],
      })) ?? [],
    files: getOpportunityDocuments(serviceRole, companyId, opportunity.data.id),
    opportunity: opportunity.data,
  });
}

export default function SalesRFQRoute() {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const submit = useSubmit();

  const pendingItems = useOptimisticDocumentDrag();

  const handleDrop = (
    document: FileObject & { path: string },
    targetId: string
  ) => {
    if (pendingItems.find((item) => item.id === document.id)) return;

    const fileName = document.name.split(".").slice(0, -1).join(".");
    const fileExtension = document.name.split(".").pop()?.toLowerCase();
    const is3DModel = fileExtension
      ? supportedModelTypes.includes(fileExtension)
      : false;

    const formData = new FormData();

    const payload = {
      id: document.id,
      customerPartId: fileName,
      is3DModel: is3DModel ? true : undefined,
      lineId: targetId.startsWith("sales-rfq-line-")
        ? targetId.replace("sales-rfq-line-", "")
        : undefined,
      path: document.path,
      size: document.metadata?.size,
      salesRfqId: rfqId,
    };

    formData.append("payload", JSON.stringify(payload));

    submit(formData, {
      method: "post",
      action: path.to.salesRfqDrag(rfqId),
      navigate: false,
      fetcherKey: `drag-${document.id}`,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (over) {
      handleDrop(
        active.data.current as unknown as FileObject & { path: string },
        over.id as string
      );
    }
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <PanelProvider>
        <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
          <SalesRFQHeader />
          <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
            <div className="flex flex-grow overflow-hidden">
              <ResizablePanels
                explorer={<SalesRFQExplorer />}
                content={
                  <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                    <VStack spacing={2} className="p-2">
                      <Outlet />
                    </VStack>
                  </div>
                }
                properties={<SalesRFQProperties />}
              />
            </div>
          </div>
        </div>
      </PanelProvider>
    </DndContext>
  );
}
