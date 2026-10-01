// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PostingSourceFamily } from "@carbon/ee/accounting";
import {
  ChoiceCardGroup,
  DatePicker,
  Select,
  Submit,
  useControlField,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Checkbox,
  DrawerBody,
  DrawerFooter,
  HStack,
  Subheading
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { LuLock } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { postingSyncSettingsValidator } from "~/modules/settings/settings.models";

/**
 * Local structural mirrors of @carbon/ee/accounting's PostingSyncSettings /
 * POSTING_POLICY rows (v3). Deliberately NOT imported (even type-only) to
 * keep this component's type graph light: marginal additions around the
 * settings module push unrelated supabase select-string parses over
 * TS2589's instantiation-depth limit (see SyncActivity.tsx and the note in
 * ./index.ts — this component isn't barrel-exported for the same reason).
 * The route passes the resolved settings + policy rows, so drift fails
 * typecheck at that call site.
 */
export type PostingSyncFamilyMode = "documents" | "journals" | "none";

export type PostingSyncSettingsValues = {
  families: {
    ar: PostingSyncFamilyMode;
    ap: PostingSyncFamilyMode;
    creditMemo: PostingSyncFamilyMode;
    supplierCredit: PostingSyncFamilyMode;
  };
  sourceTypes: Record<
    string,
    { enabled: boolean; granularity: "individual" | "daily-summary" }
  >;
  periodLockPolicy: "park" | "redate";
  lockDate?: string;
};

export type PostingSyncPolicyRow = {
  sourceType: string;
  representation: "journal" | "document";
  /** Derived from the engine's union so a new family can never silently drift
   * out of sync with this page (it did: "per-party" was added for memos). */
  family: PostingSourceFamily | null;
};

/** Local mirror of `LedgerFamilyKey` — same reason as the types above. */
type LedgerFamily = keyof PostingSyncSettingsValues["families"];

type PostingSyncSettingsProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  settings: PostingSyncSettingsValues;
  /** POSTING_POLICY rows (every source type), provided by the loader. */
  policy: PostingSyncPolicyRow[];
  /** Posting-account mapping coverage, from the account-mapping tab data. */
  mappingReadiness: { mapped: number; required: number } | null;
  /**
   * Families another installed integration posts, family → that integration's
   * display name. Resolved from the topology by the loader.
   *
   * A delegated family's select is replaced by a read-only notice: the engine
   * already overrides the stored value (`applyLedgerDelegation` forces the family
   * to `"none"`), so leaving the control live offered a setting with no effect.
   */
  delegatedFamilies?: Partial<Record<LedgerFamily, string>>;
};

type SourceTypeRowState = {
  dailySummary: boolean;
};

/**
 * Period-lock policy picker rendered as card-style radios — the same
 * affordance as the Rillet Production/Sandbox environment selector.
 * Bound into the surrounding ValidatedForm via `useControlField` + a hidden
 * input (the controlled `ChoiceCardGroup` doesn't post a value on its own).
 */
function PeriodLockPolicyChoice() {
  const { t } = useLingui();
  const [value, setValue] = useControlField<string>("periodLockPolicy");
  const current = value === "redate" ? "redate" : "park";

  return (
    <div className="w-full">
      <div className="flex flex-col gap-0.5 pb-2">
        <div className="text-sm font-medium text-foreground">
          {t`Period lock policy`}
        </div>
        <p className="text-xs text-muted-foreground">
          {t`What happens when a journal is dated in a locked period.`}
        </p>
      </div>
      <ChoiceCardGroup
        value={current}
        onChange={setValue}
        options={[
          {
            value: "park",
            title: t`Park as error`,
            description: t`Hold the journal as a warning to fix.`
          },
          {
            value: "redate",
            title: t`Re-date to first open day`,
            description: t`Push it re-dated to the first open day, keeping the original date in the narration.`
          }
        ]}
      />
      <input type="hidden" name="periodLockPolicy" value={current} />
    </div>
  );
}

/**
 * One family's representation control.
 *
 * Delegated: renders a read-only notice plus a HIDDEN input carrying the stored
 * value. Both halves matter — the form's validator requires the field, so
 * omitting it would make the whole tab unsaveable, and posting `"none"` instead
 * would quietly destroy the customer's real choice. Uninstalling the integration
 * that holds the family restores exactly what they had.
 */
