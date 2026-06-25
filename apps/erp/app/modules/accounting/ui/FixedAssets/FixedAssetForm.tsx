import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  AssetClass,
  Hidden,
  Input,
  Location,
  NumberControlled,
  SelectControlled,
  Submit,
  useAssetClasses
} from "~/components/Form";
import { usePermissions, useSettings } from "~/hooks";
import { path } from "~/utils/path";
import {
  depreciationMethods,
  fixedAssetValidator,
  macrsConventions,
  macrsPropertyClasses,
  taxDepreciationMethods
} from "../../accounting.models";

type FixedAssetFormProps = {
  initialValues: z.infer<typeof fixedAssetValidator>;
  onClose: () => void;
};

const FixedAssetForm = ({ initialValues, onClose }: FixedAssetFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const settings = useSettings();
  const taxDepreciationEnabled =
    (settings as any).assetTaxDepreciationEnabled ?? false;
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const { assetClasses } = useAssetClasses();

  const [assetData, setAssetData] = useState<{
    fixedAssetClassId: string;
    depreciationMethod: string;
    usefulLifeMonths: number;
    residualValuePercent: number;
    assetLifetimeUsage: number;
    taxDepreciationMethod: string;
    taxUsefulLifeMonths: number;
    taxResidualValuePercent: number;
    macrsPropertyClass: string;
    macrsConvention: string;
    bonusDepreciationPercent: number;
  }>({
    fixedAssetClassId: initialValues.fixedAssetClassId ?? "",
    depreciationMethod: initialValues.depreciationMethod ?? "",
    usefulLifeMonths: initialValues.usefulLifeMonths ?? 60,
    residualValuePercent: initialValues.residualValuePercent ?? 0,
    assetLifetimeUsage: initialValues.assetLifetimeUsage ?? 0,
    taxDepreciationMethod: initialValues.taxDepreciationMethod ?? "",
    taxUsefulLifeMonths: initialValues.taxUsefulLifeMonths ?? 60,
    taxResidualValuePercent: initialValues.taxResidualValuePercent ?? 0,
    macrsPropertyClass: initialValues.macrsPropertyClass ?? "",
    macrsConvention: initialValues.macrsConvention ?? "Half-Year",
    bonusDepreciationPercent: initialValues.bonusDepreciationPercent ?? 0
  });

  const onAssetClassChange = (
    selected: { value: string; label: string | JSX.Element } | null
  ) => {
    if (!selected) return;
    const assetClass = assetClasses.find((c) => c.id === selected.value);
    if (!assetClass) return;

    setAssetData({
      fixedAssetClassId: assetClass.id,
      depreciationMethod: assetClass.depreciationMethod,
      usefulLifeMonths: assetClass.usefulLifeMonths,
      residualValuePercent: assetClass.residualValuePercent,
      assetLifetimeUsage: 0,
      taxDepreciationMethod: assetClass.taxDepreciationMethod ?? "",
      taxUsefulLifeMonths: assetClass.taxUsefulLifeMonths ?? 60,
      taxResidualValuePercent: assetClass.taxResidualValuePercent ?? 0,
      macrsPropertyClass: assetClass.macrsPropertyClass ?? "",
      macrsConvention: assetClass.macrsConvention ?? "Half-Year",
      bonusDepreciationPercent: assetClass.bonusDepreciationPercent ?? 0
    });
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetValidator}
            method="post"
            action={
              isEditing
                ? path.to.fixedAssetDetails(initialValues.id!)
                : path.to.newFixedAsset
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Fixed Asset</Trans>
                ) : (
                  <Trans>New Fixed Asset</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <AssetClass
                  name="fixedAssetClassId"
                  label={t`Asset Class`}
                  termId="asset-class"
                  value={assetData.fixedAssetClassId}
                  onChange={onAssetClassChange}
                />
                <Input name="description" label={t`Description`} />
                <Input name="serialNumber" label={t`Serial Number`} />
                <SelectControlled
                  name="depreciationMethod"
                  label={t`Depreciation Method`}
                  termId="fixed-asset-depreciation-method"
                  options={depreciationMethods.map((m) => ({
                    label: m,
                    value: m
                  }))}
                  value={assetData.depreciationMethod}
                  onChange={(v) => {
                    if (v)
                      setAssetData((d) => ({
                        ...d,
                        depreciationMethod: v.value
                      }));
                  }}
                />
                <NumberControlled
                  name="usefulLifeMonths"
                  label={t`Useful Life (Months)`}
                  termId="fixed-asset-useful-life"
                  minValue={1}
                  value={assetData.usefulLifeMonths}
                  onChange={(value) =>
                    setAssetData((d) => ({ ...d, usefulLifeMonths: value }))
                  }
                />
                <NumberControlled
                  name="residualValuePercent"
                  label={t`Residual Value %`}
                  termId="residual-value"
                  minValue={0}
                  maxValue={100}
                  value={assetData.residualValuePercent}
                  onChange={(value) =>
                    setAssetData((d) => ({ ...d, residualValuePercent: value }))
                  }
                />
                {assetData.depreciationMethod === "Units of Production" && (
                  <NumberControlled
                    name="assetLifetimeUsage"
                    label={t`Lifetime Usage (Units)`}
                    termId="fixed-asset-lifetime-usage"
                    minValue={0}
                    value={assetData.assetLifetimeUsage}
                    onChange={(value) =>
                      setAssetData((d) => ({ ...d, assetLifetimeUsage: value }))
                    }
                  />
                )}
                <Location name="locationId" label={t`Location`} />
                {taxDepreciationEnabled && (
                  <>
                    <SelectControlled
                      name="taxDepreciationMethod"
                      label={t`Tax Depreciation Method`}
                      termId="fixed-asset-tax-depreciation-method"
                      placeholder={t`None`}
                      options={taxDepreciationMethods.map((m) => ({
                        label: m,
                        value: m
                      }))}
                      value={assetData.taxDepreciationMethod}
                      onChange={(v) => {
                        setAssetData((d) => ({
                          ...d,
                          taxDepreciationMethod: v?.value ?? ""
                        }));
                      }}
                    />
                    <div
                      className={
                        assetData.taxDepreciationMethod === "MACRS"
                          ? "flex flex-col gap-4 w-full"
                          : "hidden"
                      }
                    >
                      <SelectControlled
                        name="macrsPropertyClass"
                        label={t`MACRS Property Class`}
                        termId="macrs-property-class"
                        isOptional={false}
                        options={macrsPropertyClasses.map((c) => ({
                          label: `${c}-Year`,
                          value: c
                        }))}
                        value={assetData.macrsPropertyClass}
                        onChange={(v) => {
                          if (v)
                            setAssetData((d) => ({
                              ...d,
                              macrsPropertyClass: v.value
                            }));
                        }}
                      />
                      <SelectControlled
                        name="macrsConvention"
                        label={t`MACRS Convention`}
                        termId="macrs-convention"
                        isOptional={false}
                        options={macrsConventions.map((c) => ({
                          label: c,
                          value: c
                        }))}
                        value={assetData.macrsConvention}
                        onChange={(v) => {
                          if (v)
                            setAssetData((d) => ({
                              ...d,
                              macrsConvention: v.value
                            }));
                        }}
                      />
                      <NumberControlled
                        name="bonusDepreciationPercent"
                        label={t`Bonus Depreciation %`}
                        termId="bonus-depreciation"
                        minValue={0}
                        maxValue={100}
                        value={assetData.bonusDepreciationPercent}
                        onChange={(value) =>
                          setAssetData((d) => ({
                            ...d,
                            bonusDepreciationPercent: value
                          }))
                        }
                      />
                    </div>
                    <div
                      className={
                        assetData.taxDepreciationMethod === "Straight Line" ||
                        assetData.taxDepreciationMethod === "Declining Balance"
                          ? "flex flex-col gap-4 w-full"
                          : "hidden"
                      }
                    >
                      <NumberControlled
                        name="taxUsefulLifeMonths"
                        label={t`Tax Useful Life (Months)`}
                        termId="fixed-asset-tax-useful-life"
                        minValue={1}
                        value={assetData.taxUsefulLifeMonths}
                        onChange={(value) =>
                          setAssetData((d) => ({
                            ...d,
                            taxUsefulLifeMonths: value
                          }))
                        }
                      />
                      <NumberControlled
                        name="taxResidualValuePercent"
                        label={t`Tax Residual Value %`}
                        termId="residual-value"
                        minValue={0}
                        maxValue={100}
                        value={assetData.taxResidualValuePercent}
                        onChange={(value) =>
                          setAssetData((d) => ({
                            ...d,
                            taxResidualValuePercent: value
                          }))
                        }
                      />
                    </div>
                  </>
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
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

export default FixedAssetForm;
