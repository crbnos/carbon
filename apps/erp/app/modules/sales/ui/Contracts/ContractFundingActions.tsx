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
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical, LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import {
  DatePicker,
  Hidden,
  Input,
  Number as NumberField,
  Submit
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCompanyToday,
  useCurrencyDecimals,
  useDateFormatter
} from "~/hooks";
import { customerContractFundingValidator } from "../../sales.models";
import ContractMoney from "./ContractMoney";

export type ContractFundingAction = {
  id: string;
  modificationNumber: string;
  fundedDate: string;
  acrn: string;
  fundedCost: number;
  fundedFee: number;
  expiresOn: string | null;
};

/**
 * The funding actions of a billing line: one row per contract modification
 * that funds it, under an ACRN. In DCAA mode their sums are the line's funded
 * cost and funded amount (cost + fee).
 */
export default function ContractFundingActions({
  lineId,
  actions,
  currencyCode,
  action,
  isDisabled
}: {
  lineId: string;
  actions: ContractFundingAction[];
  currencyCode: string;
  /** The funding-actions route of the line. */
  action: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const [editing, setEditing] = useState<ContractFundingAction | "new" | null>(
    null
  );
  const [deleting, setDeleting] = useState<ContractFundingAction | null>(null);

  const totalCost = actions.reduce(
    (sum, row) => sum + Number(row.fundedCost),
    0
  );
  const totalFee = actions.reduce((sum, row) => sum + Number(row.fundedFee), 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Funding Actions</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Each contract modification that funds this line, by ACRN.
            </Trans>
          </CardDescription>
          <CardAction>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={isDisabled}
              onClick={() => setEditing("new")}
            >
              <Trans>Add Funding</Trans>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No funding actions yet.</Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-full">
                    <Trans>Modification</Trans>
                  </Th>
                  <Th>
                    <Trans>Funded</Trans>
                  </Th>
                  <Th>
                    <Trans>ACRN</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Funded Cost</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Funded Fee</Trans>
                  </Th>
                  <Th>
                    <Trans>Expires</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {actions.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <span className="truncate">{row.modificationNumber}</span>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDate(row.fundedDate)}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-xs">
                      {row.acrn}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={Number(row.fundedCost)}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ContractMoney
                        value={Number(row.fundedFee)}
                        currencyCode={currencyCode}
                      />
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {row.expiresOn ? formatDate(row.expiresOn) : "—"}
                    </Td>
                    <Td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`Funding action actions`}
                            icon={<LuEllipsisVertical />}
                            variant="ghost"
                            size="sm"
                            isDisabled={isDisabled}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(row)}>
                            <DropdownMenuIcon icon={<LuPencil />} />
                            <Trans>Edit Funding</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            onClick={() => setDeleting(row)}
                          >
                            <DropdownMenuIcon icon={<LuTrash />} />
                            <Trans>Delete Funding</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
              <Tfoot>
                <Tr className="font-medium">
                  <Td colSpan={3}>
                    <Trans>Total</Trans>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ContractMoney
                      value={totalCost}
                      currencyCode={currencyCode}
                    />
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ContractMoney
                      value={totalFee}
                      currencyCode={currencyCode}
                    />
                  </Td>
                  <Td colSpan={2} />
                </Tr>
              </Tfoot>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <FundingActionModal
          key={editing === "new" ? "new" : editing.id}
          lineId={lineId}
          row={editing === "new" ? null : editing}
          currencyCode={currencyCode}
          action={action}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={action}
          isOpen
          name={deleting.modificationNumber}
          text={t`Are you sure you want to delete this funding action?`}
          fields={{ intent: "delete", id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
}

/** One funding action: a modification number, an ACRN and its amounts. */
function FundingActionModal({
  lineId,
  row,
  currencyCode,
  action,
  onClose
}: {
  lineId: string;
  row: ContractFundingAction | null;
  currencyCode: string;
  action: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const today = useCompanyToday();
  const decimals = useCurrencyDecimals(currencyCode);
  const money = {
    minValue: 0,
    step: INPUT_STEP.money(decimals),
    formatOptions: INPUT_FORMAT.money(currencyCode, decimals)
  };
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save the funding action`)
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          validator={customerContractFundingValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            id: row?.id,
            customerContractLineId: lineId,
            modificationNumber: row?.modificationNumber ?? "",
            fundedDate: row?.fundedDate ?? today,
            acrn: row?.acrn ?? "",
            fundedCost: row ? Number(row.fundedCost) : 0,
            fundedFee: row ? Number(row.fundedFee) : 0,
            expiresOn: row?.expiresOn ?? undefined
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {row ? <Trans>Edit Funding</Trans> : <Trans>Add Funding</Trans>}
            </ModalTitle>
            <ModalDescription>
              <Trans>A funding change applies from the next billing run.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="upsert" />
            <Hidden name="id" />
            <Hidden name="customerContractLineId" />
            <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
              <Input name="modificationNumber" label={t`Modification Number`} />
              <DatePicker name="fundedDate" label={t`Funded Date`} />
              <Input
                name="acrn"
                label={t`ACRN`}
                helperText={t`2 capital letters or digits`}
                maxLength={2}
              />
              <DatePicker name="expiresOn" label={t`Expires On`} />
              <NumberField
                name="fundedCost"
                label={t`Funded Cost`}
                {...money}
              />
              <NumberField name="fundedFee" label={t`Funded Fee`} {...money} />
            </div>
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
