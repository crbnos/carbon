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
  ModalDrawerDescription,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  Customer,
  CustomerLocation,
  DatePicker,
  Input,
  Item,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerAssetValidator } from "../../service.models";

type CustomerAssetFormProps = {
  initialValues: Partial<z.input<typeof customerAssetValidator>>;
  onClose: () => void;
};

/**
 * Registers a unit sold before Carbon: its item, the serial on its plate,
 * the customer that owns it, and the warranty it still carries. A unit Carbon
 * ships becomes an asset by itself.
 */
const CustomerAssetForm = ({
  initialValues,
  onClose
}: CustomerAssetFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const [customerId, setCustomerId] = useState<string | undefined>(
    initialValues.customerId
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
            validator={customerAssetValidator}
            method="post"
            action={path.to.newCustomerAsset}
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>New Customer Asset</Trans>
              </ModalDrawerTitle>
              <ModalDrawerDescription>
                <Trans>
                  Register a unit sold before Carbon. A unit Carbon ships
                  becomes an asset when it ships.
                </Trans>
              </ModalDrawerDescription>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Item name="itemId" label={t`Item`} type="Part" />
                <Input name="serialNumber" label={t`Serial`} />
                <Customer
                  name="customerId"
                  label={t`Customer`}
                  onChange={(value) => setCustomerId(value?.value)}
                />
                <CustomerLocation
                  name="customerLocationId"
                  label={t`Site`}
                  customer={customerId}
                  isOptional
                />
                <DatePicker name="shippedDate" label={t`Ship Date`} />
                <DatePicker
                  name="laborWarrantyEndDate"
                  label={t`Labor Warranty Ends`}
                />
                <DatePicker
                  name="partsWarrantyEndDate"
                  label={t`Parts Warranty Ends`}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit
                  hideShortcutKey
                  isDisabled={!permissions.can("create", "service")}
                >
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default CustomerAssetForm;
