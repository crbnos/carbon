// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
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
import { serverFns } from "@carbon/server-functions";
import {
  getErrorMessage,
  INPUT_FORMAT,
  INPUT_STEP,
  redirect
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  Account,
  Hidden,
  Number as NumberInput,
  Submit
} from "~/components/Form";
import { useDateFormatter, usePermissions } from "~/hooks";
import { getDefaultAccounts, hasAccountingCutover } from "~/modules/accounting";
import { getLegacyDocumentCounts } from "~/modules/accounting/accounting.server";
import {
  getCompanySettings,
  updateAssetTaxDepreciationSettings,
  updateLeasePolicySettings,
  updateShowCurrencyTrailingZerosSetting
} from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings/accounting");

const JOURNAL_LEGACY_INTENT = "journal-legacy";

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

const leasePolicySettingsValidator = z.object({
  intent: z.literal("leasePolicy"),
  leaseMajorPartThresholdPercent: zfd.numeric(
    z
      .number()
      .gt(0, { message: "Threshold must be above 0" })
      .max(100, { message: "Threshold cannot exceed 100" })
  ),
  leaseSubstantiallyAllThresholdPercent: zfd.numeric(
    z
      .number()
      .gt(0, { message: "Threshold must be above 0" })
      .max(100, { message: "Threshold cannot exceed 100" })
  ),
  leaseDefaultDiscountRate: zfd.numeric(
    z.number().min(0, { message: "Discount rate cannot be negative" })
  )
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

  // Documents posted on or after the cutover with no journal: a company
  // enabled before the enable wrote them.
  const cutoverDate = companySettings.data.accountingCutoverDate;
  const legacyCounts = cutoverDate
    ? await getLegacyDocumentCounts(getDatabaseClient(), {
        companyId,
        cutoverDate
      })
    : null;

  return {
    companySettings: companySettings.data,
    accountDefaults: accountDefaults.data,
    legacyDocumentCount: legacyCounts
      ? Object.values(legacyCounts).reduce((sum, count) => sum + count, 0)
      : 0
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === JOURNAL_LEGACY_INTENT) {
    return journalLegacyDocuments(request);
  }

  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  if (intent === "showCurrencyTrailingZeros") {
    const enabled = formData.get("enabled") === "true";
    const update = await updateShowCurrencyTrailingZerosSetting(
      client,
      companyId,
      enabled
    );
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Currency display updated" };
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

  if (intent === "leasePolicy") {
    const validation = await validator(leasePolicySettingsValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { intent: _intent, ...settings } = validation.data;
    const update = await updateLeasePolicySettings(client, companyId, settings);
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Lease policy updated" };
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

/** Writes the journals the enable would have written for legacy documents. */
async function journalLegacyDocuments(request: Request) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });
  const result = await serverFns
    .as({ client, db: getDatabaseClient(), companyId, userId })
    .invoke("journal-legacy-documents", {});
  if (result.error) {
    logger.error("Failed to write the missing journals", {
      companyId,
      error: result.error
    });
    // The flash carries the message; the other intents' toast stays quiet.
    return data(
      { success: false, message: null },
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to write the missing journals")
        )
      )
    );
  }
  const { movementCostRows: _, ...families } = result.data.legacyJournals;
  const documents = Object.values(families).reduce(
    (sum, count) => sum + count,
    0
  );
  return data(
    { success: true, message: null },
    await flash(
      request,
      success(
        documents === 1
          ? "Wrote the missing journal of 1 document"
          : `Wrote the missing journals of ${documents} documents`
      )
    )
  );
}

