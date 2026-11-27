// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox, Submit, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Subheading,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { LuLink, LuTriangleAlert } from "react-icons/lu";
import { usePercentFormatter, usePermissions } from "~/hooks";
import { taxCodeMappingUpsertValidator } from "~/modules/settings/settings.models";

/**
 * Local structural mirrors of @carbon/ee/accounting's TaxRateOption /
 * TaxCodeMapping / TaxCodeMatchProposal and getUnmappedTaxCodes' rows.
 * Deliberately NOT imported (even type-only), for the same TS2589 reason
 * as DimensionMapping.tsx. The route's loader passes real service rows, so
 * any drift fails typecheck there.
 */
type TaxDirection = "sales" | "purchase";

export type CarbonTaxCodeOption = {
  id: string;
  name: string;
  /** The rate the code charges today, 0..1 (0 for Reverse Charge); null
   *  for a retired code. */
  rate: number | null;
  reverseCharge: boolean;
  /** Retired, but documents still use it. */
  retired: boolean;
};

export type ProviderTaxRateOption = {
  id: string;
  name: string;
  /** 0..1 */
  rate: number;
  direction: TaxDirection;
};

export type TaxCodeMappingRow = {
  taxCodeId: string;
  direction: TaxDirection;
  externalId: string;
  externalName: string | null;
  externalRate: number | null;
};

export type UnmappedTaxCodeRow = {
  taxCodeId: string;
  name: string;
  direction: TaxDirection;
};

export type TaxCodeMatchProposalRow = {
  taxCodeId: string;
  direction: TaxDirection;
  externalId: string;
  externalName: string;
  externalRate: number;
};

type TaxRateMappingProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  codes: CarbonTaxCodeOption[];
  /** The fallback row's id (lines with no tax code); null when the provider
   *  sends its own "no tax" rate for them. */
  noTaxCodeId: string | null;
  options: ProviderTaxRateOption[];
  /** True when the provider tax-rate read failed (options renders empty). */
  optionsError: boolean;
  mappings: TaxCodeMappingRow[];
  /** `<taxCodeId>:<direction>` of mappings to a rate the provider no longer
   *  offers. */
  staleMappingKeys: string[];
  unmapped: UnmappedTaxCodeRow[];
  /** Directions that use codes but whose fallback row is unmapped: their
   *  exempt and zero-rated lines go out with no tax. */
  unmappedFallbackDirections: TaxDirection[];
  proposals: TaxCodeMatchProposalRow[];
};

const mappingKey = (taxCodeId: string, direction: TaxDirection) =>
  `${taxCodeId}:${direction}`;

