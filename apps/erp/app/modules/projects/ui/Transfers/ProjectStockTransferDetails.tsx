// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardAttributeValue,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { DateTime } from "~/components";
import {
  DatePicker,
  Hidden,
  Location,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import {
  fromStockOwner,
  projectStockTransferValidator
} from "../../projects.models";
import type {
  ProjectBorrow,
  ProjectStockTransfer,
  StockOwnerProject
} from "../../types";
import ProjectBorrowStatus from "./ProjectBorrowStatus";
import { StockOwner, stockOwnerOptions } from "./StockOwner";

type ProjectStockTransferDetailsProps = {
  transfer: ProjectStockTransfer;
  owners: StockOwnerProject[];
  /** The borrow a Payback settles. */
  borrow: ProjectBorrow | null;
};

/**
 * The transfer's owners, location, reason and due date. Editable while
 * Draft; a Payback's owners and location come from its borrow and are read
 * only.
 */
export default function ProjectStockTransferDetails({
  transfer,
  owners,
  borrow
}: ProjectStockTransferDetailsProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [items] = useItems();
  const formatQuantity = useQuantityFormatter();
  const isEditable =
    transfer.status === "Draft" && permissions.can("update", "projects");

  // The transfer's own owners stay listed even when a project no longer
  // keeps project stock, so the form never loses its value.
  const ownerOptions = useMemo(() => {
    const listed = [...owners];
    for (const project of [transfer.fromProject, transfer.toProject]) {
      if (project && !listed.some((p) => p.id === project.id)) {
        listed.push({
          ...project,
          status: "Released",
          customerId: null,
          governmentFurnished: false
        });
      }
    }
    return stockOwnerOptions(listed, t`Common stock`);
  }, [owners, transfer.fromProject, transfer.toProject, t]);
  const projectOptions = ownerOptions.filter((o) => o.value !== "common");
  const isPayback = transfer.type === "Payback";
  const borrowItem = borrow
    ? items.find((item) => item.id === borrow.itemId)
    : undefined;

  return (
    <Card>
      <ValidatedForm
        validator={projectStockTransferValidator}
        method="post"
        action={path.to.projectStockTransfer(transfer.id)}
        isDisabled={!isEditable}
        defaultValues={{
          id: transfer.id,
          type: transfer.type,
          fromProjectId: fromStockOwner(transfer.fromProjectId),
          toProjectId: fromStockOwner(transfer.toProjectId),
          locationId: transfer.locationId,
          reason: transfer.reason,
          paybackDueDate: transfer.paybackDueDate ?? undefined,
          settlesBorrowId: transfer.settlesBorrowId ?? undefined
        }}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Details</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="type" />
          <VStack spacing={4}>
            {isPayback ? (
              <>
                <Hidden name="fromProjectId" />
                <Hidden name="toProjectId" />
                <Hidden name="locationId" />
                <Hidden name="settlesBorrowId" />
                <CardAttributes>
                  <CardAttribute>
                    <CardAttributeLabel>
                      <Trans>From (borrower)</Trans>
                    </CardAttributeLabel>
                    <CardAttributeValue>
                      <StockOwner project={transfer.fromProject} />
                    </CardAttributeValue>
                  </CardAttribute>
                  <CardAttribute>
                    <CardAttributeLabel>
                      <Trans>To (lender)</Trans>
                    </CardAttributeLabel>
                    <CardAttributeValue>
                      <StockOwner project={transfer.toProject} />
                    </CardAttributeValue>
                  </CardAttribute>
                  {borrow && (
                    <>
                      <CardAttribute>
                        <CardAttributeLabel>
                          <Trans>Borrowed</Trans>
                        </CardAttributeLabel>
                        <CardAttributeValue>
                          <span className="tabular-nums">
                            {formatQuantity(Number(borrow.quantity))} ×{" "}
                            {borrowItem?.readableIdWithRevision ??
                              borrow.itemId}
                          </span>
                        </CardAttributeValue>
                      </CardAttribute>
                      <CardAttribute>
                        <CardAttributeLabel>
                          <Trans>Still owed</Trans>
                        </CardAttributeLabel>
                        <CardAttributeValue>
                          <span className="tabular-nums">
                            {formatQuantity(
                              Number(borrow.quantity) -
                                Number(borrow.quantityPaidBack)
                            )}
                          </span>
                        </CardAttributeValue>
                      </CardAttribute>
                      <CardAttribute>
                        <CardAttributeLabel>
                          <Trans>Payback Due</Trans>
                        </CardAttributeLabel>
                        <CardAttributeValue>
                          <DateTime
                            value={borrow.paybackDueDate}
                            variant="date"
                          />
                        </CardAttributeValue>
                      </CardAttribute>
                      <CardAttribute>
                        <CardAttributeLabel>
                          <Trans>Borrow Status</Trans>
                        </CardAttributeLabel>
                        <CardAttributeValue>
                          <ProjectBorrowStatus status={borrow.status} />
                        </CardAttributeValue>
                      </CardAttribute>
                    </>
                  )}
                </CardAttributes>
              </>
            ) : (
              <>
                <Select
                  name="fromProjectId"
                  label={t`From`}
                  options={
                    transfer.type === "Borrow" ? projectOptions : ownerOptions
                  }
                />
                <Select
                  name="toProjectId"
                  label={t`To`}
                  options={
                    transfer.type === "Borrow" ? projectOptions : ownerOptions
                  }
                />
                <Location name="locationId" label={t`Location`} />
                {transfer.type === "Borrow" && (
                  <DatePicker
                    name="paybackDueDate"
                    label={t`Payback Due Date`}
                  />
                )}
              </>
            )}
            <TextArea name="reason" label={t`Reason`} />
          </VStack>
        </CardContent>
        {isEditable && (
          <CardFooter>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        )}
      </ValidatedForm>
    </Card>
  );
}
