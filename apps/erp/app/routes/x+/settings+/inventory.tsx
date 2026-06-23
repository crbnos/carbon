import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Hidden,
  Number,
  Select,
  Submit,
  useControlField,
  ValidatedForm,
  validator
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ChoiceSelect,
  Heading,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import {
  LuLayers,
  LuShield,
  LuShieldCheck,
  LuTimerReset,
  LuTriangleAlert
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  kanbanOutputTypes,
  kanbanOutputValidator,
  shelfLifeSettingsValidator,
  updateKanbanOutputSetting,
  updateShelfLifeSettings
} from "~/modules/settings";

import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

type CalculatedInputScope = "AllInputs" | "ManagedInputsOnly";
type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export const handle: Handle = {
  breadcrumb: msg`Inventory`,
  to: path.to.inventorySettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);
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
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "kanbanOutput":
      const kanbanOutputValidation = await validator(
        kanbanOutputValidator
      ).validate(formData);

      if (kanbanOutputValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const kanbanOutputResult = await updateKanbanOutputSetting(
        client,
        companyId,
        kanbanOutputValidation.data.kanbanOutput
      );
      if (kanbanOutputResult.error)
        return {
          success: false,
          message: kanbanOutputResult.error.message
        };

      return { success: true, message: "Kanban output setting updated" };

    case "shelfLife":
      const shelfLifeValidation = await validator(
        shelfLifeSettingsValidator
      ).validate(formData);

      if (shelfLifeValidation.error) {
        return { success: false, message: "Invalid form data" };
      }

      const shelfLifeResult = await updateShelfLifeSettings(client, companyId, {
        nearExpiryWarningDays: shelfLifeValidation.data.nearExpiryWarningDays,
        defaultShelfLifeDays: shelfLifeValidation.data.defaultShelfLifeDays,
        calculatedInputScope: shelfLifeValidation.data.calculatedInputScope,
        expiredEntityPolicy: shelfLifeValidation.data.expiredEntityPolicy
      });
      if (shelfLifeResult.error)
        return {
          success: false,
          message: shelfLifeResult.error.message
        };

      return {
        success: true,
        message: "Shelf life & expiry settings updated"
      };
  }

  return { success: false, message: "Invalid form data" };
}

const outputLabels: Record<(typeof kanbanOutputTypes)[number], string> = {
  label: "Label",
  qrcode: "QR Code",
  url: "URL"
};

