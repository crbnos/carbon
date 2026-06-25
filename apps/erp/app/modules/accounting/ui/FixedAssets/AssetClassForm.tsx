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
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  depreciationMethods,
  fixedAssetClassValidator,
  taxDepreciationMethods
} from "../../accounting.models";
import { macrsConventions, macrsPropertyClasses } from "../../accounting.utils";

type AssetClassFormProps = {
  initialValues: z.infer<typeof fixedAssetClassValidator>;
  taxDepreciationEnabled: boolean;
  type?: "modal" | "drawer";
  onClose: () => void;
};

const AssetClassForm = ({
  initialValues,
  taxDepreciationEnabled,
  type = "drawer",
  onClose
}: AssetClassFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created asset class`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create asset class: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const [taxMethod, setTaxMethod] = useState<string>(
    initialValues.taxDepreciationMethod ?? ""
  );

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={fixedAssetClassValidator}
            method="post"
            action={
              isEditing
                ? path.to.assetClass(initialValues.id!)
                : path.to.newAssetClass
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Asset Class</Trans>
                ) : (
                  <Trans>New Asset Class</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Input name="description" label={t`Description`} />
                <Select
                  name="depreciationMethod"
                  label={t`Depreciation Method`}
                  termId="asset-class-default-depreciation-method"
                  options={depreciationMethods.map((m) => ({
                    label: m,
                    value: m
                  }))}
                />
                <Number
                  name="usefulLifeMonths"
                  label={t`Useful Life (Months)`}
                  termId="asset-class-default-useful-life"
                  minValue={1}
                />
                <Number
                  name="residualValuePercent"
                  label={t`Residual Value %`}
                  termId="residual-value"
                  minValue={0}
                  maxValue={100}
                />
                <Account
                  name="assetAccountId"
                  label={t`Asset Account`}
                  termId="asset-class-asset-account"
                  classes={["Asset"]}
                />
                <Account
                  name="accumulatedDepreciationAccountId"
                  label={t`Accumulated Depreciation Account`}
                  termId="asset-class-accumulated-depreciation-account"
                  classes={["Asset"]}
                />
                <Account
                  name="depreciationExpenseAccountId"
                  label={t`Depreciation Expense Account`}
                  termId="asset-class-depreciation-expense-account"
                  classes={["Expense"]}
                />
                <Account
                  name="writeOffAccountId"
                  label={t`Write-Off Account`}
                  termId="asset-class-write-off-account"
                  classes={["Expense"]}
                />
                <Account
                  name="writeDownAccountId"
                  label={t`Write-Down Account`}
                  termId="asset-class-write-down-account"
                  classes={["Expense"]}
                />
                <Account
                  name="disposalAccountId"
                  label={t`Disposal Account`}
                  termId="asset-class-disposal-account"
                  classes={["Revenue", "Expense"]}
                />

                {taxDepreciationEnabled && (
                  <>
                    <div className="border-t pt-4 mt-2 w-full">
                      <h4 className="text-sm font-medium mb-4">
                        <Trans>Tax Depreciation</Trans>
                      </h4>
                    </div>
                    <Select
                      name="taxDepreciationMethod"
                      label={t`Tax Method`}
                      termId="asset-class-default-tax-method"
                      placeholder={t`Same as Book`}
                      isOptional
                      options={taxDepreciationMethods.map((m) => ({
                        label: m,
                        value: m
                      }))}
                      onChange={(value) => setTaxMethod(value?.value ?? "")}
                    />

                    {taxMethod === "MACRS" && (
                      <>
                        <Select
                          name="macrsPropertyClass"
                          label={t`Recovery Period`}
                          termId="macrs-property-class"
                          options={macrsPropertyClasses.map((c) => ({
                            label: `${c}-Year Property`,
                            value: c
                          }))}
                        />
                        <Select
                          name="macrsConvention"
                          label={t`Convention`}
                          termId="macrs-convention"
                          options={macrsConventions.map((c) => ({
                            label: c,
                            value: c
                          }))}
                        />
                        <Number
                          name="bonusDepreciationPercent"
                          label={t`Bonus Depreciation %`}
                          termId="bonus-depreciation"
                          minValue={0}
                          maxValue={100}
                        />
                      </>
                    )}

                    {(taxMethod === "Straight Line" ||
                      taxMethod === "Declining Balance") && (
                      <>
                        <Number
                          name="taxUsefulLifeMonths"
                          label={t`Tax Useful Life (Months)`}
                          termId="asset-class-default-tax-useful-life"
                          minValue={1}
                        />
                        <Number
                          name="taxResidualValuePercent"
                          label={t`Tax Residual Value %`}
                          termId="residual-value"
                          minValue={0}
                          maxValue={100}
                        />
                      </>
                    )}
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

export default AssetClassForm;
