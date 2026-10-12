// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  ChoiceCardGroup,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuSquareUser, LuUsers } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import type { z } from "zod";
import {
  Customer,
  CustomerType,
  DatePicker,
  Hidden,
  Number,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { customerItemRentalRateValidator } from "~/modules/sales";
import { path } from "~/utils/path";

type Scope = "customer" | "customerType";

type CustomerRentalRateFormProps = {
  initialValues: z.infer<typeof customerItemRentalRateValidator>;
};

/** Day / week / month rates agreed with one customer, or with every customer
 *  of a type. A rental unit's rate starts from it ahead of the item's own. */
const CustomerRentalRateForm = ({
  initialValues
}: CustomerRentalRateFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const [scope, setScope] = useState<Scope>(
    initialValues.customerTypeId ? "customerType" : "customer"
  );
  const currencyDecimals = useCurrencyDecimals(initialValues.currencyCode);
  const rateFormat = INPUT_FORMAT.rate(
    initialValues.currencyCode,
    currencyDecimals
  );

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  const onClose = () => navigate(path.to.partSales(itemId));

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={customerItemRentalRateValidator}
          method="post"
          action={
            isEditing
              ? path.to.customerRentalRate(itemId, initialValues.id!)
              : path.to.newCustomerRentalRate(itemId)
          }
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing
                ? t`Edit Customer Rental Rates`
                : t`New Customer Rental Rates`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="itemId" />
            <Hidden name="currencyCode" />

            <VStack spacing={4}>
              <ChoiceCardGroup<Scope>
                label={t`Apply To`}
                value={scope}
                onChange={setScope}
                options={[
                  {
                    value: "customer",
                    title: t`Specific Customer`,
                    description: t`Rates for a single customer`,
                    icon: <LuSquareUser />
                  },
                  {
                    value: "customerType",
                    title: t`Customer Type`,
                    description: t`Rates for all customers of a type`,
                    icon: <LuUsers />
                  }
                ]}
              />

              {scope === "customer" ? (
                <>
                  <Customer name="customerId" label={t`Customer`} />
                  <Hidden name="customerTypeId" value="" />
                </>
              ) : (
                <>
                  <CustomerType
                    name="customerTypeId"
                    label={t`Customer Type`}
                  />
                  <Hidden name="customerId" value="" />
                </>
              )}

              <Number
                name="dayRate"
                label={t`Day Rate`}
                minValue={0}
                formatOptions={rateFormat}
              />
              <Number
                name="weekRate"
                label={t`Week Rate`}
                minValue={0}
                formatOptions={rateFormat}
              />
              <Number
                name="monthRate"
                label={t`Month Rate`}
                minValue={0}
                formatOptions={rateFormat}
              />

              <div className="grid grid-cols-2 gap-3 w-full">
                <DatePicker name="validFrom" label={t`Valid From`} />
                <DatePicker name="validTo" label={t`Valid To`} />
              </div>

              <TextArea name="notes" label={t`Notes`} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CustomerRentalRateForm;
