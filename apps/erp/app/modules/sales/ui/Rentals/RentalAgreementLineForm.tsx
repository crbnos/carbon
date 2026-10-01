// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast,
  VStack
} from "@carbon/react";
import type { DefaultRentalRates, RateUnit } from "@carbon/utils";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import type { z } from "zod";
import {
  Combobox,
  Hidden,
  NumberControlled,
  // Aliased: the global `Number` is needed for `Number.isNaN` below.
  Number as NumberField,
  Select,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  rentalAgreementLineValidator,
  rentalRateUnits
} from "../../sales.models";
import { getDefaultRentalRates } from "../../sales.service";
import type { LineLeaseClassification } from "./RentalLeaseClassification";
import {
  LeaseClassificationOverrideModal,
  LeaseClassificationPanel
} from "./RentalLeaseClassification";
import type { RentableFleetAsset } from "./types";

type RentalAgreementLineFormProps = {
  initialValues: z.infer<typeof rentalAgreementLineValidator>;
  /** The agreement's customer, currency and start date pick the default
   *  rates when a unit is chosen. */
  customerId: string;
  currencyCode: string;
  startDate: string;
  rentableAssets: RentableFleetAsset[];
  /** The line's own unit when editing — it is Reserved by this line, so the
   *  rentable list (Available units only) does not carry it. */
  currentAsset?: { id: string; itemId: string | null; label: string };
  /** The customer's, customer type's or item's rate for each frequency, for
   *  the line's item — what the rate starts at when the frequency changes. */
  defaultRates?: DefaultRentalRates | null;
  /** The line's lessor classification with its five tests — stored after
   *  activation, previewed before. Absent for a line not yet saved. */
  lease?: LineLeaseClassification | null;
  /** Only a Draft agreement's lines can change. */
  isLocked?: boolean;
  /** A modal to add a unit, or a card on the unit's own page. */
  type?: "card" | "modal";
  /** Close the modal on submit — only when the modal is page state; as its
   *  own route, closing navigates away and would cancel the post. */
  closeOnSubmit?: boolean;
  onClose?: () => void;
};

