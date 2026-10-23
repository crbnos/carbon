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
  Hidden,
  Input,
  Item,
  Number,
  NumberControlled,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { serviceJobEstimateLineValidator } from "../../service.models";
import { useItemSalePrice } from "./useItemSalePrice";

type ServiceJobEstimateLineFormProps = {
  initialValues: z.infer<typeof serviceJobEstimateLineValidator>;
  isLocked: boolean;
  onClose: () => void;
};

/**
 * A priced line of a job's estimate: a labor item (its quantity is hours), a
 * part or a charge item. Picking the item fills in its sale price.
 */
const ServiceJobEstimateLineForm = ({
  initialValues,
  isLocked,
  onClose
}: ServiceJobEstimateLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const getSalePrice = useItemSalePrice();

  const isEditing = !!initialValues.id;
  const isDisabled = isLocked || !permissions.can("update", "service");

  const [unitPrice, setUnitPrice] = useState(initialValues.unitPrice);
  const [itemType, setItemType] = useState<MethodItemType | "Item">("Item");

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
          validator={serviceJobEstimateLineValidator}
          method="post"
          action={
            isEditing
              ? path.to.serviceJobEstimateLine(
                  initialValues.serviceJobId,
                  initialValues.id!
                )
              : path.to.newServiceJobEstimateLine(initialValues.serviceJobId)
          }
          className="flex flex-col h-full"
          fetcher={fetcher}
          isDisabled={isDisabled}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Estimate Line` : t`New Estimate Line`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="serviceJobId" />
            <VStack spacing={4}>
              <Item
                name="itemId"
                label={t`Item`}
                type={itemType}
                onTypeChange={(type) => setItemType(type)}
                onChange={async (value) => {
                  const itemId = value?.value as string | undefined;
                  if (!itemId) return;
                  const defaults = await getSalePrice(itemId);
                  setUnitPrice(defaults.unitPrice);
                }}
              />
              <Input name="description" label={t`Description`} />
              <Number
                name="quantity"
                label={t`Quantity`}
                helperText={t`Hours, for a labor item`}
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

export default ServiceJobEstimateLineForm;
