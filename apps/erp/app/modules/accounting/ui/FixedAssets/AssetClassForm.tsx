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
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success("Created asset class");
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create asset class: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

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
                {isEditing ? "Edit" : "New"} Asset Class
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Input name="description" label="Description" />
                <Select
                  name="depreciationMethod"
                  label="Depreciation Method"
                  termId="depreciation"
                  options={depreciationMethods.map((m) => ({
                    label: m,
                    value: m
                  }))}
                />
                <Number
                  name="usefulLifeMonths"
                  label="Useful Life (Months)"
                  minValue={1}
                />
                <Number
                  name="residualValuePercent"
                  label="Residual Value %"
                  termId="residual-value"
                  minValue={0}
                  maxValue={100}
                />
                <Account
                  name="assetAccountId"
                  label="Asset Account"
                  classes={["Asset"]}
                />
                <Account
                  name="accumulatedDepreciationAccountId"
                  label="Accumulated Depreciation Account"
                  termId="depreciation"
                  classes={["Asset"]}
                />
                <Account
                  name="depreciationExpenseAccountId"
                  label="Depreciation Expense Account"
                  termId="depreciation"
                  classes={["Expense"]}
                />
                <Account
                  name="writeOffAccountId"
                  label="Write-Off Account"
                  classes={["Expense"]}
                />
                <Account
                  name="writeDownAccountId"
                  label="Write-Down Account"
                  classes={["Expense"]}
                />
                <Account
                  name="disposalAccountId"
                  label="Disposal Account"
                  termId="disposal"
                  classes={["Revenue", "Expense"]}
                />

                {taxDepreciationEnabled && (
                  <>
                    <div className="border-t pt-4 mt-2 w-full">
                      <h4 className="text-sm font-medium mb-4">
                        Tax Depreciation
                      </h4>
                    </div>
                    <Select
                      name="taxDepreciationMethod"
                      label="Tax Method"
                      termId="depreciation"
                      placeholder="Same as Book"
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
                          label="Recovery Period"
                          termId="macrs"
                          options={macrsPropertyClasses.map((c) => ({
                            label: `${c}-Year Property`,
                            value: c
                          }))}
                        />
                        <Select
                          name="macrsConvention"
                          label="Convention"
                          termId="macrs"
                          options={macrsConventions.map((c) => ({
                            label: c,
                            value: c
                          }))}
                        />
                        <Number
                          name="bonusDepreciationPercent"
                          label="Bonus Depreciation %"
                          termId="depreciation"
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
                          label="Tax Useful Life (Months)"
                          minValue={1}
                        />
                        <Number
                          name="taxResidualValuePercent"
                          label="Tax Residual Value %"
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
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
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
