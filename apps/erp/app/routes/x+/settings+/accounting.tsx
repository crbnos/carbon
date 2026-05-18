import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
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
import { useFlags } from "~/hooks";
import {
  getCompanySettings,
  updateAccountingEnabledSetting
} from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Accounting`,
  to: path.to.accountingSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings();

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return { companySettings: companySettings.data };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const enabled = formData.get("enabled") === "true";

  if (intent === "accountingEnabled") {
    const update = await updateAccountingEnabledSetting(enabled);
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Accounting settings updated" };
  }

  return { success: false, message: "Unknown intent" };
}

export default function AccountingSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { isInternal } = useFlags();

  // const isToggling = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data]);

  const handleAccountingToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "accountingEnabled", enabled: String(checked) },
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
                // disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
}
