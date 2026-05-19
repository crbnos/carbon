import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { FileObject } from "@supabase/storage-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { useRouteData } from "~/hooks";
import type { Opportunity, SalesRFQ, SalesRFQLine } from "~/modules/sales";
import {
  getSalesRFQ,
  isSalesRfqLocked,
  salesRfqValidator,
  upsertSalesRFQ
} from "~/modules/sales";
import {
  OpportunityDocuments,
  OpportunityNotes,
  OpportunityState
} from "~/modules/sales/ui/Opportunity";
import { setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const rfq = await getSalesRFQ(rfqId);
  if (rfq.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(rfq.error, "Failed to load RFQ"))
    );
  }

  return {
    internalNotes: (rfq.data?.internalNotes ?? {}) as JSONContent,
    externalNotes: (rfq.data?.externalNotes ?? {}) as JSONContent
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  await requirePermissions(request, {
    view: "sales"
  });

  const rfq = await getSalesRFQ(id);
  await requireUnlocked({
    request,
    isLocked: isSalesRfqLocked(rfq.data?.status),
    redirectTo: path.to.salesRfq(id),
    message: "Cannot modify a locked RFQ. Reopen it first."
  });

  const { userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { rfqId, ...d } = validation.data;
  if (!rfqId) throw new Error("Could not find rfqId");

  const update = await upsertSalesRFQ({
    id,
    rfqId,
    ...d,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.salesRfq(id),
      await flash(request, error(update.error, "Failed to update RFQ"))
    );
  }

  throw redirect(
    path.to.salesRfq(id),
    await flash(request, success("Updated RFQ"))
  );
}

export default function SalesRFQDetailsRoute() {
  const { t } = useLingui();
  const { internalNotes, externalNotes } = useLoaderData<typeof loader>();
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");

  const rfqData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
    files: Promise<FileObject[]>;
    opportunity: Opportunity;
  }>(path.to.salesRfq(rfqId));

  if (!rfqData) throw new Error("Could not find rfq data");

  return (
    <VStack spacing={2}>
      <OpportunityState
        key={`state-${rfqId}`}
        opportunity={rfqData?.opportunity!}
      />
      <OpportunityNotes
        key={`notes-${rfqId}`}
        id={rfqData.rfqSummary.id}
        table="salesRfq"
        title={t`Notes`}
        internalNotes={internalNotes}
        externalNotes={externalNotes}
      />
      <DeferredFiles key={`documents-${rfqId}`} resolve={rfqData.files}>
        {(resolvedFiles) => (
          <OpportunityDocuments
            opportunity={rfqData.opportunity}
            attachments={resolvedFiles}
            id={rfqId}
            type="Request for Quote"
          />
        )}
      </DeferredFiles>
    </VStack>
  );
}
