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
import type { RentalRateSource } from "@carbon/utils";
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
  rentalRateModes,
  rentalRateUnits
} from "../../sales.models";
import { getDefaultRentalRates } from "../../sales.service";
import type { LineLeaseClassification } from "./RentalLeaseClassification";
import {
  LeaseClassificationOverrideModal,
  LeaseClassificationPanel
} from "./RentalLeaseClassification";
import RentalMoney from "./RentalMoney";
import type { RentableFleetAsset } from "./types";

export type RentalRateLadder = {
  dayRate: number | null;
  weekRate: number | null;
  monthRate: number | null;
};

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
  /** The line's day / week / month rates — its own, or while Draft the
   *  default ladder when it has none yet. */
  rates?: RentalRateLadder | null;
  /** Where `rates` came from when they are the default ladder. */
  rateSource?: RentalRateSource | null;
  /** Rates were fixed at activation. */
  isSnapshot?: boolean;
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
  rates: initialRates,
  rateSource: initialRateSource = null,
  isSnapshot = false,
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
  const [rateMode, setRateMode] = useState(initialValues.rateMode);
  const [rates, setRates] = useState<RentalRateLadder>(
    initialRates ?? { dayRate: null, weekRate: null, monthRate: null }
  );
  const [rateSource, setRateSource] = useState<RentalRateSource | null>(
    initialRateSource
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

  // A unit of another item takes that item's default rates; another unit of
  // the same item keeps whatever was typed.
  const onAssetChange = async (assetId: string | undefined) => {
    if (isSnapshot) return;
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
    const resolved = data[itemId];
    setRates(
      resolved?.rates ?? { dayRate: null, weekRate: null, monthRate: null }
    );
    setRateSource(resolved?.source ?? null);
  };

  const onRateChange = (tier: keyof RentalRateLadder) => (value: number) => {
    setRates((current) => ({
      ...current,
      [tier]: Number.isNaN(value) ? null : value
    }));
    setRateSource(null);
  };

  const rateModeOptions = rentalRateModes.map((mode) => ({
    value: mode,
    label: mode === "Best Rate" ? t`Best Rate` : t`Fixed`
  }));
  const rateUnitOptions = rentalRateUnits.map((unit) => ({
    value: unit,
    label: unit === "Day" ? t`Day` : unit === "Week" ? t`Week` : t`Month`
  }));

  const isDisabled =
    isLocked ||
    (isEditing
      ? !permissions.can("update", "sales")
      : !permissions.can("create", "sales"));

  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
  const moneyStep = INPUT_STEP.money(currencyDecimals);
  const rateFormat = INPUT_FORMAT.rate(currencyCode, currencyDecimals);

  const rateHint = isSnapshot
    ? t`Fixed when the agreement was activated.`
    : rateSource === "Customer"
      ? t`From this customer's rental rates for the item.`
      : rateSource === "Customer Type"
        ? t`From the customer type's rental rates for the item.`
        : rateSource === "Item"
          ? t`From the item's rental rates.`
          : t`Leave all three empty to use the customer's rental rates, else the customer type's, else the item's.`;

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
                    name="rateMode"
                    label={t`Rate Mode`}
                    termId="rate-mode"
                    options={rateModeOptions}
                    onChange={(value) => {
                      if (
                        value?.value === "Fixed" ||
                        value?.value === "Best Rate"
                      )
                        setRateMode(value.value);
                    }}
                  />
                  {rateMode === "Fixed" ? (
                    <Select
                      name="rateUnit"
                      label={t`Billed Tier`}
                      options={rateUnitOptions}
                    />
                  ) : (
                    <div />
                  )}
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

                {isLocked ? (
                  <div className="grid w-full grid-cols-3 gap-4 rounded-lg border border-border p-4">
                    <RateTier
                      label={t`Day Rate`}
                      value={rates.dayRate}
                      currencyCode={currencyCode}
                    />
                    <RateTier
                      label={t`Week Rate`}
                      value={rates.weekRate}
                      currencyCode={currencyCode}
                    />
                    <RateTier
                      label={t`Month Rate`}
                      value={rates.monthRate}
                      currencyCode={currencyCode}
                    />
                    <p className="col-span-3 text-xs text-muted-foreground">
                      {rateHint}
                    </p>
                  </div>
                ) : (
                  <div className="flex w-full flex-col gap-2">
                    <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                      <NumberControlled
                        name="dayRate"
                        label={t`Day Rate`}
                        minValue={0}
                        formatOptions={rateFormat}
                        value={rates.dayRate ?? Number.NaN}
                        onChange={onRateChange("dayRate")}
                      />
                      <NumberControlled
                        name="weekRate"
                        label={t`Week Rate`}
                        minValue={0}
                        formatOptions={rateFormat}
                        value={rates.weekRate ?? Number.NaN}
                        onChange={onRateChange("weekRate")}
                      />
                      <NumberControlled
                        name="monthRate"
                        label={t`Month Rate`}
                        minValue={0}
                        formatOptions={rateFormat}
                        value={rates.monthRate ?? Number.NaN}
                        onChange={onRateChange("monthRate")}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">{rateHint}</p>
                  </div>
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

function RateTier({
  label,
  value,
  currencyCode
}: {
  label: string;
  value: number | null | undefined;
  currencyCode: string;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-medium">
        <RentalMoney value={value} currencyCode={currencyCode} rate />
      </p>
    </div>
  );
}

export default RentalAgreementLineForm;
