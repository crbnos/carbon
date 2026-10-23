// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  Hidden,
  Input,
  Item,
  Number,
  NumberControlled,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { serviceJobItemValidator } from "../../service.models";
import { useItemSalePrice } from "./useItemSalePrice";

type ServiceJobChargeFormProps = {
  initialValues: z.infer<typeof serviceJobItemValidator>;
  isLocked: boolean;
  onClose: () => void;
};

/**
 * A charge on a job: a Service item with a price, such as a trip fee. Picking
 * the item fills in its sale price.
 */
const ServiceJobChargeForm = ({
  initialValues,
  isLocked,
  onClose
}: ServiceJobChargeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const getSalePrice = useItemSalePrice();

  const isEditing = !!initialValues.id;
  const isDisabled = isLocked || !permissions.can("update", "service");

  const [unitPrice, setUnitPrice] = useState(initialValues.unitPrice);
  const [unitOfMeasureCode, setUnitOfMeasureCode] = useState(
    initialValues.unitOfMeasureCode ?? ""
  );

  const fetcher = useAction({ onSuccess: onClose });

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
          validator={serviceJobItemValidator}
          method="post"
          action={
            isEditing
              ? path.to.serviceJobItem(
                  initialValues.serviceJobId,
                  initialValues.id!
                )
              : path.to.newServiceJobItem(initialValues.serviceJobId)
          }
          className="flex flex-col h-full"
          fetcher={fetcher}
          isDisabled={isDisabled}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Charge` : t`New Charge`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="serviceJobId" />
            <Hidden name="unitOfMeasureCode" value={unitOfMeasureCode} />
            <VStack spacing={4}>
              <Item
                name="itemId"
                label={t`Item`}
                type="Service"
                validItemTypes={["Service"]}
                onChange={async (value) => {
                  const itemId = value?.value as string | undefined;
                  if (!itemId) return;
                  const defaults = await getSalePrice(itemId);
                  setUnitPrice(defaults.unitPrice);
                  setUnitOfMeasureCode(defaults.unitOfMeasureCode ?? "");
                }}
              />
              <Input name="description" label={t`Description`} />
              <Number
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <NumberControlled
                name="unitPrice"
                label={t`Unit Price`}
                value={unitPrice}
                onChange={setUnitPrice}
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(
                  currencyCode,
                  currencyDecimals
                )}
                step={INPUT_STEP.rate}
              />
              <Boolean name="billable" label={t`Billable`} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
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

export default ServiceJobChargeForm;
