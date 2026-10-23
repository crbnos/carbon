// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertTitle,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { z } from "zod";
import {
  Boolean,
  Combobox,
  Hidden,
  Input,
  Item,
  Number,
  NumberControlled,
  SelectControlled,
  Submit
} from "~/components/Form";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import { serviceJobItemValidator } from "../../service.models";
import type { CostLineSource, LinkableCostLine } from "../../service.service";
import { useItemSalePrice } from "./useItemSalePrice";

type PaidBy = CostLineSource | "none";

type ServiceJobChargeFormProps = {
  initialValues: z.infer<typeof serviceJobItemValidator>;
  /** The posted lines the charge's cost can be linked to. */
  costLines: LinkableCostLine[];
  /** The account the job's cost goes to, when it is set. */
  coverageAccount: { id: string; name: string; number: string | null } | null;
  isLocked: boolean;
  onClose: () => void;
};

/** "4000 Travel", or the name alone. */
function accountLabel(account: { name: string | null; number: string | null }) {
  return [account.number, account.name].filter((part) => !!part).join(" ");
}

/**
 * A charge on a job: a Service item with a price, such as a trip fee. Picking
 * the item fills in its sale price. A charge that was a real cost names the
 * reimbursement or supplier invoice line that paid it; the cost is that
 * line's amount, and the job posts nothing for it.
 */
const ServiceJobChargeForm = ({
  initialValues,
  costLines,
  coverageAccount,
  isLocked,
  onClose
}: ServiceJobChargeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const formatMoney = useCurrencyFormatter();
  const formatRate = useCurrencyFormatter({ rate: true });
  const getSalePrice = useItemSalePrice();

  const [paidBy, setPaidBy] = useState<PaidBy>(
    initialValues.reimbursementLineId
      ? "reimbursement"
      : initialValues.purchaseInvoiceLineId
        ? "purchaseInvoice"
        : "none"
  );
  const [costLineId, setCostLineId] = useState<string | null>(
    initialValues.reimbursementLineId ??
      initialValues.purchaseInvoiceLineId ??
      null
  );
  const [quantity, setQuantity] = useState(initialValues.quantity);
  const costLine =
    paidBy === "none"
      ? undefined
      : costLines.find(
          (line) => line.source === paidBy && line.id === costLineId
        );
  const costLineOptions = costLines
    .filter((line) => line.source === paidBy)
    .map((line) => ({
      value: line.id,
      label:
        line.description ||
        accountLabel({ name: line.accountName, number: line.accountNumber }) ||
        line.documentReadableId,
      helper: line.documentReadableId,
      helperRight: formatMoney.format(line.amount)
    }));
  const unitCost =
    costLine && quantity > 0
      ? formatRate.format(costLine.amount / quantity)
      : null;
  // The linked document already posted the cost. When it posted to another
  // account than the job's, the job's margin and the ledger disagree.
  const lineAccount =
    costLine?.accountId &&
    coverageAccount &&
    costLine.accountId !== coverageAccount.id
      ? accountLabel({
          name: costLine.accountName,
          number: costLine.accountNumber
        })
      : null;
  const jobAccount = coverageAccount ? accountLabel(coverageAccount) : null;

  const isEditing = !!initialValues.id;
  const isDisabled = isLocked || !permissions.can("update", "service");

  const [unitPrice, setUnitPrice] = useState(initialValues.unitPrice);
  const [unitOfMeasureCode, setUnitOfMeasureCode] = useState(
    initialValues.unitOfMeasureCode ?? ""
  );

  const fetcher = useAction({ onSuccess: onClose });

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={serviceJobItemValidator}
          method="post"
          action={
            isEditing
              ? path.to.serviceJobItem(
                  initialValues.serviceJobId,
                  initialValues.id!
                )
              : path.to.newServiceJobItem(initialValues.serviceJobId)
          }
          className="flex flex-col h-full"
          fetcher={fetcher}
          isDisabled={isDisabled}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Charge` : t`New Charge`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="serviceJobId" />
            <Hidden name="unitOfMeasureCode" value={unitOfMeasureCode} />
            <VStack spacing={4}>
              <Item
                name="itemId"
                label={t`Item`}
                type="Service"
                validItemTypes={["Service"]}
                onChange={async (value) => {
                  const itemId = value?.value as string | undefined;
                  if (!itemId) return;
                  const defaults = await getSalePrice(itemId);
                  setUnitPrice(defaults.unitPrice);
                  setUnitOfMeasureCode(defaults.unitOfMeasureCode ?? "");
                }}
              />
              <Input name="description" label={t`Description`} />
              <Number
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
                onChange={setQuantity}
              />
              <NumberControlled
                name="unitPrice"
                label={t`Unit Price`}
                value={unitPrice}
                onChange={setUnitPrice}
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(
                  currencyCode,
                  currencyDecimals
                )}
                step={INPUT_STEP.rate}
              />
              <Boolean name="billable" label={t`Billable`} />
              <SelectControlled
                name="paidBy"
                label={t`Paid By`}
                value={paidBy}
                options={[
                  { value: "none", label: t`None` },
                  { value: "reimbursement", label: t`Reimbursement line` },
                  {
                    value: "purchaseInvoice",
                    label: t`Supplier invoice line`
                  }
                ]}
                onChange={(option) => {
                  setPaidBy((option?.value as PaidBy | undefined) ?? "none");
                  setCostLineId(null);
                }}
              />
              {paidBy !== "none" && (
                <Combobox
                  key={paidBy}
                  name={
                    paidBy === "reimbursement"
                      ? "reimbursementLineId"
                      : "purchaseInvoiceLineId"
                  }
                  label={
                    paidBy === "reimbursement"
                      ? t`Reimbursement Line`
                      : t`Supplier Invoice Line`
                  }
                  options={costLineOptions}
                  value={costLineId ?? ""}
                  emptyMessage={
                    paidBy === "reimbursement"
                      ? t`No posted reimbursement lines`
                      : t`No posted supplier invoice lines`
                  }
                  helperText={unitCost ? t`Cost ${unitCost} each` : undefined}
                  onChange={(option) => setCostLineId(option?.value ?? null)}
                />
              )}
              {lineAccount && jobAccount && (
                <Alert variant="warning">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>
                    <Trans>
                      This cost posted to {lineAccount}, not the job's{" "}
                      {jobAccount}.
                    </Trans>
                  </AlertTitle>
                </Alert>
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ServiceJobChargeForm;
