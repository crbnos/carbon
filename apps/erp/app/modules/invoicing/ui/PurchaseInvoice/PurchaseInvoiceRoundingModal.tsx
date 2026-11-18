// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Number, Submit } from "~/components/Form";
import { useCurrencyDecimals, useCurrencyFormatter } from "~/hooks";
import {
  MAX_ROUNDING_MINOR_UNITS,
  purchaseInvoiceRoundingValidator
} from "~/modules/invoicing/invoicing.models";
import type { action as roundingAction } from "~/routes/x+/purchase-invoice+/$invoiceId.rounding";
import { path } from "~/utils/path";

/** Brings a Draft invoice to the amount the supplier actually charged. The
 *  server computes and books the difference on the Rounding Account. */
export default function PurchaseInvoiceRoundingModal({
  invoiceId,
  currencyCode,
  total,
  open,
  onClose
}: {
  invoiceId: string;
  currencyCode: string;
  /** The invoice total in its own currency. */
  total: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const decimals = useCurrencyDecimals(currencyCode);
  const formatter = useCurrencyFormatter({
    currency: currencyCode,
    decimalPlaces: decimals
  });
  const fetcher = useAction<typeof roundingAction>({
    onSuccess: () => {
      toast.success(t`Rounding adjusted`);
      onClose();
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.purchaseInvoiceRounding(invoiceId)}
          validator={purchaseInvoiceRoundingValidator}
          defaultValues={{ targetTotal: total }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Adjust for Rounding</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Enter the amount the supplier charged. The difference is added
                as a line on the Rounding Account, up to{" "}
                {formatter.format(MAX_ROUNDING_MINOR_UNITS / 10 ** decimals)}.
                Other lines keep their prices.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <p className="text-sm">
              <Trans>Current total: {formatter.format(total)}</Trans>
            </p>
            <Number
              name="targetTotal"
              label={t`Amount to match`}
              formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
            />
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button type="button" variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false}>
                <Trans>Adjust</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
