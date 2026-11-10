// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  AddressAutocomplete,
  Currency,
  Input,
  Submit,
  Timezone
} from "~/components/Form";
import { companyValidator } from "~/modules/settings/settings.models";
import { path } from "~/utils/path";

/**
 * Adds a company for an admin: the company breadcrumb's and the phone
 * company finder's "Add Company". Posts to `path.to.newCompany`.
 */
export function AddCompanyModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          action={path.to.newCompany}
          validator={companyValidator}
          method="post"
          onAfterSubmit={onClose}
          defaultValues={{
            countryCode: "US",
            baseCurrencyCode: "USD",
            timezone: getLocalTimeZone()
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Let's set up your new company</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Input autoFocus name="name" label={t`Company Name`} />
              <AddressAutocomplete variant="grid" />
              <Timezone name="timezone" label={t`Timezone`} />
              <Currency name="baseCurrencyCode" label={t`Base Currency`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