function FamilyRepresentationField({
  family,
  name,
  label,
  options,
  settings,
  delegatedTo
}: {
  family: LedgerFamily;
  name: string;
  label: string;
  options: { label: string; value: string }[];
  settings: PostingSyncSettingsValues;
  delegatedTo?: string;
}) {
  const { t } = useLingui();

  if (!delegatedTo) {
    return <Select name={name} label={label} options={options} />;
  }

  return (
    <div className="w-full">
      <div className="text-sm font-medium text-foreground">{label}</div>
      {/* Reads as a locked field rather than a status chip: the box occupies the
          same slot the Select would, and the lock says "not yours to set" without
          a badge competing with the live controls beside it. */}
      <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <LuLock className="size-4 shrink-0" />
        <span>{t`Handled by ${delegatedTo}`}</span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t`${delegatedTo} posts this to your ledger, so Carbon doesn't push it. Your saved choice is kept in case that changes.`}
      </p>
      <input type="hidden" name={name} value={settings.families[family]} />
    </div>
  );
}

export function PostingSyncSettings({
  tabs,
  settings,
  policy,
  mappingReadiness,
  delegatedFamilies = {}
}: PostingSyncSettingsProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");

  // Always-on: every automated (non-Manual) journal type syncs; Manual never
  // does and is never rendered. The only per-type control is granularity.
  const journalRows = policy.filter(
    (row) => row.representation === "journal" && row.sourceType !== "Manual"
  );
  // Split by which SECTION's controls govern the row. A "per-party" row (Credit
  // Memo / Debit Memo) is gated by the Credit Memos / Supplier Credits selects, NOT
  // by Receivables/Payables — listing it under AR/AP reads as if those selects
  // controlled it.
  const documentRows = policy.filter(
    (row) => row.representation === "document" && row.family !== "per-party"
  );
  const memoDocumentRows = policy.filter(
    (row) => row.representation === "document" && row.family === "per-party"
  );

  /** The select that actually governs a memo policy row, by its direction. */
  const memoRowGovernedBy = (sourceType: string) =>
    sourceType === "Debit Memo" ? t`Supplier Credits` : t`Credit Memos`;

  const [rowState, setRowState] = useState<Record<string, SourceTypeRowState>>(
    () =>
      Object.fromEntries(
        journalRows.map((row) => {
          const config = settings.sourceTypes[row.sourceType];
          return [
            row.sourceType,
            { dailySummary: config?.granularity === "daily-summary" }
          ];
        })
      )
  );

  const setRow = (
    sourceType: string,
    patch: Partial<SourceTypeRowState>
  ): void => {
    setRowState((current) => ({
      ...current,
      [sourceType]: {
        dailySummary: current[sourceType]?.dailySummary ?? false,
        ...patch
      }
    }));
  };

  // The AR/AP "journals" representation ships with Phase 4 of the v3 spec;
  // until then only documents/none are offered.
  const familyOptions = [
    { label: t`Documents`, value: "documents" },
    { label: t`Off — handled outside the sync`, value: "none" }
  ];

  const familyLabel = (family: PostingSyncPolicyRow["family"]) => {
    if (family === "ar") return t`AR`;
    if (family === "ap") return t`AP`;
    if (family === "per-line") return t`AR/AP`;
    // Resolved per record from the memo's party, so the row can't name one side.
    if (family === "per-party") return t`Credits`;
    return null;
  };

  return (
    <ValidatedForm
      validator={postingSyncSettingsValidator}
      method="post"
      defaultValues={{
        intent: "update-posting-settings",
        familyAr:
          settings.families.ar === "journals"
            ? "documents"
            : settings.families.ar,
        familyAp:
          settings.families.ap === "journals"
            ? "documents"
            : settings.families.ap,
        // Memo families are NOT coerced the way ar/ap are above: their default
        // is "none" (opt-in, go-forward) and that must survive to the form.
        familyCreditMemo: settings.families.creditMemo,
        familySupplierCredit: settings.families.supplierCredit,
        periodLockPolicy: settings.periodLockPolicy,
        lockDate: settings.lockDate
      }}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name="intent" value="update-posting-settings" />
      {journalRows.map((row) => (
        <input
          key={row.sourceType}
          type="hidden"
          name="sourceTypeConfigs"
          value={`${row.sourceType}|${
            rowState[row.sourceType]?.dailySummary
              ? "daily-summary"
              : "individual"
          }`}
        />
      ))}
      <DrawerBody className="gap-6">
        {tabs}
        {mappingReadiness && (
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm">
            <span>
              <Trans>
                {mappingReadiness.mapped} of {mappingReadiness.required} posting
                accounts mapped
              </Trans>
            </span>
            {mappingReadiness.mapped < mappingReadiness.required ? (
              <a
                className="text-primary underline-offset-2 hover:underline"
                href="?tab=account-mapping"
              >
                <Trans>Map accounts</Trans>
              </a>
            ) : (
              <Badge variant="green">
                <Trans>Ready</Trans>
              </Badge>
            )}
          </div>
        )}

        <section className="flex w-full flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <Subheading variant="light">
              <Trans>Source types</Trans>
            </Subheading>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Posted journals with these source types always sync. Daily
                summary groups a day's journals into one provider entry per
                account.
              </Trans>
            </p>
          </div>
          <div className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
            {journalRows.map((row) => {
              const state = rowState[row.sourceType];
              return (
                <div
                  key={row.sourceType}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex-1 text-sm">{row.sourceType}</span>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`postingGranularity:${row.sourceType}`}
                      checked={state?.dailySummary ?? false}
                      disabled={!canUpdate}
                      onCheckedChange={(next) =>
                        setRow(row.sourceType, {
                          dailySummary: next === true
                        })
                      }
                    />
                    <label
                      htmlFor={`postingGranularity:${row.sourceType}`}
                      className="cursor-pointer text-xs text-muted-foreground"
                    >
                      <Trans>Daily summary</Trans>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex w-full flex-col gap-2 border-t border-border pt-4">
          <div className="flex flex-col gap-0.5">
            <Subheading variant="light">
              <Trans>AR / AP representation</Trans>
            </Subheading>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Documents pushes invoices, bills and payments as native provider
                documents; their journals are recorded as covered by the
                document. It also pulls payments recorded in the provider back
                into Carbon, closing the matching invoice or bill and posting a
                Carbon GL journal. Off records them as deliberately excluded.
              </Trans>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FamilyRepresentationField
              family="ar"
              name="familyAr"
              label={t`Receivables (AR)`}
              options={familyOptions}
              settings={settings}
              delegatedTo={delegatedFamilies.ar}
            />
            <FamilyRepresentationField
              family="ap"
              name="familyAp"
              label={t`Payables (AP)`}
              options={familyOptions}
              settings={settings}
              delegatedTo={delegatedFamilies.ap}
            />
          </div>
          <div className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
            {documentRows.map((row) => (
              <div
                key={row.sourceType}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <span className="flex-1 text-sm">{row.sourceType}</span>
                <Badge variant="secondary">{familyLabel(row.family)}</Badge>
                <Badge variant="outline">
                  <Trans>Document</Trans>
                </Badge>
              </div>
            ))}
          </div>
        </section>

        <section className="flex w-full flex-col gap-2 border-t border-border pt-4">
          <div className="flex flex-col gap-0.5">
            <Subheading variant="light">
              <Trans>Credit representation</Trans>
            </Subheading>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Credit memos and supplier credits are gated separately from
                invoices and bills, so payables can be handled outside the sync
                while credits still reach the ledger. Enabling one pushes
                credits from the enable date forward — existing history is left
                alone, and bringing it across needs an explicit backfill.
              </Trans>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <FamilyRepresentationField
              family="creditMemo"
              name="familyCreditMemo"
              label={t`Credit Memos`}
              options={familyOptions}
              settings={settings}
              delegatedTo={delegatedFamilies.creditMemo}
            />
            <FamilyRepresentationField
              family="supplierCredit"
              name="familySupplierCredit"
              label={t`Supplier Credits`}
              options={familyOptions}
              settings={settings}
              delegatedTo={delegatedFamilies.supplierCredit}
            />
          </div>
          <div className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
            {memoDocumentRows.map((row) => (
              <div
                key={row.sourceType}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <span className="flex-1 text-sm">{row.sourceType}</span>
                {/* The source type is named by DIRECTION ("Debit Memo") but the
                    control is named by what it is ("Supplier Credits"); without
                    this nothing on screen connects the two. */}
                <Badge variant="secondary">
                  {memoRowGovernedBy(row.sourceType)}
                </Badge>
                <Badge variant="outline">
                  <Trans>Document</Trans>
                </Badge>
              </div>
            ))}
          </div>
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <PeriodLockPolicyChoice />
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <DatePicker name="lockDate" label={t`Books lock date (manual)`} />
          <p className="text-xs text-muted-foreground">
            <Trans>
              Journals dated on or before this date are treated as locked.
              Merged with the provider-reported lock date when both exist.
            </Trans>
          </p>
        </section>
      </DrawerBody>
      <DrawerFooter>
        <HStack>
          <Submit isDisabled={!canUpdate}>
            <Trans>Save</Trans>
          </Submit>
        </HStack>
      </DrawerFooter>
    </ValidatedForm>
  );
}
