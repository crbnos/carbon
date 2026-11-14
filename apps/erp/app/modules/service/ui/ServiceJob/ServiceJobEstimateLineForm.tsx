// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Label,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  Hidden,
  InputControlled,
  Item,
  Number,
  NumberControlled,
  Submit
} from "~/components/Form";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { serviceJobEstimateLineValidator } from "../../service.models";
import { useItemSalePrice } from "./useItemSalePrice";

type ServiceJobEstimateLineFormProps = {
  initialValues: z.infer<typeof serviceJobEstimateLineValidator>;
  /** The job's bill rate per hour: a Labor line's price. */
  laborBillRate: number | null;
  isLocked: boolean;
  open?: boolean;
  onClose: () => void;
};

type LineType = "Labor" | "Item";

/**
 * A priced line of a job's estimate. Labor is hours at the job's bill rate;
 * Item is a part or a charge item, and picking it fills in its name and sale
 * price.
 */
const ServiceJobEstimateLineForm = ({
  initialValues,
  laborBillRate,
  isLocked,
  open = true,
  onClose
}: ServiceJobEstimateLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const rateFormatter = useCurrencyFormatter({ rate: true });
  const getSalePrice = useItemSalePrice();

  const isEditing = !!initialValues.id;
  const isDisabled = isLocked || !permissions.can("update", "service");

  const [lineType, setLineType] = useState<LineType>(
    isEditing && initialValues.itemId ? "Item" : "Labor"
  );
  const [unitPrice, setUnitPrice] = useState(initialValues.unitPrice ?? 0);
  const [description, setDescription] = useState(
    initialValues.description ?? ""
  );
  const billRate =
    laborBillRate === null ? null : rateFormatter.format(laborBillRate);
  const [itemType, setItemType] = useState<MethodItemType | "Item">("Item");

  const fetcher = useAction({ onSuccess: onClose });

  return (
    <Drawer
      open={open}
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
              <VStack spacing={2}>
                <Label>
                  <Trans>Line</Trans>
                </Label>
                <ToggleGroup
                  type="single"
                  aria-label={t`Line`}
                  className="gap-0 rounded-full border border-border bg-muted p-0.5 shadow-sm"
                  value={lineType}
                  disabled={isDisabled}
                  onValueChange={(value) => {
                    // Clicking the selected choice again does not clear it.
                    if (value) setLineType(value as LineType);
                  }}
                >
                  {[
                    { value: "Labor", label: t`Labor` },
                    { value: "Item", label: t`Item` }
                  ].map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      className={cn(
                        "rounded-full bg-transparent text-muted-foreground transition-all duration-200 hover:bg-active hover:text-active-foreground data-[state=on]:shadow-sm",
                        "h-7 px-4 text-sm",
                        "data-[state=on]:bg-background data-[state=on]:text-foreground hover:data-[state=on]:bg-background hover:data-[state=on]:text-foreground"
                      )}
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </VStack>
              {lineType === "Item" && (
                <Item
                  name="itemId"
                  label={t`Item`}
                  type={itemType}
                  onTypeChange={(type) => setItemType(type)}
                  onChange={async (value) => {
                    const itemId = value?.value as string | undefined;
                    if (!itemId) return;
                    const defaults = await getSalePrice(itemId);
                    if (defaults.name) setDescription(defaults.name);
                    setUnitPrice(defaults.unitPrice);
                  }}
                />
              )}
              <InputControlled
                name="description"
                label={t`Description`}
                value={description}
                onChange={setDescription}
              />
              <Number
                name="quantity"
                label={lineType === "Labor" ? t`Hours` : t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              {lineType === "Labor" ? (
                <p className="text-sm text-muted-foreground">
                  {billRate === null ? (
                    <Trans>Set the job's bill rate first.</Trans>
                  ) : (
                    <Trans>At {billRate} per hour (the job's bill rate)</Trans>
                  )}
                </p>
              ) : (
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
              )}
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
