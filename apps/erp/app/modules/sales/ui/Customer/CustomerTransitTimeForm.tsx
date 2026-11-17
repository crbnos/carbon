// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  CustomerLocation,
  Hidden,
  Number,
  ShippingMethod,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerLocationTransitTimeValidator } from "../../sales.models";

type CustomerTransitTimeFormProps = {
  customerId: string;
  initialValues: z.infer<typeof customerLocationTransitTimeValidator>;
  open?: boolean;
  onClose: () => void;
};

const CustomerTransitTimeForm = ({
  customerId,
  initialValues,
  open = true,
  onClose
}: CustomerTransitTimeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  // A save redirects back to the Shipping tab; an error is toasted and the
  // drawer stays open.
  const fetcher = useAction();

  const isEditing = !!initialValues.id;
  // Saving goes through upsertCustomerLocationTransitTime, which needs
  // update on sales, and create too for a new row.
  const isDisabled =
    !permissions.can("update", "sales") ||
    (!isEditing && !permissions.can("create", "sales"));

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={customerLocationTransitTimeValidator}
          method="post"
          action={
            isEditing
              ? path.to.customerTransitTime(customerId, initialValues.id!)
              : path.to.newCustomerTransitTime(customerId)
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Transit Time</Trans>
              ) : (
                <Trans>New Transit Time</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <CustomerLocation
                name="customerLocationId"
                label={t`Ship To`}
                customer={customerId}
              />
              <ShippingMethod
                name="shippingMethodId"
                label={t`Shipping Method`}
              />
              <Number
                name="transitDays"
                label={t`Transit Days`}
                termId="customer-location-transit-time"
                minValue={0}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CustomerTransitTimeForm;
