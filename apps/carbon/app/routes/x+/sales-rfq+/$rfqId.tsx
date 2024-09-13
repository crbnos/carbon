import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  toast,
  VStack,
  type JSONContent,
} from "@carbon/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useFetcher, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import { useCallback, useEffect } from "react";
import { supportedFileTypes } from "~/components/CadModel";
import type { SalesRFQLine } from "~/modules/sales";
import {
  getOpportunityBySalesRFQ,
  getOpportunityDocuments,
  getSalesRFQ,
  getSalesRFQLines,
  SalesRFQBreadcrumbs,
  SalesRFQExplorer,
  SalesRFQHeader,
} from "~/modules/sales";

import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "RFQs",
  to: path.to.salesRfqs,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const [rfqSummary, lines, opportunity] = await Promise.all([
    getSalesRFQ(client, rfqId),
    getSalesRFQLines(client, rfqId),
    getOpportunityBySalesRFQ(client, rfqId),
  ]);

  if (!opportunity.data) throw new Error("Failed to get opportunity record");
  const files = await getOpportunityDocuments(
    client,
    companyId,
    opportunity.data.id
  );

  if (rfqSummary.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(
        request,
        error(rfqSummary.error, "Failed to load part summary")
      )
    );
  }

  if (lines.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(lines.error, "Failed to load RFQ lines"))
    );
  }

  return json({
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
    files: files.data ?? [],
    opportunity: opportunity.data,
  });
}

export default function SalesRFQRoute() {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const fetcher = useFetcher<{ error: string }>();

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data?.error);
    }
  }, [fetcher.data]);

  const handleDrop = useCallback(
    (document: FileObject & { path: string }, targetId: string) => {
      const fileName = document.name.split(".").slice(0, -1).join(".");
      const fileExtension = document.name.split(".").pop()?.toLowerCase();
      const is3DModel = fileExtension
        ? supportedFileTypes.includes(fileExtension)
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
        salesRfqId: rfqId,
      };

      formData.append("payload", JSON.stringify(payload));

      fetcher.submit(formData, {
        method: "post",
        action: path.to.salesRfqDrag(rfqId),
      });
    },
    [fetcher, rfqId]
  );

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
      <div className="flex flex-col h-[calc(100vh-49px)] w-full">
        <SalesRFQHeader />
        <div className="flex h-[calc(100vh-99px)] w-full">
          <div className="flex h-full w-full overflow-y-auto">
            <div className="flex flex-grow overflow-hidden">
              <ClientOnly fallback={null}>
                {() => (
                  <ResizablePanelGroup direction="horizontal">
                    <ResizablePanel
                      order={1}
                      minSize={10}
                      defaultSize={20}
                      className="bg-card h-full z-0"
                    >
                      <ScrollArea className="h-[calc(100vh-99px)]">
                        <div className="grid w-full h-full overflow-hidden">
                          <SalesRFQExplorer />
                        </div>
                      </ScrollArea>
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel order={2} className="z-1">
                      <ScrollArea className="h-[calc(100vh-99px)]">
                        <VStack spacing={2} className="p-2">
                          <SalesRFQBreadcrumbs />
                          <Outlet />
                        </VStack>
                      </ScrollArea>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                )}
              </ClientOnly>
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
