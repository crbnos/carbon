// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Number as NumberField, Submit } from "~/components/Form";
import { useCurrencyDecimals, useUser } from "~/hooks";
import {
  serviceJobFixedPriceValidator,
  serviceJobRequiredFixedPriceValidator
} from "../../service.models";

/**
 * The confirm dialog of Complete and Create Invoice. On a Fixed Price job
 * with no price it asks for one; `onConfirm` gets it, and the caller posts.
 */
export function ServiceJobActionModal({
  open = true,
  title,
  description,
  submitLabel,
  needsFixedPrice,
  isPending,
  onConfirm,
  onClose
}: {
  open?: boolean;
  title: ReactNode;
  description: ReactNode;
  submitLabel: ReactNode;
  needsFixedPrice: boolean;
  isPending: boolean;
  onConfirm: (fixedPrice: number | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={
            needsFixedPrice
              ? serviceJobRequiredFixedPriceValidator
              : serviceJobFixedPriceValidator
          }
          onSubmit={(data, event) => {
            // The caller posts: Complete may stop the clock first.
            event.preventDefault();
            onConfirm(needsFixedPrice ? data.fixedPrice : undefined);
          }}
        >
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
            <ModalDescription>{description}</ModalDescription>
          </ModalHeader>
          {needsFixedPrice && (
            <ModalBody>
              <NumberField
                name="fixedPrice"
                label={t`Fixed price`}
                helperText={t`This Fixed Price job has no price.`}
                minValue={0}
                formatOptions={INPUT_FORMAT.money(
                  currencyCode,
                  currencyDecimals
                )}
                step={INPUT_STEP.money(currencyDecimals)}
              />
            </ModalBody>
          )}
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              isLoading={isPending}
              isDisabled={isPending}
              withBlocker={false}
            >
              {submitLabel}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default ServiceJobActionModal;
