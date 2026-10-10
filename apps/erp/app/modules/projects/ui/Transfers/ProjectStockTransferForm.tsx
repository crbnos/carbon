// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Location,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useQuantityFormatter } from "~/hooks/useQuantityFormatter";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { ProjectStockTransferType } from "../../projects.models";
import { projectStockTransferValidator } from "../../projects.models";
import type { ProjectBorrow, StockOwnerProject } from "../../types";
import { stockOwnerOptions } from "./StockOwner";
import { useStockTransferTypeLabels } from "./useStockTransferTypeLabels";

type ProjectStockTransferFormProps = {
  initialValues: z.input<typeof projectStockTransferValidator>;
  /** The projects that keep project stock. */
  owners: StockOwnerProject[];
  /** The open borrows a Payback can settle. */
  openBorrows: ProjectBorrow[];
  onClose: () => void;
};

/**
 * Creates a Draft project stock transfer. A Transfer or Borrow names its
 * owners (common stock or a project); a Payback picks the borrow it settles,
 * and its owners and location come from that borrow.
 */
const ProjectStockTransferForm = ({
  initialValues,
  owners,
  openBorrows,
  onClose
}: ProjectStockTransferFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [items] = useItems();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const typeLabels = useStockTransferTypeLabels();
  const [type, setType] = useState<ProjectStockTransferType>(
    initialValues.type ?? "Transfer"
  );

  const ownerOptions = useMemo(
    () => stockOwnerOptions(owners, t`Common stock`),
    [owners, t]
  );
  // A borrow runs between two projects: common stock is not an owner.
  const projectOptions = ownerOptions.filter((o) => o.value !== "common");

  const borrowOptions = useMemo(
    () =>
      openBorrows.map((borrow) => {
        const itemLabel =
          items.find((i) => i.id === borrow.itemId)?.readableIdWithRevision ??
          borrow.itemId;
        const owed = formatQuantity(
          Number(borrow.quantity) - Number(borrow.quantityPaidBack)
        );
        const borrower =
          borrow.borrower?.identifier || borrow.borrower?.name || "";
        const lender = borrow.lender?.identifier || borrow.lender?.name || "";
        const due = formatDate(borrow.paybackDueDate);
        return {
          value: borrow.id,
          label: t`${owed} × ${itemLabel} — ${borrower} owes ${lender}, due ${due}`
        };
      }),
    [openBorrows, items, formatDate, formatQuantity, t]
  );

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={projectStockTransferValidator}
            method="post"
            action={path.to.newProjectStockTransfer}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>New Project Stock Transfer</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Select
                  name="type"
                  label={t`Type`}
                  options={(["Transfer", "Borrow", "Payback"] as const).map(
                    (value) => ({ value, label: typeLabels[value] })
                  )}
                  onChange={(option) =>
                    setType(
                      (option?.value as ProjectStockTransferType) ?? "Transfer"
                    )
                  }
                />
                {type === "Payback" ? (
                  <>
                    <Select
                      name="settlesBorrowId"
                      label={t`Borrow`}
                      options={borrowOptions}
                      helperText={t`The stock goes back from the borrower to the lender`}
                    />
                    <Hidden name="fromProjectId" />
                    <Hidden name="toProjectId" />
                    <Hidden name="locationId" />
                  </>
                ) : (
                  <>
                    <Select
                      name="fromProjectId"
                      label={t`From`}
                      options={
                        type === "Borrow" ? projectOptions : ownerOptions
                      }
                    />
                    <Select
                      name="toProjectId"
                      label={t`To`}
                      options={
                        type === "Borrow" ? projectOptions : ownerOptions
                      }
                    />
                    <Location name="locationId" label={t`Location`} />
                    {type === "Borrow" && (
                      <DatePicker
                        name="paybackDueDate"
                        label={t`Payback Due Date`}
                      />
                    )}
                  </>
                )}
                <TextArea name="reason" label={t`Reason`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "projects")}>
                  <Trans>Create</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ProjectStockTransferForm;