const RentalAgreementLineForm = ({
  initialValues,
  customerId,
  currencyCode,
  startDate,
  rentableAssets,
  currentAsset,
  defaultRates: initialDefaultRates = null,
  lease,
  isLocked = false,
  type = "modal",
  closeOnSubmit = false,
  onClose
}: RentalAgreementLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const isEditing = initialValues.id !== undefined;
  const [rateUnit, setRateUnit] = useState<RateUnit>(initialValues.rateUnit);
  const [rate, setRate] = useState<number | null>(initialValues.rate ?? null);
  const [defaultRates, setDefaultRates] = useState<DefaultRentalRates | null>(
    initialDefaultRates
  );
  const [rateItemId, setRateItemId] = useState<string | null>(
    currentAsset?.itemId ?? null
  );
  const [showClassification, setShowClassification] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  // A classification is an accounting call, and only a Draft line changes.
  const canOverride =
    isEditing && !isLocked && permissions.can("update", "accounting");

  const assetOptions = useMemo(() => {
    const options = rentableAssets.map((asset) => ({
      value: asset.id!,
      label: [asset.fixedAssetId, asset.name].filter(Boolean).join(" · "),
      helper: [asset.itemReadableId, asset.serialNumber]
        .filter(Boolean)
        .join(" · ")
    }));
    if (
      currentAsset &&
      !options.some((option) => option.value === currentAsset.id)
    ) {
      options.unshift({
        value: currentAsset.id,
        label: currentAsset.label,
        helper: ""
      });
    }
    return options;
  }, [rentableAssets, currentAsset]);

  // A unit of another item starts at that item's rate for the frequency;
  // another unit of the same item keeps whatever was typed.
  const onAssetChange = async (assetId: string | undefined) => {
    if (isLocked) return;
    const itemId =
      rentableAssets.find((asset) => asset.id === assetId)?.itemId ??
      (currentAsset?.id === assetId ? currentAsset?.itemId : null);
    if (!itemId || !carbon || itemId === rateItemId) return;
    setRateItemId(itemId);
    const { data, error } = await getDefaultRentalRates(carbon, {
      companyId: company.id,
      customerId,
      currencyCode,
      asOf: startDate,
      itemIds: [itemId]
    });
    if (error) {
      toast.error(t`Failed to load the rental rates`);
      return;
    }
    const defaults = data[itemId] ?? null;
    setDefaultRates(defaults);
    setRate(defaults?.[rateUnit]?.rate ?? null);
  };

  // A rate belongs to its frequency, so a new frequency starts from its own
  // rate on file rather than keeping a figure meant for another one.
  const onRateUnitChange = (unit: RateUnit) => {
    setRateUnit(unit);
    setRate(defaultRates?.[unit]?.rate ?? null);
  };

  const rateUnitOptions = rentalRateUnits.map((unit) => ({
    value: unit,
    label: unit === "Day" ? t`Daily` : unit === "Week" ? t`Weekly` : t`Monthly`
  }));

  // Where the rate came from, while it is still the value on file.
  const onFile = defaultRates?.[rateUnit] ?? null;
  const rateHint =
    onFile && rate === onFile.rate
      ? onFile.source === "Customer"
        ? t`This customer's rate`
        : onFile.source === "Customer Type"
          ? t`This customer type's rate`
          : t`The item's rental rate`
      : undefined;

  const isDisabled =
    isLocked ||
    (isEditing
      ? !permissions.can("update", "sales")
      : !permissions.can("create", "sales"));

  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
  const moneyStep = INPUT_STEP.money(currencyDecimals);
  const rateFormat = INPUT_FORMAT.rate(currencyCode, currencyDecimals);

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent size="xlarge">
          <ValidatedForm
            defaultValues={initialValues}
            validator={rentalAgreementLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.rentalAgreementLine(
                    initialValues.rentalAgreementId,
                    initialValues.id!
                  )
                : path.to.newRentalAgreementLine(
                    initialValues.rentalAgreementId
                  )
            }
            fetcher={fetcher}
            className="w-full"
            isDisabled={isLocked}
            onSubmit={() => {
              if (type === "modal" && closeOnSubmit) onClose?.();
            }}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? (
                  (currentAsset?.label ?? <Trans>Unit</Trans>)
                ) : (
                  <Trans>Add Unit</Trans>
                )}
              </ModalCardTitle>
              {isLocked && (
                <ModalCardDescription>
                  <Trans>
                    The unit and its rates are fixed once the agreement is
                    activated.
                  </Trans>
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="id" />
              <Hidden name="rentalAgreementId" />
              <VStack spacing={4}>
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                  <Combobox
                    name="fixedAssetId"
                    label={t`Fleet Unit`}
                    termId="fleet-unit"
                    options={assetOptions}
                    isReadOnly={isLocked}
                    onChange={(value) => onAssetChange(value?.value)}
                  />
                  <Select
                    name="rateUnit"
                    label={t`Rate Frequency`}
                    termId="rate-frequency"
                    options={rateUnitOptions}
                    onChange={(value) => {
                      const unit = rentalRateUnits.find(
                        (option) => option === value?.value
                      );
                      if (unit) onRateUnitChange(unit);
                    }}
                  />
                  <NumberControlled
                    name="rate"
                    label={t`Rate`}
                    minValue={0}
                    formatOptions={rateFormat}
                    value={rate ?? Number.NaN}
                    onChange={(value) =>
                      setRate(Number.isNaN(value) ? null : value)
                    }
                    helperText={rateHint}
                  />
                </div>
                {!isLocked && assetOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      No fleet units are available. A unit joins the fleet when
                      a serialized item is capitalized from inventory or built
                      for the fleet, on the{" "}
                      <Link to={path.to.fleet} className="underline">
                        Fleet
                      </Link>{" "}
                      page.
                    </Trans>
                  </p>
                )}

                <div className="w-full">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    leftIcon={
                      showClassification ? (
                        <LuChevronDown />
                      ) : (
                        <LuChevronRight />
                      )
                    }
                    onClick={() => setShowClassification((open) => !open)}
                  >
                    <Trans>Accounting treatment inputs</Trans>
                  </Button>
                  {/* Hidden rather than unmounted: the fields must still post,
                    or saving with the section collapsed would clear them. */}
                  <div
                    className={
                      showClassification
                        ? "mt-4 grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-2"
                        : "hidden"
                    }
                  >
                    <NumberField
                      name="fairValue"
                      label={t`Fair Value`}
                      minValue={0}
                      step={moneyStep}
                      formatOptions={moneyFormat}
                    />
                    <NumberField
                      name="economicLifeMonths"
                      label={t`Economic Life (months)`}
                      minValue={1}
                    />
                    <NumberField
                      name="guaranteedResidualValue"
                      label={t`Guaranteed Residual Value`}
                      minValue={0}
                      step={moneyStep}
                      formatOptions={moneyFormat}
                    />
                    <NumberField
                      name="unguaranteedResidualValue"
                      label={t`Unguaranteed Residual Value`}
                      minValue={0}
                      step={moneyStep}
                      formatOptions={moneyFormat}
                    />
                  </div>
                  {lease && (
                    <div className="mt-4 flex flex-col gap-2">
                      <LeaseClassificationPanel
                        {...lease}
                        currencyCode={currencyCode}
                        onOverride={
                          canOverride ? () => setShowOverride(true) : undefined
                        }
                      />
                      {lease.isPreview && (
                        <p className="text-xs text-muted-foreground">
                          <Trans>
                            Computed from the saved terms and rates. Activation
                            classifies the lease and stores the result.
                          </Trans>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </VStack>
            </ModalCardBody>
            {(type === "modal" || !isLocked) && (
              <ModalCardFooter>
                <HStack>
                  {!isLocked && (
                    <Submit isDisabled={isDisabled}>
                      <Trans>Save</Trans>
                    </Submit>
                  )}
                  {type === "modal" && (
                    <Button size="md" variant="solid" onClick={onClose}>
                      {isLocked ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
                    </Button>
                  )}
                </HStack>
              </ModalCardFooter>
            )}
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
      {/* Outside the line's form: a form inside another form's React tree
          would bubble its submit through the portal to the outer one. */}
      {showOverride && lease && initialValues.id && (
        <LeaseClassificationOverrideModal
          rentalAgreementId={initialValues.rentalAgreementId}
          lineId={initialValues.id}
          classification={lease.classification}
          onClose={() => setShowOverride(false)}
        />
      )}
    </ModalCardProvider>
  );
};

export default RentalAgreementLineForm;