export default function AccountingSettingsRoute() {
  const { companySettings, accountDefaults, legacyDocumentCount } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const legacyFetcher = useFetcher<typeof action>();
  const fetcher = useAction<typeof action>({
    onSettled: (data) => {
      if (data && "success" in data) {
        if (data.success === true && data.message) {
          toast.success(data.message);
        }
        if (data.success === false && data.message) {
          toast.error(data.message);
        }
      }
    }
  });
  const taxFetcher = useAction<typeof action>({
    onSettled: (data) => {
      if (data && "success" in data) {
        if (data.success === true && data.message) {
          toast.success(data.message);
        }
        if (data.success === false && data.message) {
          toast.error(data.message);
        }
      }
    }
  });
  const leaseFetcher = useAction<typeof action>({
    onSettled: (data) => {
      if (data && "success" in data) {
        if (data.success === true && data.message) {
          toast.success(data.message);
        }
        if (data.success === false && data.message) {
          toast.error(data.message);
        }
      }
    }
  });
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  const taxEnabled = companySettings.assetTaxDepreciationEnabled ?? false;

  const accountingSetUp = hasAccountingCutover(companySettings);
  const cutoverDate = formatDate(companySettings.accountingCutoverDate);

  const handleTrailingZerosToggle = useCallback(
    (showTrailingZeros: boolean) => {
      fetcher.submit(
        {
          intent: "showCurrencyTrailingZeros",
          enabled: String(showTrailingZeros)
        },
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
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
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
                Accrual accounting with journal entries, financial reports, and
                general ledger posting.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {accountingSetUp ? (
                    <Trans>Accounting since {cutoverDate}</Trans>
                  ) : (
                    <Trans>Accounting is not set up</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {accountingSetUp ? (
                    <Trans>
                      Transactions will create journal entries and update the
                      general ledger.
                    </Trans>
                  ) : (
                    <Trans>
                      Transactions post provisional journal entries until you
                      set up accounting.
                    </Trans>
                  )}
                </span>
              </VStack>
              {!accountingSetUp && (
                <Button asChild>
                  <Link to={path.to.accountingActivation}>
                    <Trans>Set up accounting</Trans>
                  </Link>
                </Button>
              )}
            </HStack>
            {accountingSetUp && legacyDocumentCount > 0 && (
              // One centred row: the Alert's grid (icon column, text column)
              // would put the icon on the first line and the button under
              // the text.
              <Alert variant="warning" className="mt-4 flex items-center gap-3">
                <LuTriangleAlert className="shrink-0" />
                <AlertDescription className="flex-1 text-sm">
                  <Plural
                    value={legacyDocumentCount}
                    one="# document posted before Carbon kept journals has no journal."
                    other="# documents posted before Carbon kept journals have no journal."
                  />
                </AlertDescription>
                <legacyFetcher.Form method="post" className="shrink-0">
                  <input
                    type="hidden"
                    name="intent"
                    value={JOURNAL_LEGACY_INTENT}
                  />
                  {/* The alert's amber text would cascade into the button. */}
                  <Button
                    type="submit"
                    variant="secondary"
                    className="text-foreground"
                    isLoading={legacyFetcher.state !== "idle"}
                    isDisabled={
                      legacyFetcher.state !== "idle" ||
                      !permissions.can("update", "accounting")
                    }
                  >
                    <Trans>Write missing journals</Trans>
                  </Button>
                </legacyFetcher.Form>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Show Trailing Zeros</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Pad amounts to their currency's decimal places, so 300 appears
                as 300.00 and columns of figures stay aligned. Turn this off to
                show only the digits that carry value. Printed documents and
                stored amounts are unaffected either way.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <span className="font-medium">
                  {companySettings.showCurrencyTrailingZeros ? (
                    <Trans>Trailing zeros are shown</Trans>
                  ) : (
                    <Trans>Trailing zeros are hidden</Trans>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {companySettings.showCurrencyTrailingZeros ? (
                    <Trans>
                      Amounts are padded to their currency's decimal places.
                    </Trans>
                  ) : (
                    <Trans>
                      Amounts show only the digits that carry value.
                    </Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={companySettings.showCurrencyTrailingZeros}
                onCheckedChange={handleTrailingZerosToggle}
                disabled={fetcher.state !== "idle"}
              />
            </HStack>
          </CardContent>
        </Card>

        <ValidatedForm
          className="w-full"
          validator={leasePolicySettingsValidator}
          method="post"
          fetcher={leaseFetcher}
          defaultValues={{
            intent: "leasePolicy",
            leaseMajorPartThresholdPercent:
              companySettings.leaseMajorPartThresholdPercent,
            leaseSubstantiallyAllThresholdPercent:
              companySettings.leaseSubstantiallyAllThresholdPercent,
            leaseDefaultDiscountRate: companySettings.leaseDefaultDiscountRate
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Lease Classification</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  A rental line is a sales-type lease when any ASC 842 test is
                  met. These thresholds set tests (c) and (d); the discount rate
                  is the default for new rental agreements.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="leasePolicy" />
              <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-3">
                <NumberInput
                  name="leaseMajorPartThresholdPercent"
                  label={t`Major Part of Economic Life (%)`}
                  minValue={0}
                  maxValue={100}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percentPoints}
                />
                <NumberInput
                  name="leaseSubstantiallyAllThresholdPercent"
                  label={t`Substantially All of Fair Value (%)`}
                  minValue={0}
                  maxValue={100}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percentPoints}
                />
                <NumberInput
                  name="leaseDefaultDiscountRate"
                  label={t`Default Discount Rate (%)`}
                  minValue={0}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percentPoints}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Submit isDisabled={leaseFetcher.state !== "idle"}>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </Card>
        </ValidatedForm>

        <ValidatedForm
          className="w-full"
          validator={taxDepreciationSettingsValidator}
          method="post"
          fetcher={taxFetcher}
          defaultValues={{
            intent: "assetTaxDepreciation",
            // Already a NUMERIC column; the parseFloat this replaced only
            // worked because JS coerced the number back to a string first.
            assetTaxRate: companySettings.assetTaxRate ?? 0,
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