export default function InventorySettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher?.data?.message) {
      toast.success(fetcher.data.message);
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Inventory</Trans>
        </Heading>
        <Card>
          <ValidatedForm
            method="post"
            validator={kanbanOutputValidator}
            defaultValues={{
              kanbanOutput: companySettings.kanbanOutput ?? "qrcode"
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Kanban Output</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Style of kanban output to show in the Kanban table
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="kanbanOutput" />
              <div className="flex flex-col gap-8 max-w-[400px]">
                <div className="flex flex-col gap-2">
                  <Select
                    name="kanbanOutput"
                    label={t`Output`}
                    options={kanbanOutputTypes.map((type) => ({
                      value: type,
                      label: outputLabels[type]
                    }))}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>

        <Card>
          <ValidatedForm
            method="post"
            validator={shelfLifeSettingsValidator}
            defaultValues={(() => {
              const blob =
                (companySettings.inventoryShelfLife as {
                  nearExpiryWarningDays?: number | null;
                  defaultShelfLifeDays?: number;
                  calculatedInputScope?: "AllInputs" | "ManagedInputsOnly";
                  expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
                } | null) ?? {};
              return {
                nearExpiryWarningDays: blob.nearExpiryWarningDays ?? undefined,
                defaultShelfLifeDays: blob.defaultShelfLifeDays ?? 7,
                calculatedInputScope: blob.calculatedInputScope ?? "AllInputs",
                expiredEntityPolicy: blob.expiredEntityPolicy ?? "Block"
              };
            })()}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Shelf life</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Manage how shelf life is tracked, computed, and enforced
                  across inventory.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="shelfLife" />
              <div className="flex flex-col gap-8 max-w-[640px]">
                <ShelfLifeNumbers />
                <div className="flex flex-col gap-3">
                  <ShelfLifeSectionLabel
                    title={t`Calculated finished-good expiry`}
                    description={t`When a finished product's shelf life is set to Calculated, pick which consumed inputs feed the calculation.`}
                  />
                  <CalculatedInputScopeChoice />
                </div>
                <div className="flex flex-col gap-3">
                  <ShelfLifeSectionLabel
                    title={t`When expired stock is used`}
                    description={t`Decide what an operator sees if they try to issue a batch or serial that's already expired.`}
                  />
                  <ExpiredEntityPolicyChoice />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </VStack>
    </ScrollArea>
  );
}

// Inline section label used inside a Card. Title + helper copy without a
// border line — keeps the visual hierarchy quiet so the cards underneath
// carry the weight.
function ShelfLifeSectionLabel({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  );
}

// Numeric pair (badge threshold + default shelf life). Pulled out so the
// parent CardContent can compose the form as a sequence of sections.
function ShelfLifeNumbers() {
  const { t } = useLingui();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 w-full max-w-[640px]">
      <Number
        name="nearExpiryWarningDays"
        label={t`Warn this many days before expiry`}
        minValue={0}
        maxValue={365}
        helperText={t`Items inside this window get a yellow badge.`}
        termId="shelf-life"
      />
      <Number
        name="defaultShelfLifeDays"
        label={t`Default shelf-life duration (days)`}
        minValue={1}
        maxValue={365}
        helperText={t`Pre-filled for a new item when expiry is Fixed Duration.`}
        termId="shelf-life"
      />
    </div>
  );
}

// ChoiceSelect for the Calculated-mode input scope. Compact trigger plus
// a rich dropdown — keeps the form scannable while still surfacing the
// trade-off when the user opens the picker.
function CalculatedInputScopeChoice() {
  const { t } = useLingui();
  const [value, setValue] = useControlField<CalculatedInputScope>(
    "calculatedInputScope"
  );
  const current: CalculatedInputScope = value ?? "AllInputs";
  return (
    <>
      <ChoiceSelect<CalculatedInputScope>
        value={current}
        onChange={setValue}
        options={[
          {
            value: "ManagedInputsOnly",
            title: t`Sub-assembly expiries only`,
            description: t`Skip raw-material dates set at receipt. Only inputs with their own shelf-life policy count.`,
            icon: <LuShieldCheck />
          },
          {
            value: "AllInputs",
            title: t`Calculate from BOM`,
            description: t`Soonest expiry across every material sets the finished good.`,
            icon: <LuLayers />
          }
        ]}
      />
      <input type="hidden" name="calculatedInputScope" value={current} />
    </>
  );
}

// ChoiceSelect for the expired-entity enforcement policy. Three options
// without flooding the layout — descriptions only show in the open menu.
function ExpiredEntityPolicyChoice() {
  const { t } = useLingui();
  const [value, setValue] = useControlField<ExpiredEntityPolicy>(
    "expiredEntityPolicy"
  );
  const current: ExpiredEntityPolicy = value ?? "Block";
  return (
    <>
      <ChoiceSelect<ExpiredEntityPolicy>
        value={current}
        onChange={setValue}
        options={[
          {
            value: "Warn",
            title: t`Warn but allow`,
            description: t`Operator gets a warning. Stock still goes through.`,
            icon: <LuTriangleAlert />
          },
          {
            value: "Block",
            title: t`Block with an error`,
            description: t`Operator must pick a different batch/serial.`,
            icon: <LuShield />
          },
          {
            value: "BlockWithOverride",
            title: t`Block, allow override`,
            description: t`Override needs the inventory:update permission and a reason.`,
            icon: <LuTimerReset />
          }
        ]}
      />
      <input type="hidden" name="expiredEntityPolicy" value={current} />
    </>
  );
}
