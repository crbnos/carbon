// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Account, DatePicker, Submit } from "~/components/Form";
import { useCurrencyFormatter, useUser } from "~/hooks";
import { purchaseInvoicePostToLedgerValidator } from "~/modules/invoicing/invoicing.models";
import type {
  action as postToLedgerAction,
  loader as previewLoader
} from "~/routes/x+/purchase-invoice+/$invoiceId.post-to-ledger";
import { path } from "~/utils/path";

/** Posts a purchase invoice from before the accounting cutover, whose amount
 *  never reached the GL, as the invoice posting would post it today. Shows
 *  the journal first; the server builds both from the same plan. */
export default function PurchaseInvoicePostToLedgerModal({
  invoiceId,
  cutoverDate,
  defaultPostingDate,
  defaultOffsetAccountId,
  open,
  onClose
}: {
  invoiceId: string;
  /** The earliest date the journal can take. */
  cutoverDate: string;
  /** The first date on or after the cutover in an Open period. */
  defaultPostingDate: string;
  /** The company's Migration Clearing account, the offset unless another
   *  is chosen. */
  defaultOffsetAccountId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const formatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const [postingDate, setPostingDate] = useState(defaultPostingDate);
  const [offsetAccountId, setOffsetAccountId] = useState<string | undefined>(
    defaultOffsetAccountId ?? undefined
  );

  const preview = useFetcher<typeof previewLoader>();
  const { load } = preview;
  useEffect(() => {
    if (!open || !postingDate) return;
    const search = new URLSearchParams({ postingDate });
    if (offsetAccountId) search.set("openingOffsetAccountId", offsetAccountId);
    load(`${path.to.purchaseInvoicePostToLedger(invoiceId)}?${search}`);
  }, [open, load, invoiceId, postingDate, offsetAccountId]);

  const fetcher = useAction<typeof postToLedgerAction>({
    onSuccess: () => {
      toast.success(t`Invoice posted to the GL`);
      onClose();
    }
  });

  const result = preview.data;
  const lines = result?.data?.lines ?? [];
  const refusal = result?.error?.message ?? null;
  const loading = preview.state !== "idle";
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent size="large">
        <ValidatedForm
          method="post"
          action={path.to.purchaseInvoicePostToLedger(invoiceId)}
          validator={purchaseInvoicePostToLedgerValidator}
          defaultValues={{
            postingDate: defaultPostingDate,
            openingOffsetAccountId: defaultOffsetAccountId ?? undefined
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Post to GL</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                This invoice was posted before the accounting cutover, and its
                amount never reached the GL, so payments cannot be applied to
                it. Posting books what each line would book today: received
                goods clear GR/IR, goods still in stock add to their inventory
                cost, used goods go to purchase price variance, and Accounts
                Payable is credited for the invoice. The invoice itself does not
                change.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <DatePicker
              name="postingDate"
              label={t`Posting Date`}
              minValue={parseDate(cutoverDate)}
              onChange={(date) => setPostingDate(date ?? "")}
            />
            {result?.data?.hasOpeningValue && (
              <Account
                name="openingOffsetAccountId"
                label={t`Offset for value in the opening balance`}
                helperText={t`Part of this invoice is already in the opening inventory. That part is posted to this account instead of inventory.`}
                onChange={(account) => setOffsetAccountId(account?.value)}
              />
            )}
            {refusal ? (
              <Alert variant="destructive">
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            ) : loading && lines.length === 0 ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Account</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Debit</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Credit</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lines.map((line) => (
                    <Tr key={`${line.accountId}-${line.description}`}>
                      <Td>
                        <div>
                          {line.accountNumber
                            ? `${line.accountNumber} ${line.accountName}`
                            : line.accountName}
                        </div>
                        {line.description !== line.accountName && (
                          <div className="text-xs text-muted-foreground">
                            {line.description}
                          </div>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {line.debit ? formatter.format(line.debit) : ""}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {line.credit ? formatter.format(line.credit) : ""}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
                <Tfoot>
                  <Tr>
                    <Td className="font-medium">
                      <Trans>Total</Trans>
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatter.format(totalDebit)}
                    </Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatter.format(totalCredit)}
                    </Td>
                  </Tr>
                </Tfoot>
              </Table>
            )}
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button type="button" variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit
                withBlocker={false}
                isDisabled={!!refusal || loading || lines.length === 0}
              >
                <Trans>Post</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
