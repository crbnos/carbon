// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  RadioGroup,
  RadioGroupItem,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical, LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import {
  DatePicker,
  Employee,
  Hidden,
  LaborCategory,
  Number as NumberField,
  Submit,
  useLaborCategories
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter
} from "~/hooks";
import { contractLaborRateValidator } from "../../sales.models";
import ContractMoney from "./ContractMoney";

export type ContractLaborRate = {
  id: string;
  laborCategoryId: string | null;
  employeeId: string | null;
  billRate: number;
  effectiveFrom: string;
};

/**
 * The bill rates of a Time & Materials line: per labor category, and per
 * employee (which wins), each effective from a date. With no rate here, an
 * hour bills at its labor category's default bill rate; with none at all the
 * item is held for "No bill rate".
 */
export default function ContractLaborRates({
  lineId,
  rates,
  currencyCode,
  action,
  isDisabled
}: {
  lineId: string;
  rates: ContractLaborRate[];
  currencyCode: string;
  /** The labor-rates action route of the line. */
  action: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const categories = useLaborCategories();
  const categoryName = new Map(
    categories.map((category) => [category.value, category.label])
  );
  const [editing, setEditing] = useState<ContractLaborRate | "new" | null>(
    null
  );
  const [deleting, setDeleting] = useState<ContractLaborRate | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Labor Rates</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              An employee's rate wins over a labor category's. With neither, an
              hour bills at the labor category's default bill rate.
            </Trans>
          </CardDescription>
          <CardAction>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={isDisabled}
              onClick={() => setEditing("new")}
            >
              <Trans>Add Rate</Trans>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No contract rates. Hours bill at the default rates.</Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-full">
                    <Trans>Labor Category or Employee</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Bill Rate</Trans>
                  </Th>
                  <Th>
                    <Trans>Effective From</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {rates.map((rate) => (
                  <Tr key={rate.id}>
                    <Td>
                      {rate.employeeId ? (
                        <EmployeeAvatar employeeId={rate.employeeId} />
                      ) : (
                        <span className="truncate">
                          {categoryName.get(rate.laborCategoryId ?? "") ??
                            rate.laborCategoryId}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={rate.billRate}
                        currencyCode={currencyCode}
                        rate
                      />
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(rate.effectiveFrom)}
                    </Td>
                    <Td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`Rate actions`}
                            icon={<LuEllipsisVertical />}
                            variant="ghost"
                            size="sm"
                            isDisabled={isDisabled}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(rate)}>
                            <DropdownMenuIcon icon={<LuPencil />} />
                            <Trans>Edit Rate</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            onClick={() => setDeleting(rate)}
                          >
                            <DropdownMenuIcon icon={<LuTrash />} />
                            <Trans>Delete Rate</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <LaborRateModal
          key={editing === "new" ? "new" : editing.id}
          lineId={lineId}
          rate={editing === "new" ? null : editing}
          currencyCode={currencyCode}
          action={action}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={action}
          isOpen
          name={t`Rate`}
          text={t`Are you sure you want to delete this bill rate?`}
          fields={{ intent: "delete", id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** One bill rate: for a labor category or for one employee. */
function LaborRateModal({
  lineId,
  rate,
  currencyCode,
  action,
  onClose
}: {
  lineId: string;
  rate: ContractLaborRate | null;
  currencyCode: string;
  action: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  const decimals = useCurrencyDecimals(currencyCode);
  const [appliesTo, setAppliesTo] = useState<"category" | "employee">(
    rate?.employeeId ? "employee" : "category"
  );
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save the rate`)
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          validator={contractLaborRateValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            id: rate?.id,
            customerContractLineId: lineId,
            laborCategoryId: rate?.laborCategoryId ?? undefined,
            employeeId: rate?.employeeId ?? undefined,
            billRate: rate ? Number(rate.billRate) : 0,
            effectiveFrom: rate?.effectiveFrom ?? today
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {rate ? <Trans>Edit Rate</Trans> : <Trans>Add Rate</Trans>}
            </ModalTitle>
            <ModalDescription>
              <Trans>The price of one hour on this line.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="upsert" />
            <Hidden name="id" />
            <Hidden name="customerContractLineId" />
            <VStack spacing={4}>
              <RadioGroup
                value={appliesTo}
                onValueChange={(value) =>
                  setAppliesTo(value === "employee" ? "employee" : "category")
                }
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="category" />
                  <Trans>Labor category</Trans>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="employee" />
                  <Trans>Employee</Trans>
                </label>
              </RadioGroup>
              {appliesTo === "employee" ? (
                <Employee name="employeeId" label={t`Employee`} />
              ) : (
                <LaborCategory
                  name="laborCategoryId"
                  label={t`Labor Category`}
                />
              )}
              <NumberField
                name="billRate"
                label={t`Bill Rate`}
                minValue={0}
                step={INPUT_STEP.rate}
                formatOptions={INPUT_FORMAT.rate(currencyCode, decimals)}
              />
              <DatePicker name="effectiveFrom" label={t`Effective From`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
