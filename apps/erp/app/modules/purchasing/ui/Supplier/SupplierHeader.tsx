import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardAction,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import {
  LuCheckCheck,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuTrash,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { EmployeeAvatar } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import { useSupplierTypes } from "~/components/Form/SupplierType";
import { ConfirmDelete } from "~/components/Modals";
import {
  useDateFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import type { SupplierDetail } from "~/modules/purchasing";
import { SupplierStatusIndicator } from "~/modules/purchasing/ui/Supplier/SupplierStatusIndicator";
import type { ApprovalDecision } from "~/modules/shared/types";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";
import SupplierApprovalModal from "./SupplierApprovalModal";

const SupplierHeader = () => {
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplierId");
  const fetcher = useFetcher<typeof action>();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const requestApprovalFetcher = useFetcher();
  const permissions = usePermissions();
  const { company } = useUser();
  const settings = useSettings();
  const deleteModal = useDisclosure();
  const makeInactiveModal = useDisclosure();
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision | null>(null);
  const routeData = useRouteData<{
    supplier: SupplierDetail;
    tags: { name: string }[];
    approvalRequest: { id: string } | null;
    canApprove: boolean;
    decision: {
      status: "Approved" | "Rejected";
      decisionBy: string;
      decisionAt: string;
    } | null;
  }>(path.to.supplier(supplierId));

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "supplier",
    entityId: supplierId,
    companyId: company.id,
    variant: "dropdown"
  });

  const supplierTypes = useSupplierTypes();
  const supplierType = supplierTypes?.find(
    (type) => type.value === routeData?.supplier?.supplierTypeId
  )?.label;

  const status = routeData?.supplier?.status ?? null;
  const isPending = status === "Pending";
  const approvalRequestId = routeData?.approvalRequest?.id;
  const hasApprovalRequest = !!approvalRequestId;
  const canApprove = routeData?.canApprove ?? false;
  const isApprovalRequired = settings.supplierApproval ?? false;

  const submitRequestApproval = () => {
    const formData = new FormData();
    formData.append("intent", "request-approval");
    requestApprovalFetcher.submit(formData, {
      method: "post",
      action: path.to.supplierApproval(supplierId)
    });
  };

  const makeInactiveFetcher = useFetcher();
  const submitMakeInactive = () => {
    const formData = new FormData();
    formData.append("intent", "make-inactive");
    makeInactiveFetcher.submit(formData, {
      method: "post",
      action: path.to.supplierApproval(supplierId)
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", supplierId);
      formData.append("table", "supplier");

      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },

    [supplierId]
  );

  return (
    <>
      <VStack>
        <Card>
          <HStack className="justify-between items-start">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>{routeData?.supplier?.name}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`More options`}
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {auditLogTrigger}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!permissions.can("delete", "purchasing")}
                      destructive
                      onClick={deleteModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      <Trans>Delete Supplier</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardTitle>
            </CardHeader>
            <CardAction className="flex h-full flex-row items-center gap-2">
              {isApprovalRequired &&
                status !== "Active" &&
                !hasApprovalRequest && (
                  <Button
                    leftIcon={<LuClipboardCheck />}
                    variant="primary"
                    isDisabled={
                      !permissions.can("update", "purchasing") ||
                      requestApprovalFetcher.state !== "idle"
                    }
                    isLoading={requestApprovalFetcher.state !== "idle"}
                    onClick={submitRequestApproval}
                  >
                    <Trans>Request Approval</Trans>
                  </Button>
                )}
              {status === "Active" && canApprove && (
                <Button
                  leftIcon={<LuX />}
                  variant="secondary"
                  isLoading={makeInactiveFetcher.state !== "idle"}
                  isDisabled={makeInactiveFetcher.state !== "idle"}
                  onClick={makeInactiveModal.onOpen}
                >
                  <Trans>Make Inactive</Trans>
                </Button>
              )}
              {isPending && hasApprovalRequest && (
                <>
                  <Button
                    leftIcon={<LuCheckCheck />}
                    variant="primary"
                    isLoading={requestApprovalFetcher.state !== "idle"}
                    isDisabled={
                      !canApprove || requestApprovalFetcher.state !== "idle"
                    }
                    onClick={() => setApprovalDecision("Approved")}
                  >
                    <Trans>Approve</Trans>
                  </Button>
                  <Button
                    leftIcon={<LuX />}
                    variant="destructive"
                    isLoading={requestApprovalFetcher.state !== "idle"}
                    isDisabled={
                      !canApprove || requestApprovalFetcher.state !== "idle"
                    }
                    onClick={() => setApprovalDecision("Rejected")}
                  >
                    <Trans>Reject</Trans>
                  </Button>
                </>
              )}
            </CardAction>
          </HStack>
          <CardContent>
            <CardAttributes>
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Status</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.supplier?.status ? (
                    <SupplierStatusIndicator
                      status={routeData.supplier.status as "Active"}
                    />
                  ) : (
                    "-"
                  )}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Type</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {supplierType ? <Enumerable value={supplierType!} /> : "-"}
                </CardAttributeValue>
              </CardAttribute>
              <CardAttribute>
                <CardAttributeLabel>
                  <Trans>Account Manager</Trans>
                </CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.supplier?.accountManagerId ? (
                    <EmployeeAvatar
                      employeeId={routeData?.supplier?.accountManagerId ?? null}
                    />
                  ) : (
                    "-"
                  )}
                </CardAttributeValue>
              </CardAttribute>
              {routeData?.decision?.status === "Approved" &&
                status === "Active" && (
                  <>
                    <CardAttribute>
                      <CardAttributeLabel>
                        <Trans>Approved By</Trans>
                      </CardAttributeLabel>
                      <CardAttributeValue>
                        <EmployeeAvatar
                          employeeId={routeData.decision.decisionBy}
                        />
                      </CardAttributeValue>
                    </CardAttribute>
                    <CardAttribute>
                      <CardAttributeLabel>
                        <Trans>Approval Date</Trans>
                      </CardAttributeLabel>
                      <CardAttributeValue>
                        {formatDate(routeData.decision.decisionAt)}
                      </CardAttributeValue>
                    </CardAttribute>
                  </>
                )}
              {routeData?.decision?.status === "Rejected" &&
                status === "Rejected" && (
                  <>
                    <CardAttribute>
                      <CardAttributeLabel>
                        <Trans>Rejected By</Trans>
                      </CardAttributeLabel>
                      <CardAttributeValue>
                        <EmployeeAvatar
                          employeeId={routeData.decision.decisionBy}
                        />
                      </CardAttributeValue>
                    </CardAttribute>
                    <CardAttribute>
                      <CardAttributeLabel>
                        <Trans>Rejected Date</Trans>
                      </CardAttributeLabel>
                      <CardAttributeValue>
                        {formatDate(routeData.decision.decisionAt)}
                      </CardAttributeValue>
                    </CardAttribute>
                  </>
                )}
              <CardAttribute>
                <CardAttributeValue>
                  <ValidatedForm
                    defaultValues={{
                      tags: routeData?.supplier?.tags ?? []
                    }}
                    validator={z.object({
                      tags: z.array(z.string()).optional()
                    })}
                    className="w-full"
                  >
                    <Tags
                      label={t`Tags`}
                      name="tags"
                      availableTags={routeData?.tags ?? []}
                      table="supplier"
                      inline
                      onChange={onUpdateTags}
                    />
                  </ValidatedForm>
                </CardAttributeValue>
              </CardAttribute>
            </CardAttributes>
          </CardContent>
        </Card>
      </VStack>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSupplier(supplierId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.supplier?.name!}
          text={t`Are you sure you want to delete ${routeData?.supplier?.name!}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
      {makeInactiveModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) makeInactiveModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Deactivate Supplier</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Trans>
                Are you sure you want to deactivate {routeData?.supplier?.name}?
              </Trans>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={makeInactiveModal.onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                isLoading={makeInactiveFetcher.state !== "idle"}
                isDisabled={makeInactiveFetcher.state !== "idle"}
                onClick={() => {
                  submitMakeInactive();
                  makeInactiveModal.onClose();
                }}
              >
                <Trans>Deactivate</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
      {auditLogDrawer}
      {approvalDecision && approvalRequestId && (
        <SupplierApprovalModal
          supplierName={routeData?.supplier?.name ?? undefined}
          approvalRequestId={approvalRequestId}
          decision={approvalDecision}
          onClose={() => setApprovalDecision(null)}
        />
      )}
    </>
  );
};

export default SupplierHeader;
