import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { NotificationEvent } from "@carbon/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tasks } from "@trigger.dev/sdk";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getQualityDocument,
  getQualityDocumentVersions,
  qualityDocumentApprovalValidator
} from "~/modules/quality";
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
} from "~/modules/shared";
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
  serviceRole: SupabaseClient<Database>,
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
    getLatestApprovalRequestForDocument(
      serviceRole,
      "qualityDocument",
      documentId
    ),
    isApprovalRequired(serviceRole, "qualityDocument", companyId, undefined)
  ]);

  const req = latest.data;
  if (!req || req.status !== "Pending" || !req.requestedBy || !req.id) {
    return { ...defaultContext, isApprovalRequired: approvalRequired };
  }

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: req.amount,
      documentType: req.documentType,
      companyId: req.companyId
    },
    userId
  );
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
  breadcrumb: "Policy & Procedure",
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

  const serviceRole = getCarbonServiceRole();

  // Verify user can approve this request
  const approvalRequest = await getLatestApprovalRequestForDocument(
    serviceRole,
    "qualityDocument",
    id
  );

  if (!approvalRequest.data || approvalRequest.data.id !== approvalRequestId) {
    throw redirect(
      path.to.qualityDocument(id),
      await flash(request, error(null, "Approval request not found"))
    );
  }

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: approvalRequest.data.amount,
      documentType: approvalRequest.data.documentType,
      companyId: approvalRequest.data.companyId
    },
    userId
  );

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
  const result =
    decision === "Approved"
      ? await approveRequest(
          serviceRole,
          approvalRequestId,
          userId,
          notes || undefined
        )
      : await rejectRequest(
          serviceRole,
          approvalRequestId,
          userId,
          notes || undefined
        );

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
      await tasks.trigger("notify", {
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
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [document, tags] = await Promise.all([
    getQualityDocument(client, id),
    getTagsList(client, companyId, "qualityDocument")
  ]);

  if (document.error) {
    throw redirect(
      path.to.qualityDocuments,
      await flash(request, error(document.error, "Failed to load document"))
    );
  }

  const serviceRole = getCarbonServiceRole();
  const status = document.data?.status ?? null;
  const approval = await getQualityDocumentApprovalContext(
    serviceRole,
    id,
    status,
    companyId,
    userId
  );

  return {
    document: document.data,
    versions: getQualityDocumentVersions(client, document.data, companyId),
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
