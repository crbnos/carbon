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
  toast
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { z } from "zod";
import { Combobox, Hidden, Number, Select, Submit } from "~/components/Form";
import { useCurrencyDecimals, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  rentalAgreementLineValidator,
  rentalRateModes,
  rentalRateUnits
} from "../../sales.models";
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
  currencyCode: string;
  rentableAssets: RentableFleetAsset[];
  /** The line's own unit when editing — it is Reserved by this line, so the
   *  rentable list (Available units only) does not carry it. */
  currentAsset?: { id: string; itemId: string | null; label: string };
  /** The day / week / month rates to show: the line's snapshot once the
   *  agreement is active, else the item's current ladder. */
  rates?: RentalRateLadder | null;
  /** Rates were snapshotted at activation and no longer follow the item. */
  isSnapshot?: boolean;
  /** The line's lessor classification with its five tests — stored after
   *  activation, previewed before. Absent for a line not yet saved. */
  lease?: LineLeaseClassification | null;
  /** Only a Draft agreement's lines can change. */
  isLocked?: boolean;
  onClose: () => void;
};

const RentalAgreementLineForm = ({
  initialValues,
  currencyCode,
  rentableAssets,
  currentAsset,
  rates: initialRates,
  isSnapshot = false,
  lease,
  isLocked = false,
  onClose
}: RentalAgreementLineFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const currencyDecimals = useCurrencyDecimals(currencyCode);

  const isEditing = initialValues.id !== undefined;
  const [rateMode, setRateMode] = useState(initialValues.rateMode);
  const [rates, setRates] = useState<RentalRateLadder | null>(
    initialRates ?? null
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

  const onAssetChange = async (assetId: string | undefined) => {
    if (isSnapshot) return;
    const itemId =
      rentableAssets.find((asset) => asset.id === assetId)?.itemId ??
      (currentAsset?.id === assetId ? currentAsset?.itemId : null);
    if (!itemId || !carbon) {
      setRates(null);
      return;
    }
    const { data, error } = await carbon
      .from("itemRentalRate")
      .select("dayRate, weekRate, monthRate")
      .eq("itemId", itemId)
      .eq("companyId", company.id)
      .eq("currencyCode", currencyCode)
      .maybeSingle();
    if (error) {
      toast.error(t`Failed to load the item's rental rates`);
      return;
    }
    setRates(data ?? null);
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

  return (
    <ModalCardProvider type="modal">
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
            className="w-full"
            isDisabled={isLocked}
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
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                <Combobox
                  name="fixedAssetId"
                  label={t`Fleet Unit`}
                  options={assetOptions}
                  isReadOnly={isLocked}
                  onChange={(value) => onAssetChange(value?.value)}
                />
                <Select
                  name="rateMode"
                  label={t`Rate Mode`}
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

              <div className="mt-6 grid w-full grid-cols-3 gap-4 rounded-lg border border-border p-4">
                <RateTier
                  label={t`Day Rate`}
                  value={rates?.dayRate}
                  currencyCode={currencyCode}
                />
                <RateTier
                  label={t`Week Rate`}
                  value={rates?.weekRate}
                  currencyCode={currencyCode}
                />
                <RateTier
                  label={t`Month Rate`}
                  value={rates?.monthRate}
                  currencyCode={currencyCode}
                />
                <p className="col-span-3 text-xs text-muted-foreground">
                  {isSnapshot ? (
                    <Trans>Snapshotted from the item when activated.</Trans>
                  ) : (
                    <Trans>
                      From the item's rental rates. They are snapshotted onto
                      the line when the agreement is activated.
                    </Trans>
                  )}
                </p>
              </div>

              <div className="mt-6">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={
                    showClassification ? <LuChevronDown /> : <LuChevronRight />
                  }
                  onClick={() => setShowClassification((open) => !open)}
                >
                  <Trans>Lease classification inputs</Trans>
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
                  <Number
                    name="fairValue"
                    label={t`Fair Value`}
                    minValue={0}
                    step={moneyStep}
                    formatOptions={moneyFormat}
                  />
                  <Number
                    name="economicLifeMonths"
                    label={t`Economic Life (months)`}
                    minValue={1}
                  />
                  <Number
                    name="guaranteedResidualValue"
                    label={t`Guaranteed Residual Value`}
                    minValue={0}
                    step={moneyStep}
                    formatOptions={moneyFormat}
                  />
                  <Number
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
                          Computed from the saved terms and the item's current
                          rates. Activation classifies the lease and stores the
                          result.
                        </Trans>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </ModalCardBody>
            <ModalCardFooter>
              <HStack>
                {!isLocked && (
                  <Submit isDisabled={isDisabled}>
                    <Trans>Save</Trans>
                  </Submit>
                )}
                <Button size="md" variant="solid" onClick={onClose}>
                  {isLocked ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
                </Button>
              </HStack>
            </ModalCardFooter>
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
