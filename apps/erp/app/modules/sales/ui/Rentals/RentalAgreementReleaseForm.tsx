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
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DatePicker, Hidden, Submit } from "~/components/Form";
import { useCompanyToday, usePermissions } from "~/hooks";
import { rentalAgreementReleaseValidator } from "../../sales.models";

type RentalAgreementReleaseFormProps = {
  initialValues: z.infer<typeof rentalAgreementReleaseValidator>;
  unitLabel: string;
  /** Where the form posts when it is opened from a page rather than as its
   *  own route; it then also closes on submit. */
  action?: string;
  onClose: () => void;
};

const RentalAgreementReleaseForm = ({
  initialValues,
  unitLabel,
  action,
  onClose
}: RentalAgreementReleaseFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const today = useCompanyToday();

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={rentalAgreementReleaseValidator}
            method="post"
            action={action}
            fetcher={action ? fetcher : undefined}
            defaultValues={initialValues}
            className="flex flex-col h-full"
            onSubmit={action ? onClose : undefined}
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>{t`Release ${unitLabel}`}</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="rentalAgreementLineId" />
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    The unit never left the yard. Billing stops on the release
                    date, and the unit is free again.
                  </Trans>
                </p>
                <DatePicker
                  name="returnedAt"
                  label={t`Release date`}
                  maxValue={parseDate(today)}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "sales")}>
                  <Trans>Release unit</Trans>
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

export default RentalAgreementReleaseForm;
