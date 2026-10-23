// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Hidden,
  Number as NumberField,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  type BillableItemAction,
  billableItemActionValidator
} from "../../projects.models";
import type { ContractBillableItem } from "../../types";

/**
 * One review action on the selected billable items: hold or write off (a
 * reason is required), release, or a new unit price for one item. Posts to
 * Projects → Billing's update route; the change reaches the audit log.
 */
export default function BillableItemActionModal({
  action,
  items,
  onClose
}: {
  action: BillableItemAction;
  items: ContractBillableItem[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  // Billing lines need the contract currency to be the base currency (P5).
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currencyCode);
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to update the items`)
  });

  const count = items.length;
  const titles: Record<BillableItemAction, string> = {
    hold: t`Hold Items`,
    release: t`Release Items`,
    writeOff: t`Write Off Items`,
    price: t`Edit Price`
  };
  const description =
    action === "price"
      ? (items[0]?.description ?? "")
      : count === 1
        ? t`1 item`
        : t`${count} items`;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          validator={billableItemActionValidator}
          method="post"
          action={path.to.projectsBillingUpdate}
          fetcher={fetcher}
          defaultValues={{
            ids: items.map((item) => item.id),
            action,
            unitPrice:
              action === "price" ? Number(items[0]?.unitPrice ?? 0) : undefined
          }}
        >
          <ModalHeader>
            <ModalTitle>{titles[action]}</ModalTitle>
            <ModalDescription>{description}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            {items.map((item) => (
              <Hidden key={item.id} name="ids" value={item.id} />
            ))}
            <Hidden name="action" value={action} />
            <VStack spacing={4}>
              {action === "price" && (
                <NumberField
                  name="unitPrice"
                  label={t`Unit Price`}
                  minValue={0}
                  step={INPUT_STEP.rate}
                  formatOptions={INPUT_FORMAT.rate(currencyCode, decimals)}
                />
              )}
              {(action === "hold" || action === "writeOff") && (
                <>
                  <TextArea name="reason" label={t`Reason`} />
                  <p className="text-xs text-muted-foreground">
                    {action === "writeOff" ? (
                      <Trans>A written off item is never billed.</Trans>
                    ) : (
                      <Trans>
                        The reason shows on the item until it is released.
                      </Trans>
                    )}
                  </p>
                </>
              )}
              {action === "release" && (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Released items bill on the next invoice run, within the
                    line's funding.
                  </Trans>
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>{titles[action]}</Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