export function TaxRateMapping({
  tabs,
  codes: taxCodes,
  noTaxCodeId,
  options,
  optionsError,
  mappings,
  staleMappingKeys,
  unmapped,
  unmappedFallbackDirections,
  proposals
}: TaxRateMappingProps) {
  const { t } = useLingui();
  const codes = useMemo<CarbonTaxCodeOption[]>(
    () =>
      noTaxCodeId
        ? [
            {
              id: noTaxCodeId,
              name: t`No tax code (exempt or non-taxable)`,
              rate: null,
              reverseCharge: false,
              retired: false
            },
            ...taxCodes
          ]
        : taxCodes,
    [noTaxCodeId, taxCodes, t]
  );
  const stale = useMemo(() => new Set(staleMappingKeys), [staleMappingKeys]);
  const isStale = (taxCodeId: string, direction: TaxDirection) =>
    stale.has(mappingKey(taxCodeId, direction));
  const permissions = usePermissions();
  const canUpdate = permissions.has({ "settings.integrations": "Edit" });
  const percentFormatter = usePercentFormatter();
  const [showMatchDrawer, setShowMatchDrawer] = useState(false);

  const mappingsByKey = useMemo(
    () =>
      new Map(
        mappings.map((mapping) => [
          mappingKey(mapping.taxCodeId, mapping.direction),
          mapping
        ])
      ),
    [mappings]
  );

  // The directions each code is used in with no mapping — what holds the
  // sync switch off.
  const requiredByCode = useMemo(() => {
    const map = new Map<string, Set<TaxDirection>>();
    for (const row of unmapped) {
      const directions = map.get(row.taxCodeId) ?? new Set<TaxDirection>();
      directions.add(row.direction);
      map.set(row.taxCodeId, directions);
    }
    return map;
  }, [unmapped]);

  const salesOptions = useMemo(
    () => options.filter((option) => option.direction === "sales"),
    [options]
  );
  const purchaseOptions = useMemo(
    () => options.filter((option) => option.direction === "purchase"),
    [options]
  );

  const codesById = useMemo(
    () => new Map(codes.map((code) => [code.id, code])),
    [codes]
  );

  const formatRate = useCallback(
    (rate: number) => percentFormatter.format(rate),
    [percentFormatter]
  );

  const unmappedCodes = codes.filter((code) => requiredByCode.has(code.id));
  const otherCodes = codes.filter((code) => !requiredByCode.has(code.id));

  const renderRow = (code: CarbonTaxCodeOption) => (
    <TaxCodeMappingRowForm
      key={code.id}
      code={code}
      isFallback={code.id === noTaxCodeId}
      stale={{
        sales: isStale(code.id, "sales"),
        purchase: isStale(code.id, "purchase")
      }}
      formatRate={formatRate}
      sales={mappingsByKey.get(mappingKey(code.id, "sales")) ?? null}
      purchase={mappingsByKey.get(mappingKey(code.id, "purchase")) ?? null}
      salesOptions={salesOptions}
      purchaseOptions={purchaseOptions}
      required={requiredByCode.get(code.id) ?? null}
      canUpdate={canUpdate}
    />
  );

  return (
    <>
      <DrawerBody className="gap-6">
        {tabs}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            <Trans>
              Map each Carbon tax code to a provider tax rate, once for sales
              and once for purchases. Pushed documents send Carbon's tax amount
              with the mapped rate. A Reverse Charge code charges no tax on
              sales, so map it to a 0% rate such as zero-rated EC sales; its
              purchase documents go out with no tax and need no rate.
            </Trans>
          </p>
          {options.length > 0 && codes.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<LuLink />}
              onClick={() => setShowMatchDrawer(true)}
            >
              <Trans>Match by rate</Trans>
            </Button>
          )}
        </div>

        {noTaxCodeId && unmappedFallbackDirections.length > 0 && (
          <Alert variant="warning">
            <LuTriangleAlert />
            <AlertDescription>
              {unmappedFallbackDirections.length === 2 ? (
                <Trans>
                  Map the "No tax code (exempt or non-taxable)" row for sales
                  and purchases. Until then, exempt and zero-rated lines with no
                  tax code sync with no tax and stay off the VAT return.
                </Trans>
              ) : unmappedFallbackDirections[0] === "sales" ? (
                <Trans>
                  Map the "No tax code (exempt or non-taxable)" row for sales.
                  Until then, exempt and zero-rated sales lines with no tax code
                  sync with no tax and stay off the VAT return.
                </Trans>
              ) : (
                <Trans>
                  Map the "No tax code (exempt or non-taxable)" row for
                  purchases. Until then, exempt and zero-rated purchase lines
                  with no tax code sync with no tax and stay off the VAT return.
                </Trans>
              )}
            </AlertDescription>
          </Alert>
        )}

        {options.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {optionsError ? (
              <Trans>
                Couldn't load the provider's tax rates — check the connection
                and reload.
              </Trans>
            ) : (
              <Trans>
                The provider returned no tax rates — check the connection and
                reload.
              </Trans>
            )}
          </p>
        )}

        <MappingSection
          title={<Trans>Unmapped tax codes</Trans>}
          description={
            <Trans>
              Tax codes used on customers, suppliers or documents with no
              provider rate for that use. Sync stays off until they are mapped.
            </Trans>
          }
          count={unmappedCodes.length}
          emptyMessage={<Trans>Every tax code in use is mapped</Trans>}
        >
          {unmappedCodes.map(renderRow)}
        </MappingSection>

        <MappingSection
          title={<Trans>Tax codes</Trans>}
          description={
            <Trans>
              Every other tax code. Pick a different provider rate to re-map.
            </Trans>
          }
          count={otherCodes.length}
          emptyMessage={<Trans>No other tax codes</Trans>}
        >
          {otherCodes.map(renderRow)}
        </MappingSection>
      </DrawerBody>

      <MatchByRateDrawer
        open={showMatchDrawer}
        proposals={proposals}
        codesById={codesById}
        formatRate={formatRate}
        canUpdate={canUpdate}
        onClose={() => setShowMatchDrawer(false)}
      />
    </>
  );
}

