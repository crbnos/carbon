// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApprovalDecision } from "@carbon/ee/approvals";
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
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import {
  LuCheckCheck,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuKeySquare,
  LuTrash,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { DateTime, EmployeeAvatar } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import { useSupplierTypes } from "~/components/Form/SupplierType";
import {
  RecordAction,
  RecordHero,
  RecordPhoneChrome
} from "~/components/Layout/RecordHeader";
import { ConfirmDelete } from "~/components/Modals";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired,
  useUser
} from "~/hooks";
import type { SupplierDetail } from "~/modules/purchasing";
import { SupplierStatusIndicator } from "~/modules/purchasing/ui/Supplier/SupplierStatusIndicator";
import type { action } from "~/routes/x+/settings+/tags";
import { path } from "~/utils/path";
import SupplierApprovalModal from "./SupplierApprovalModal";

const SupplierHeader = () => {
  const { supplierId } = useParams();

  if (!supplierId) throw new Error("Could not find supplierId");
  const fetcher = useFetcher<typeof action>();
  const { t } = useLingui();
  const requestApprovalFetcher = useFetcher();
  const permissions = usePermissions();
  const { company } = useUser();
  const isApprovalRequired = useSupplierApprovalRequired();
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
    supplierTax: { taxExempt: boolean } | null;
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

  const menuItems = (
    <>
      {auditLogTrigger}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        disabled={!permissions.can("delete", "purchasing")}
        destructive
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Supplier</Trans>
      </DropdownMenuItem>
    </>
  );
  return (
    <>
      {/* The app bar titles the record with its name, so no hero. */}
      {/* No hero; it still zeroes --header-height on phones. */}
      <RecordHero />
      <RecordPhoneChrome menu={menuItems} copyValue={supplierId} />
      <VStack>
        <Card>
          <HStack className="justify-between items-start max-md:hidden">
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
                  <DropdownMenuContent>{menuItems}</DropdownMenuContent>
                </DropdownMenu>
                <Copy
                  text={supplierId}
                  label={t`Copy supplier unique identifier`}
                  icon={<LuKeySquare />}
                />
              </CardTitle>
            </CardHeader>
            <CardAction className="flex h-full flex-row items-center gap-2">
              {isApprovalRequired &&
                status !== "Active" &&
                !hasApprovalRequest && (
                  <RecordAction slot="primary">
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
                  </RecordAction>
                )}
              {status === "Active" && canApprove && (
                <RecordAction slot="secondary">
                  <Button
                    leftIcon={<LuX />}
                    variant="secondary"
                    isLoading={makeInactiveFetcher.state !== "idle"}
                    isDisabled={makeInactiveFetcher.state !== "idle"}
                    onClick={makeInactiveModal.onOpen}
                  >
                    <Trans>Make Inactive</Trans>
                  </Button>
                </RecordAction>
              )}
              {isPending && hasApprovalRequest && (
                <>
                  <RecordAction slot="primary">
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
                  </RecordAction>
                  <RecordAction slot="secondary">
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
                  </RecordAction>
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
              <CardAttribute>
                <CardAttributeLabel>Tax Status</CardAttributeLabel>
                <CardAttributeValue>
                  {routeData?.supplierTax?.taxExempt ? (
                    <Status color="red">Exempt</Status>
                  ) : (
                    <Status color="green">Taxable</Status>
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
                        <DateTime
                          value={routeData.decision.decisionAt}
                          variant="date"
                        />
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
                        <DateTime
                          value={routeData.decision.decisionAt}
                          variant="date"
                        />
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
