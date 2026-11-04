// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useControlField, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Account,
  Combobox,
  CostCenter,
  DatePicker,
  Hidden,
  Input,
  Item,
  NumberControlled,
  Select,
  Submit,
  Supplier
} from "~/components/Form";
import { useCurrencies } from "~/hooks/useCurrencies";
import type { loader as createPurchaseOrderLineLoader } from "~/routes/x+/project+/$projectId.elements.$elementId.create-po-line";
import { path } from "~/utils/path";
import {
  createProjectPurchaseOrderLineValidator,
  NEW_PURCHASE_ORDER,
  type projectPurchaseLineTypes
} from "../../projects.models";
import { purchaseQuantityOfItem, suggestedUnitPrice } from "./purchase-line";

type LineType = (typeof projectPurchaseLineTypes)[number];

/**
 * The Draft order to add to. A newly picked supplier has other orders, so it
 * starts on that supplier's newest Draft, else a new order.
 */
function AddToField({
  firstDraftId,
  options
}: {
  firstDraftId?: string;
  options: { value: string; label: string }[];
}) {
  const { t } = useLingui();
  const [, setValue] = useControlField<string | undefined>("purchaseOrderId");
  useEffect(() => {
    setValue(firstDraftId ?? NEW_PURCHASE_ORDER);
  }, [firstDraftId, setValue]);
  return <Select name="purchaseOrderId" label={t`Add to`} options={options} />;
}

/**
 * A task's Add Purchase Order: a purchase order line charged to the task, with
 * no plan line. It buys an item, a G/L account or a fixed asset, on the
 * supplier's Draft purchase order at the project's location or a new one. The
 * action redirects to the purchase order; a refusal shows in the modal.
 */
