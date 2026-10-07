// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApprovalDecision } from "@carbon/ee/approvals";
import {
  Badge,
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useEffect, useState } from "react";
import { LuCheckCheck, LuClipboardCheck, LuTrash, LuX } from "react-icons/lu";
import { Await, useFetcher, useParams } from "react-router";
import { VersionMenu } from "~/components";
import { usePanels } from "~/components/Layout";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { useDocumentStore } from "~/stores";
import { path } from "~/utils/path";
import type { QualityDocument } from "../../types";
import QualityDocumentApprovalModal from "./QualityDocumentApprovalModal";
import QualityDocumentForm from "./QualityDocumentForm";
import QualityDocumentStatus from "./QualityDocumentStatus";

const QualityDocumentHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    document: QualityDocument;
    versions: PostgrestResponse<QualityDocument>;
    approvalRequest: { id: string } | null;
    canApprove: boolean;
    canReopen: boolean;
    canDelete: boolean;
    isApprovalRequired: boolean;
  }>(path.to.qualityDocument(id));

  const { t } = useLingui();
  const permissions = usePermissions();
  const { toggleProperties } = usePanels();
  // Live title from the editor's locked title block, so the header updates as
  // the user types (before the loader revalidates).
  const liveTitle = useDocumentStore((s) => s.liveTitle);
  const displayName = liveTitle ?? routeData?.document?.name ?? "";
  const newVersionDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const statusFetcher = useFetcher<{ error?: { message: string } }>();
  const approvalFetcher = useFetcher<{
    error?: string;
    success?: boolean;
  }>();
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision | null>(null);

  const status = routeData?.document?.status ?? null;
  const isDraft = status === "Draft";
  const isArchived = status === "Archived";
  const canActivate = isDraft || isArchived;
  const approvalRequestId = routeData?.approvalRequest?.id;
  const hasApprovalRequest = !!approvalRequestId;
  const canApprove = routeData?.canApprove ?? false;
  const canDelete = routeData?.canDelete ?? true;
  const isApprovalRequired = routeData?.isApprovalRequired ?? false;

  const statusIdle = statusFetcher.state === "idle";
  const submitLoading =
    !statusIdle &&
    statusFetcher.formData?.get("field") === "status" &&
    statusFetcher.formData?.get("value") === "Active";

  let submitButtonLabel: string;
  let submitButtonTooltip: string;
  if (isApprovalRequired) {
    submitButtonLabel = t`Submit for approval`;
    submitButtonTooltip = t`Sends this document for approval before it can go active.`;
  } else if (isArchived) {
    submitButtonLabel = t`Reactivate`;
    submitButtonTooltip = t`Makes this document active again.`;
  } else {
    submitButtonLabel = t`Publish`;
    submitButtonTooltip = t`Makes this document active and visible.`;
  }

  const submitForActivation = () => {
    const formData = new FormData();
    formData.append("ids", id);
    formData.append("field", "status");
    formData.append("value", "Active");
    statusFetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateQualityDocument
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    newVersionDisclosure.onClose();
  }, [id]);

  const versionBadge = (
    <Badge variant="outline">V{routeData?.document?.version}</Badge>
  );
  const statusBadge = (
    <QualityDocumentStatus status={routeData?.document?.status} />
  );
  const menuItems = (
    <DropdownMenuItem
      shortcut={MENU_ITEM_SHORTCUTS.delete}
      disabled={
        !permissions.can("delete", "quality") ||
        !permissions.is("employee") ||
        (canActivate && hasApprovalRequest && !canDelete)
      }
      destructive
      onClick={deleteDisclosure.onOpen}
    >
      <DropdownMenuIcon icon={<LuTrash />} />
      <Trans>Delete Document</Trans>
    </DropdownMenuItem>
  );

  return (
    <>
      <RecordHeader
        title={displayName}
        copyValue={routeData?.document?.name ?? ""}
        menu={menuItems}
        status={
          <>
            {versionBadge}
            {statusBadge}
          </>
        }
        onToggleProperties={toggleProperties}
        actions={
          <>
            {canActivate && !hasApprovalRequest && (
              <RecordAction slot="primary">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        leftIcon={
                          isApprovalRequired ? (
                            <LuClipboardCheck />
                          ) : (
                            <LuCheckCheck />
                          )
                        }
                        variant="primary"
                        isLoading={submitLoading}
                        isDisabled={
                          !permissions.can("update", "quality") ||
                          !permissions.is("employee") ||
                          !statusIdle
                        }
                        onClick={submitForActivation}
                      >
                        {submitButtonLabel}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{submitButtonTooltip}</TooltipContent>
                </Tooltip>
              </RecordAction>
            )}
            {canActivate && hasApprovalRequest && (
              <>
                <RecordAction slot="primary">
                  <Button
                    leftIcon={<LuCheckCheck />}
                    variant="primary"
                    isDisabled={!canApprove}
                    onClick={() => setApprovalDecision("Approved")}
                  >
                    <Trans>Approve</Trans>
                  </Button>
                </RecordAction>
                <RecordAction slot="secondary">
                  <Button
                    leftIcon={<LuX />}
                    variant="destructive"
                    isDisabled={!canApprove}
                    onClick={() => setApprovalDecision("Rejected")}
                  >
                    <Trans>Reject</Trans>
                  </Button>
                </RecordAction>
              </>
            )}
            <RecordAction slot="overflow">
              <Suspense fallback={null}>
                <Await resolve={routeData?.versions}>
                  {(versions) => {
                    const allVersions =
                      versions?.data ??
                      (routeData?.document ? [routeData.document] : []);
                    return (
                      <VersionMenu
                        versions={allVersions}
                        currentVersionId={id}
                        getKey={(v) => v.id}
                        getHref={(v) => path.to.qualityDocument(v.id)}
                        renderLabel={(v) => (
                          <>
                            <Badge variant="outline">V{v.version}</Badge>
                            <span>{v.name}</span>
                          </>
                        )}
                        renderStatus={(v) => (
                          <QualityDocumentStatus status={v.status} />
                        )}
                        onNewVersion={
                          permissions.can("create", "quality")
                            ? newVersionDisclosure.onOpen
                            : undefined
                        }
                      />
                    );
                  }}
                </Await>
              </Suspense>
            </RecordAction>
          </>
        }
      />
      {newVersionDisclosure.isOpen && (
        <QualityDocumentForm
          type="copy"
          initialValues={{
            name: routeData?.document?.name ?? "",
            version: (routeData?.document?.version ?? 0) + 1,
            content: JSON.stringify(routeData?.document?.content) ?? "",
            copyFromId: routeData?.document?.id ?? ""
          }}
          open={newVersionDisclosure.isOpen}
          onClose={newVersionDisclosure.onClose}
        />
      )}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteQualityDocument(id)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.document?.name ?? "document"}
          text={t`Are you sure you want to delete ${routeData?.document?.name}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
      {approvalDecision && approvalRequestId && (
        <QualityDocumentApprovalModal
          qualityDocument={routeData?.document}
          approvalRequestId={approvalRequestId}
          decision={approvalDecision}
          fetcher={approvalFetcher}
          onClose={() => setApprovalDecision(null)}
        />
      )}
    </>
  );
};

export default QualityDocumentHeader;
