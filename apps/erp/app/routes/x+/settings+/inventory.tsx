// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
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
import { useAction } from "@carbon/query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ChoiceSelect,
  ScrollArea,
  toast
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuLayers,
  LuPackageCheck,
  LuShield,
  LuShieldCheck,
  LuTimerReset,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import SettingsSectionHeader from "~/components/SettingsSectionHeader";
import {
  incompletePickingListPolicyValidator,
  kanbanOutputTypes,
  kanbanOutputValidator,
  returnPickedMaterialTimingValidator,
  shelfLifeSettingsValidator
} from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

type CalculatedInputScope = "AllInputs" | "ManagedInputsOnly";
type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";
type IncompletePickingListPolicy = "warn" | "error";
type ReturnPickedMaterialTiming = "job" | "operation";

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

// One form per card, told apart by its intent: each becomes the fields of
// `settings.inventory.update` it saves (the operation drops `intent`).
const inventorySettingsForm = z.discriminatedUnion("intent", [
  kanbanOutputValidator.extend({ intent: z.literal("kanbanOutput") }),
  shelfLifeSettingsValidator
    .extend({ intent: z.literal("shelfLife") })
    .transform(({ intent: _, ...shelfLife }) => ({
      inventoryShelfLife: {
        ...shelfLife,
        nearExpiryWarningDays: shelfLife.nearExpiryWarningDays ?? null
      }
    })),
  incompletePickingListPolicyValidator.extend({
    intent: z.literal("incompletePickingListPolicy")
  }),
  returnPickedMaterialTimingValidator.extend({
    intent: z.literal("returnPickedMaterialTiming")
  })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(inventorySettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updateInventorySettings(input.data);
}

const outputLabels: Record<(typeof kanbanOutputTypes)[number], string> = {
  label: "Label",
  qrcode: "QR Code",
  url: "URL"
};

export default function InventorySettingsRoute() {
  const { t } = useLingui();
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.kanbanOutput) toast.success(t`Kanban output setting updated`);
      else if (data.inventoryShelfLife)
        toast.success(t`Shelf life & expiry settings updated`);
      else if (data.incompletePickingListPolicy)
        toast.success(t`Picking list completion policy updated`);
      else toast.success(t`Material return timing updated`);
    }
  });

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Inventory</Trans>
        </SettingsPageHeading>

        <SettingsSectionHeader>
          <Trans>Kanban</Trans>
        </SettingsSectionHeader>

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

        <SettingsSectionHeader>
          <Trans>Traceability</Trans>
        </SettingsSectionHeader>

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

        <Card>
          <ValidatedForm
            method="post"
            validator={incompletePickingListPolicyValidator}
            defaultValues={{
              incompletePickingListPolicy:
                (companySettings.incompletePickingListPolicy as
                  | IncompletePickingListPolicy
                  | null
                  | undefined) ?? "warn"
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Finishing an incomplete pick</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Decide what happens when an operator presses Finish on the
                  shop floor with material still unpicked.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="incompletePickingListPolicy" />
              <div className="flex flex-col gap-3 max-w-[640px]">
                <IncompletePickingListPolicyChoice />
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
            validator={returnPickedMaterialTimingValidator}
            defaultValues={{
              returnPickedMaterialTiming:
                (companySettings.returnPickedMaterialTiming as
                  | ReturnPickedMaterialTiming
                  | null
                  | undefined) ?? "job"
            }}
            fetcher={fetcher}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trans>Returning unused picked material</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Decide when material picked to a work center but not consumed
                  flows back to the warehouse.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="intent" value="returnPickedMaterialTiming" />
              <div className="flex flex-col gap-3 max-w-[640px]">
                <ReturnPickedMaterialTimingChoice />
              </div>
            </CardContent>
            <CardFooter>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
            </CardFooter>
          </ValidatedForm>
        </Card>
      </SettingsPage>
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

// ChoiceSelect for the incomplete-picking-list completion policy. Warn lets the
// operator acknowledge & finish (list flagged Partial); Error blocks Finish
// until every line is picked or marked Short.
function IncompletePickingListPolicyChoice() {
  const { t } = useLingui();
  const [value, setValue] = useControlField<IncompletePickingListPolicy>(
    "incompletePickingListPolicy"
  );
  const current: IncompletePickingListPolicy = value ?? "warn";
  return (
    <>
      <ChoiceSelect<IncompletePickingListPolicy>
        value={current}
        onChange={setValue}
        options={[
          {
            value: "warn",
            title: t`Warn but allow`,
            description: t`Operator sees the missing items, can acknowledge & finish. The list is flagged Partial.`,
            icon: <LuTriangleAlert />
          },
          {
            value: "error",
            title: t`Block with an error`,
            description: t`Finishing is refused until every line is picked or marked Short.`,
            icon: <LuShield />
          }
        ]}
      />
      <input type="hidden" name="incompletePickingListPolicy" value={current} />
    </>
  );
}

// ChoiceSelect for when un-consumed picked material returns to the warehouse.
// 'job' flushes the remainder when the whole job completes; 'operation' flushes
// each operation's remainder as soon as that operation is Done (holding back
// what completion-time backflush still needs).
function ReturnPickedMaterialTimingChoice() {
  const { t } = useLingui();
  const [value, setValue] = useControlField<ReturnPickedMaterialTiming>(
    "returnPickedMaterialTiming"
  );
  const current: ReturnPickedMaterialTiming = value ?? "job";
  return (
    <>
      <ChoiceSelect<ReturnPickedMaterialTiming>
        value={current}
        onChange={setValue}
        options={[
          {
            value: "job",
            title: t`At job completion`,
            description: t`Leftover staged material returns when the whole job completes.`,
            icon: <LuPackageCheck />
          },
          {
            value: "operation",
            title: t`At operation completion`,
            description: t`Each operation's unused material returns as soon as the operation is done.`,
            icon: <LuUndo2 />
          }
        ]}
      />
      <input type="hidden" name="returnPickedMaterialTiming" value={current} />
    </>
  );
}