export function AddPurchaseOrderModal({
  projectId,
  elementId,
  defaultRequiredDate,
  onClose
}: {
  projectId: string;
  elementId: string;
  defaultRequiredDate?: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const resource = path.to.projectElementCreatePurchaseOrderLine(
    projectId,
    elementId
  );
  const optionsFetcher = useFetcher<typeof createPurchaseOrderLineLoader>();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;
  const [lineType, setLineType] = useState<LineType>("Item");
  const [supplierId, setSupplierId] = useState<string>();
  const [itemId, setItemId] = useState<string>();
  const [quantity, setQuantity] = useState(1);
  // What the user typed. A new supplier, item, quantity or tab clears it, as
  // on the purchase order's own line form, and the price is suggested again.
  const [typedPrice, setTypedPrice] = useState<number>();

  const load = optionsFetcher.load;
  useEffect(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set("supplierId", supplierId);
    if (itemId) params.set("itemId", itemId);
    load(`${resource}?${params}`);
  }, [load, resource, supplierId, itemId]);

  const options = optionsFetcher.data;
  const currencyCode = options?.currencyCode;
  const assets = options?.assets ?? [];
  const decimals = useCurrencies().find(
    (currency) => currency.code === currencyCode
  )?.decimalPlaces;
  const terms = lineType === "Item" ? options?.itemTerms : null;
  const purchaseQuantity = terms
    ? purchaseQuantityOfItem(terms, quantity)
    : quantity;
  const suggestedPrice =
    terms && currencyCode && options?.exchangeRate
      ? suggestedUnitPrice(
          terms,
          quantity,
          { currencyCode, exchangeRate: options.exchangeRate },
          options.baseCurrencyCode ?? currencyCode
        )
      : undefined;
  const unitPrice = typedPrice ?? suggestedPrice ?? Number.NaN;
  const purchaseOrderOptions = [
    { value: NEW_PURCHASE_ORDER, label: t`New purchase order` },
    ...(options?.purchaseOrders ?? []).map((po) => ({
      value: po.id,
      label: po.purchaseOrderId
    }))
  ];

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        {options === undefined ? (
          <ModalBody>
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          </ModalBody>
        ) : (
          <ValidatedForm
            validator={createProjectPurchaseOrderLineValidator}
            method="post"
            action={resource}
            fetcher={fetcher}
            defaultValues={{
              lineType: "Item",
              supplierId: "",
              quantity: 1,
              requiredDate: defaultRequiredDate,
              purchaseOrderId: NEW_PURCHASE_ORDER
            }}
          >
            <ModalHeader>
              <ModalTitle>
                <Trans>Add Purchase Order</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>A purchase order line charged to this task.</Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              <Hidden name="lineType" value={lineType} />
              <VStack spacing={4}>
                {errorMessage && (
                  <Alert variant="destructive">
                    <LuTriangleAlert />
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                )}
                <Tabs
                  value={lineType}
                  onValueChange={(value) => {
                    setLineType(value as LineType);
                    setTypedPrice(undefined);
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="Item">
                      <Trans>Item</Trans>
                    </TabsTrigger>
                    <TabsTrigger value="G/L Account">
                      <Trans>GL Account</Trans>
                    </TabsTrigger>
                    <TabsTrigger value="Fixed Asset">
                      <Trans>Fixed Asset</Trans>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Supplier
                  name="supplierId"
                  label={t`Supplier`}
                  onChange={(option) => {
                    if (option?.value) {
                      setSupplierId(option.value);
                      setTypedPrice(undefined);
                    }
                  }}
                />
                {lineType === "Item" && (
                  <Item
                    name="itemId"
                    label={t`Item`}
                    type="Item"
                    validItemTypes={[
                      "Part",
                      "Material",
                      "Tool",
                      "Consumable",
                      "Service"
                    ]}
                    replenishmentSystem="Buy"
                    isOptional={false}
                    onChange={(option) => {
                      setItemId(option?.value as string | undefined);
                      setTypedPrice(undefined);
                    }}
                  />
                )}
                {lineType === "G/L Account" && (
                  <>
                    <Account
                      name="accountId"
                      label={t`GL Account`}
                      classes={["Expense"]}
                      isOptional={false}
                    />
                    <CostCenter
                      name="costCenterId"
                      label={t`Cost Center`}
                      isOptional
                    />
                    <Input
                      name="description"
                      label={t`Description`}
                      isOptional={false}
                    />
                  </>
                )}
                {lineType === "Fixed Asset" && (
                  <Combobox
                    name="assetId"
                    label={t`Fixed Asset`}
                    isOptional={false}
                    options={assets.map((asset) => ({
                      value: asset.id,
                      label: `${asset.fixedAssetId} — ${asset.name}`
                    }))}
                  />
                )}
                {lineType !== "Fixed Asset" && (
                  <NumberControlled
                    name="quantity"
                    label={
                      terms ? t`Quantity (${terms.inventoryUnit})` : t`Quantity`
                    }
                    isOptional={false}
                    value={quantity}
                    onChange={(value) => {
                      setQuantity(value);
                      setTypedPrice(undefined);
                    }}
                    helperText={
                      terms &&
                      (terms.purchaseUnit !== terms.inventoryUnit ||
                        purchaseQuantity !== quantity)
                        ? t`Buys ${purchaseQuantity} ${terms.purchaseUnit}`
                        : undefined
                    }
                    minValue={0}
                    formatOptions={INPUT_FORMAT.quantity}
                    step={INPUT_STEP.quantity}
                  />
                )}
                {currencyCode && (
                  <NumberControlled
                    name="unitPrice"
                    label={
                      terms
                        ? t`Unit Price (per ${terms.purchaseUnit})`
                        : t`Unit Price`
                    }
                    isOptional={false}
                    value={unitPrice}
                    onChange={setTypedPrice}
                    minValue={0}
                    formatOptions={INPUT_FORMAT.rate(
                      currencyCode,
                      decimals ?? 2
                    )}
                    step={INPUT_STEP.rate}
                  />
                )}
                <DatePicker name="requiredDate" label={t`Required Date`} />
                <AddToField
                  firstDraftId={options.purchaseOrders[0]?.id}
                  options={purchaseOrderOptions}
                />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              {/* A price still loading must not go out as the old item's. */}
              <Submit
                withBlocker={false}
                isDisabled={optionsFetcher.state !== "idle"}
              >
                <Trans>Add Purchase Order</Trans>
              </Submit>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}
