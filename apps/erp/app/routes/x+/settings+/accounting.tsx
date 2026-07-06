import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Account,
  Hidden,
  Number as NumberInput,
  Submit
} from "~/components/Form";
import { useFlags } from "~/hooks";
import { getDefaultAccounts } from "~/modules/accounting";
import {
  getCompanySettings,
  updateAccountingEnabledSetting,
  updateAssetTaxDepreciationSettings
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const taxDepreciationSettingsValidator = z.object({
  intent: z.literal("assetTaxDepreciation"),
  assetTaxRate: zfd.numeric(z.number().min(0).max(100)),
  deferredTaxLiabilityAccountId: z.string().min(1, {
    message: "Deferred tax liability account is required"
  }),
  deferredTaxExpenseAccountId: z.string().min(1, {
    message: "Deferred tax expense account is required"
  })
});

export const handle: Handle = {
  breadcrumb: msg`Accounting`,
  to: path.to.accountingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const [companySettings, accountDefaults] = await Promise.all([
    getCompanySettings(client, companyId),
    getDefaultAccounts(client, companyId)
  ]);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );

  return {
    companySettings: companySettings.data,
    accountDefaults: accountDefaults.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "accountingEnabled") {
    const enabled = formData.get("enabled") === "true";
    const update = await updateAccountingEnabledSetting(
      client,
      companyId,
      enabled
    );
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Accounting settings updated" };
  }

  if (intent === "assetTaxDepreciationEnabled") {
    const enabled = formData.get("enabled") === "true";
    const update = await updateAssetTaxDepreciationSettings(client, companyId, {
      assetTaxDepreciationEnabled: enabled,
      assetTaxRate: null
    });
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Fixed asset settings updated" };
  }

  if (intent === "assetTaxDepreciation") {
    const validation = await validator(
      taxDepreciationSettingsValidator
    ).validate(formData);

    if (validation.error) {
      return validationError(validation.error);
    }

    const {
      assetTaxRate,
      deferredTaxLiabilityAccountId,
      deferredTaxExpenseAccountId
    } = validation.data;

    const settingsUpdate = await updateAssetTaxDepreciationSettings(
      client,
      companyId,
      { assetTaxDepreciationEnabled: true, assetTaxRate }
    );

    if (settingsUpdate.error)
      return { success: false, message: settingsUpdate.error.message };

    const accountUpdate = await client
      .from("accountDefault")
      .update({
        deferredTaxLiabilityAccountId,
        deferredTaxExpenseAccountId,
        updatedBy: userId
      } as any)
      .eq("companyId", companyId);

    if (accountUpdate.error)
      return { success: false, message: accountUpdate.error.message };

    return { success: true, message: "Fixed asset settings updated" };
  }

  return { success: false, message: "Unknown intent" };
}

export default function AccountingSettingsRoute() {
  const { companySettings, accountDefaults } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const taxFetcher = useFetcher<typeof action>();
  const { isInternal } = useFlags();

  const taxEnabled =
    (companySettings as any).assetTaxDepreciationEnabled ?? false;

  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data) {
      if (fetcher.data.success === true && fetcher.data.message) {
        toast.success(fetcher.data.message);
      }
      if (fetcher.data.success === false && fetcher.data.message) {
        toast.error(fetcher.data.message);
      }
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (taxFetcher.data && "success" in taxFetcher.data) {
      if (taxFetcher.data.success === true && taxFetcher.data.message) {
        toast.success(taxFetcher.data.message);
      }
      if (taxFetcher.data.success === false && taxFetcher.data.message) {
        toast.error(taxFetcher.data.message);
      }
    }
  }, [taxFetcher.data]);

  const handleAccountingToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "accountingEnabled", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleTaxDepreciationToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "assetTaxDepreciationEnabled", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Accounting</Trans>
        </Heading>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>General Ledger</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Enable full accrual accounting with journal entries, financial
                reports, and general ledger posting.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <HStack className="items-center gap-2">
                  <span className="font-medium">
                    {(companySettings as any).accountingEnabled ? (
                      <Trans>Accounting is enabled</Trans>
                    ) : (
                      <Trans>Accounting is disabled</Trans>
                    )}
                  </span>
                  <Badge variant="red">
                    <Trans>Alpha</Trans>
                  </Badge>
                </HStack>
                <span className="text-sm text-muted-foreground">
                  {(companySettings as any).accountingEnabled ? (
                    <Trans>
                      Transactions will create journal entries and update the
                      general ledger.
                    </Trans>
                  ) : (
                    <Trans>
                      Enable to automatically post transactions to the general
                      ledger.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={(companySettings as any).accountingEnabled ?? false}
                onCheckedChange={handleAccountingToggle}
                disabled={!isInternal}
              />
            </HStack>
          </CardContent>
        </Card>

        <ValidatedForm
          className="w-full"
          validator={taxDepreciationSettingsValidator}
          method="post"
          fetcher={taxFetcher}
          defaultValues={{
            intent: "assetTaxDepreciation",
            assetTaxRate: parseFloat(
              (companySettings as any).assetTaxRate ?? "0"
            ),
            deferredTaxLiabilityAccountId:
              (accountDefaults as any)?.deferredTaxLiabilityAccountId ?? "",
            deferredTaxExpenseAccountId:
              (accountDefaults as any)?.deferredTaxExpenseAccountId ?? ""
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Fixed Assets</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Track tax depreciation separately from book depreciation and
                  automatically post deferred tax liability entries.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack spacing={4}>
                <HStack className="w-full justify-between items-center">
                  <VStack className="items-start" spacing={1}>
                    <span className="font-medium">
                      <Trans>Track tax depreciation separately</Trans>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      <Trans>
                        Enable to configure tax-specific depreciation methods on
                        asset classes (e.g., MACRS, accelerated).
                      </Trans>
                    </span>
                  </VStack>
                  <Switch
                    checked={taxEnabled}
                    onCheckedChange={handleTaxDepreciationToggle}
                  />
                </HStack>
                {taxEnabled && (
                  <VStack spacing={4} className="pt-4 border-t">
                    <Hidden name="intent" value="assetTaxDepreciation" />
                    <NumberInput
                      name="assetTaxRate"
                      label="Tax Rate (%)"
                      minValue={0}
                      maxValue={100}
                    />
                    <Account
                      name="deferredTaxLiabilityAccountId"
                      label="Deferred Tax Liability Account"
                      classes={["Liability"]}
                    />
                    <Account
                      name="deferredTaxExpenseAccountId"
                      label="Deferred Tax Expense Account"
                      classes={["Expense"]}
                    />
                  </VStack>
                )}
              </VStack>
            </CardContent>
            {taxEnabled && (
              <CardFooter>
                <Submit isDisabled={taxFetcher.state !== "idle"}>
                  <Trans>Save</Trans>
                </Submit>
              </CardFooter>
            )}
          </Card>
        </ValidatedForm>
      </VStack>
    </ScrollArea>
  );
}
