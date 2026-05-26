import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { qualityDocumentApprovalValidator } from "~/modules/quality";
import {
  getQualityDocument,
  getQualityDocumentVersions
} from "~/modules/quality/quality.service.server";
import QualityDocumentEditor from "~/modules/quality/ui/Documents/QualityDocumentEditor";
import QualityDocumentExplorer from "~/modules/quality/ui/Documents/QualityDocumentExplorer";
import QualityDocumentHeader from "~/modules/quality/ui/Documents/QualityDocumentHeader";
import QualityDocumentProperties from "~/modules/quality/ui/Documents/QualityDocumentProperties";
import {
  approveRequest,
  canApproveRequest,
  canCancelRequest,
  getLatestApprovalRequestForDocument,
  getTagsList,
  isApprovalRequired,
  rejectRequest
} from "~/modules/shared/shared.service.server";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

type ApprovalContext = {
  approvalRequest: { id: string } | null;
  canApprove: boolean;
  canReopen: boolean;
  canDelete: boolean;
  isApprovalRequired: boolean;
};

async function getQualityDocumentApprovalContext(
  documentId: string,
  status: string | null,
  companyId: string,
  userId: string
): Promise<ApprovalContext> {
  const defaultContext: ApprovalContext = {
    approvalRequest: null,
    canApprove: false,
    canReopen: true,
    canDelete: true,
    isApprovalRequired: false
  };

  if (status !== "Draft" && status !== "Archived") {
    return defaultContext;
  }

  const [latest, approvalRequired] = await Promise.all([
    getLatestApprovalRequestForDocument("qualityDocument", documentId),
    isApprovalRequired("qualityDocument", undefined)
  ]);

  const req = latest.data;
  if (!req || req.status !== "Pending" || !req.requestedBy || !req.id) {
    return { ...defaultContext, isApprovalRequired: approvalRequired };
  }

  const canApprove = await canApproveRequest({
    amount: req.amount,
    documentType: req.documentType,
    companyId: req.companyId
  });
  const isRequester = canCancelRequest(
    { requestedBy: req.requestedBy, status: req.status },
    userId
  );

  return {
    approvalRequest: { id: req.id },
    canApprove,
    canReopen: isRequester || canApprove,
    canDelete: isRequester,
    isApprovalRequired: approvalRequired
  };
}

export const handle: Handle = {
  breadcrumb: msg`Policy & Procedure`,
  to: path.to.qualityDocuments,
  module: "quality"
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(qualityDocumentApprovalValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { approvalRequestId, decision, notes } = validation.data;

  // Verify user can approve this request
  const approvalRequest = await getLatestApprovalRequestForDocument(
    "qualityDocument",
    id
  );

  if (!approvalRequest.data || approvalRequest.data.id !== approvalRequestId) {
    throw redirect(
      path.to.qualityDocument(id),
      await flash(request, error(null, "Approval request not found"))
    );
  }

  const canApprove = await canApproveRequest({
    amount: approvalRequest.data.amount,
    documentType: approvalRequest.data.documentType,
    companyId: approvalRequest.data.companyId
  });

  if (!canApprove) {
    throw redirect(
      path.to.qualityDocument(id),
      await flash(
        request,
        error(null, "You do not have permission to approve this request")
      )
    );
  }

  // Process approval decision
  const db = getDatabaseClient();
  const result =
    decision === "Approved"
      ? await approveRequest(db, approvalRequestId, notes || undefined)
      : await rejectRequest(db, approvalRequestId, notes || undefined);

  if (result.error) {
    throw redirect(
      path.to.qualityDocument(id),
      await flash(
        request,
        error(
          result.error,
          result.error?.message ?? "Failed to process approval decision"
        )
      )
    );
  }

  const requestedBy = approvalRequest.data?.requestedBy;
  const companyId = approvalRequest.data?.companyId;
  if (requestedBy && companyId && requestedBy !== userId) {
    try {
      await trigger("notify", {
        event:
          decision === "Approved"
            ? NotificationEvent.ApprovalApproved
            : NotificationEvent.ApprovalRejected,
        companyId,
        documentId: id,
        documentType: "qualityDocument",
        recipient: { type: "user", userId: requestedBy },
        from: userId
      });
    } catch (e) {
      console.error("Failed to trigger approval decision notification", e);
    }
  }

  throw redirect(
    path.to.qualityDocument(id),
    await flash(
      request,
      success(`Approval request ${decision.toLowerCase()} successfully`)
    )
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Kick off approval in parallel — it only needs document.status, so we chain
  // off the document fetch rather than waiting for Promise.all to settle.
  const documentPromise = getQualityDocument(id);
  const [document, tags, approval] = await Promise.all([
    documentPromise,
    getTagsList("qualityDocument"),
    documentPromise.then((d) =>
      getQualityDocumentApprovalContext(
        id,
        d.data?.status ?? null,
        companyId,
        userId
      )
    )
  ]);

  if (document.error) {
    throw redirect(
      path.to.qualityDocuments,
      await flash(request, error(document.error, "Failed to load document"))
    );
  }

  return {
    document: document.data,
    versions: getQualityDocumentVersions(document.data),
    tags: tags.data ?? [],
    ...approval
  };
}

export default function QualityDocumentRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { document } = useLoaderData<typeof loader>();

  return (
    <PanelProvider key={`${id}-${document.version}`}>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <QualityDocumentHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <QualityDocumentExplorer
                  key={`explorer-${id}-${document.version}`}
                />
              }
              content={
                <div className="bg-background h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <QualityDocumentEditor />
                  <Outlet />
                </div>
              }
              properties={
                <QualityDocumentProperties
                  key={`properties-${id}-${document.version}`}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
