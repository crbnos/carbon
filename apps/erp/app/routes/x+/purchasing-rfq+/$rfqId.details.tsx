import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData } from "~/hooks";
import type { PurchasingRFQ, PurchasingRFQLine } from "~/modules/purchasing";
import {
  getPurchasingRFQ,
  isRfqLocked,
  purchasingRfqValidator,
  upsertPurchasingRFQ
} from "~/modules/purchasing";
import {
  SupplierInteractionDocuments,
  SupplierInteractionNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import SupplierInteractionState from "~/modules/purchasing/ui/SupplierInteraction/SupplierInteractionState";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const rfq = await getPurchasingRFQ(rfqId);
  if (rfq.error) {
    throw redirect(
      path.to.purchasingRfqs,
      await flash(request, error(rfq.error, "Failed to load RFQ"))
    );
  }

  return {
    internalNotes: (rfq.data?.internalNotes ?? {}) as JSONContent
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const rfq = await getPurchasingRFQ(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: isRfqLocked(rfq.data?.status),
    redirectTo: path.to.purchasingRfq(id),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(purchasingRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { rfqId, ...d } = validation.data;
  if (!rfqId) throw new Error("Could not find rfqId");

  const update = await upsertPurchasingRFQ({
    id,
    rfqId,
    ...d,
    companyId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.purchasingRfq(id),
      await flash(request, error(update.error, "Failed to update RFQ"))
    );
  }

  throw redirect(
    path.to.purchasingRfq(id),
    await flash(request, success("Updated RFQ"))
  );
}

type LinkedSupplierQuote = {
  id: string;
  supplierQuoteId?: string;
  revisionId?: number;
  status?: string;
  supplierId?: string;
  supplier?: { name: string } | null;
};

export default function PurchasingRFQDetailsRoute() {
  const { internalNotes } = useLoaderData<typeof loader>();
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");

  const rfqData = useRouteData<{
    rfqSummary: PurchasingRFQ;
    lines: PurchasingRFQLine[];
    files: Promise<FileObject[]>;
    linkedQuotes: LinkedSupplierQuote[];
  }>(path.to.purchasingRfq(rfqId));

  if (!rfqData) throw new Error("Could not find rfq data");

  return (
    <VStack spacing={2}>
      <SupplierInteractionState
        currentRfq={{
          id: rfqData.rfqSummary.id!,
          rfqId: rfqData.rfqSummary.rfqId ?? undefined,
          status: rfqData.rfqSummary.status ?? undefined
        }}
        linkedQuotes={rfqData.linkedQuotes ?? []}
      />
      <SupplierInteractionNotes
        key={`notes-${rfqId}`}
        id={rfqData.rfqSummary.id}
        table="purchasingRfq"
        title="Notes"
        internalNotes={internalNotes}
      />
      <DeferredFiles key={`documents-${rfqId}`} resolve={rfqData.files}>
        {(resolvedFiles) => (
          <SupplierInteractionDocuments
            interactionId={rfqId}
            attachments={resolvedFiles}
            id={rfqId}
            type="Purchasing Request for Quote"
          />
        )}
      </DeferredFiles>
    </VStack>
  );
}