function MappingSection({
  title,
  description,
  count,
  emptyMessage,
  children
}: {
  title: ReactNode;
  description: ReactNode;
  count: number;
  emptyMessage: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Subheading variant="light">{title}</Subheading>
          <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="w-full rounded-lg border border-border max-md:border-0 max-md:p-0 max-md:rounded-none">
        {count === 0 ? (
          <div className="flex w-full items-center justify-center py-8 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex w-full flex-col divide-y divide-border">
            <div className="flex w-full items-center gap-3 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">
                <Trans>Tax code</Trans>
              </span>
              <span className="w-[220px] shrink-0">
                <Trans>Sales</Trans>
              </span>
              <span className="w-[220px] shrink-0">
                <Trans>Purchase</Trans>
              </span>
              <span className="w-[60px] shrink-0" />
            </div>
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One direction's provider-rate options on a row. The stored mapping stays
 * visible when the provider no longer lists it (an archived rate), so the
 * row shows what is mapped until the user re-maps it.
 */
function useDirectionOptions(
  current: TaxCodeMappingRow | null,
  providerOptions: ProviderTaxRateOption[],
  formatRate: (rate: number) => string
) {
  return useMemo(() => {
    const base = providerOptions.map((option) => ({
      value: option.id,
      label: `${option.name} (${formatRate(option.rate)})`
    }));
    if (
      !current ||
      providerOptions.some((option) => option.id === current.externalId)
    ) {
      return base;
    }
    return [
      {
        value: current.externalId,
        label: current.externalName ?? current.externalId
      },
      ...base
    ];
  }, [current, formatRate, providerOptions]);
}

/**
 * One Carbon tax code → a sales rate and a purchase rate. Each row is its
 * own ValidatedForm posting intent=upsert-tax-code-mapping; the server reads
 * the chosen rates' names and percentages from the provider.
 */
function TaxCodeMappingRowForm({
  code,
  isFallback,
  stale,
  formatRate,
  sales,
  purchase,
  salesOptions,
  purchaseOptions,
  required,
  canUpdate
}: {
  code: CarbonTaxCodeOption;
  isFallback: boolean;
  stale: Record<TaxDirection, boolean>;
  formatRate: (rate: number) => string;
  sales: TaxCodeMappingRow | null;
  purchase: TaxCodeMappingRow | null;
  salesOptions: ProviderTaxRateOption[];
  purchaseOptions: ProviderTaxRateOption[];
  required: Set<TaxDirection> | null;
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useAction({
    onSuccess: () => toast.success(t`Saved tax code mapping`)
  });
  const salesChoices = useDirectionOptions(sales, salesOptions, formatRate);
  const purchaseChoices = useDirectionOptions(
    purchase,
    purchaseOptions,
    formatRate
  );

  const placeholder = (direction: TaxDirection) =>
    required?.has(direction)
      ? t`Required`
      : direction === "purchase" && code.reverseCharge
        ? t`Not needed`
        : t`Select provider rate`;

  const detail = isFallback
    ? t`Exempt customers, non-taxable items, untaxed shipping`
    : code.retired
      ? t`Retired, still on documents. Match by rate skips it`
      : code.reverseCharge
        ? t`Reverse Charge, ${formatRate(0)} charged`
        : formatRate(code.rate ?? 0);

  const staleNote = (direction: TaxDirection) =>
    stale[direction] ? (
      <span className="text-xs text-destructive">
        <Trans>Archived in the provider. Re-map it.</Trans>
      </span>
    ) : null;

  return (
    <ValidatedForm
      validator={taxCodeMappingUpsertValidator}
      method="post"
      fetcher={fetcher}
      defaultValues={{
        intent: "upsert-tax-code-mapping",
        taxCodeId: code.id,
        salesExternalId: sales?.externalId ?? undefined,
        purchaseExternalId: purchase?.externalId ?? undefined
      }}
      className="flex w-full items-center gap-3 p-3"
    >
      <input type="hidden" name="intent" value="upsert-tax-code-mapping" />
      <input type="hidden" name="taxCodeId" value={code.id} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{code.name}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="flex w-[220px] shrink-0 flex-col gap-1">
        <Combobox
          name="salesExternalId"
          options={salesChoices}
          placeholder={placeholder("sales")}
        />
        {staleNote("sales")}
      </div>
      <div className="flex w-[220px] shrink-0 flex-col gap-1">
        <Combobox
          name="purchaseExternalId"
          options={purchaseChoices}
          placeholder={placeholder("purchase")}
        />
        {staleNote("purchase")}
      </div>
      <div className="w-[60px] shrink-0">
        <Submit size="sm" variant="secondary" isDisabled={!canUpdate}>
          <Trans>Save</Trans>
        </Submit>
      </div>
    </ValidatedForm>
  );
}

/**
 * Preview of exact-rate matches with confirm-all. Confirm submits one bulk
 * POST with repeated JSON-encoded `mappings` fields (mirroring the
 * dimension MatchByNameDrawer).
 */
function MatchByRateDrawer({
  open,
  proposals,
  codesById,
  formatRate,
  canUpdate,
  onClose
}: {
  open: boolean;
  proposals: TaxCodeMatchProposalRow[];
  codesById: Map<string, CarbonTaxCodeOption>;
  formatRate: (rate: number) => string;
  canUpdate: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(
        data.count === 1
          ? t`Saved tax code mapping`
          : t`Saved ${data.count} tax code mappings`
      );
    },
    onSettled: () => {
      if (submittedRef.current) {
        onClose();
      }
    }
  });
  const isSubmitting = fetcher.state !== "idle";
  const submittedRef = useRef(false);

  const confirmAll = () => {
    if (proposals.length === 0) return;
    const formData = new FormData();
    formData.append("intent", "bulk-upsert-tax-code-mappings");
    for (const proposal of proposals) {
      formData.append(
        "mappings",
        JSON.stringify({
          taxCodeId: proposal.taxCodeId,
          direction: proposal.direction,
          externalId: proposal.externalId
        })
      );
    }
    submittedRef.current = true;
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="sm">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Match by rate</Trans>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>
              Proposed matches where exactly one provider rate has the tax
              code's percentage, for sales and for purchases.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {proposals.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Trans>
                No unmapped tax code matches exactly one provider rate
              </Trans>
            </div>
          ) : (
            <div className="w-full rounded-lg border border-border max-md:border-0 max-md:p-0 max-md:rounded-none">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="px-4">
                      <Trans>Tax code</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Provider rate</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {proposals.map((proposal) => {
                    const code = codesById.get(proposal.taxCodeId);
                    return (
                      <Tr
                        key={mappingKey(proposal.taxCodeId, proposal.direction)}
                      >
                        <Td className="px-4">
                          <div className="flex flex-col py-1">
                            <span className="text-sm font-medium">
                              {code?.name ?? proposal.taxCodeId}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {proposal.direction === "sales" ? (
                                <Trans>Sales</Trans>
                              ) : (
                                <Trans>Purchase</Trans>
                              )}
                            </span>
                          </div>
                        </Td>
                        <Td className="px-4">
                          <span className="text-sm font-medium">
                            {proposal.externalName} (
                            {formatRate(proposal.externalRate)})
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
          )}
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            {proposals.length > 0 && (
              <Button
                leftIcon={<LuLink />}
                isDisabled={!canUpdate || isSubmitting}
                isLoading={isSubmitting}
                onClick={confirmAll}
              >
                <Trans>Confirm all</Trans>
              </Button>
            )}
            <Button variant="solid" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
