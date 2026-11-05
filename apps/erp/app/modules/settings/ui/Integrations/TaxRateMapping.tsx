// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox, Submit, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
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
import { LuLink } from "react-icons/lu";
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
  /** The code's combined rate today, 0..1. */
  rate: number;
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
  options: ProviderTaxRateOption[];
  /** True when the provider tax-rate read failed (options renders empty). */
  optionsError: boolean;
  mappings: TaxCodeMappingRow[];
  unmapped: UnmappedTaxCodeRow[];
  proposals: TaxCodeMatchProposalRow[];
};

const mappingKey = (taxCodeId: string, direction: TaxDirection) =>
  `${taxCodeId}:${direction}`;

export function TaxRateMapping({
  tabs,
  codes,
  options,
  optionsError,
  mappings,
  unmapped,
  proposals
}: TaxRateMappingProps) {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");
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
              with the mapped rate.
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
              Every other active tax code. Pick a different provider rate to
              re-map.
            </Trans>
          }
          count={otherCodes.length}
          emptyMessage={<Trans>No other active tax codes</Trans>}
        >
          {otherCodes.map(renderRow)}
        </MappingSection>
      </DrawerBody>

      {showMatchDrawer && (
        <MatchByRateDrawer
          proposals={proposals}
          codesById={codesById}
          formatRate={formatRate}
          canUpdate={canUpdate}
          onClose={() => setShowMatchDrawer(false)}
        />
      )}
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
 * One direction's provider-rate choice on a row: the options (with the
 * stored mapping kept visible when the provider no longer lists it) and the
 * selected rate's name and percentage for the hidden metadata fields.
 * `picked` is the user's own choice; until they pick, the stored mapping
 * is the selection.
 */
function useDirectionChoice(
  current: TaxCodeMappingRow | null,
  providerOptions: ProviderTaxRateOption[],
  formatRate: (rate: number) => string
) {
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  const optionsById = useMemo(
    () => new Map(providerOptions.map((option) => [option.id, option])),
    [providerOptions]
  );

  const options = useMemo(() => {
    const base = providerOptions.map((option) => ({
      value: option.id,
      label: `${option.name} (${formatRate(option.rate)})`
    }));
    if (!current || optionsById.has(current.externalId)) return base;
    return [
      {
        value: current.externalId,
        label: current.externalName ?? current.externalId
      },
      ...base
    ];
  }, [current, formatRate, optionsById, providerOptions]);

  const selectedId =
    picked === undefined ? (current?.externalId ?? null) : picked;
  const selectedOption = selectedId ? optionsById.get(selectedId) : undefined;
  const fromMapping =
    selectedId && current?.externalId === selectedId ? current : null;

  return {
    options,
    setPicked,
    selectedName: selectedOption?.name ?? fromMapping?.externalName ?? "",
    selectedRate: selectedOption?.rate ?? fromMapping?.externalRate ?? null
  };
}

/**
 * One Carbon tax code → a sales rate and a purchase rate. Each row is its
 * own ValidatedForm posting intent=upsert-tax-code-mapping; the selected
 * rates' names and percentages travel in hidden fields as the mapping's
 * display metadata (mirroring the dimension-value row form).
 */
function TaxCodeMappingRowForm({
  code,
  formatRate,
  sales,
  purchase,
  salesOptions,
  purchaseOptions,
  required,
  canUpdate
}: {
  code: CarbonTaxCodeOption;
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
  const salesChoice = useDirectionChoice(sales, salesOptions, formatRate);
  const purchaseChoice = useDirectionChoice(
    purchase,
    purchaseOptions,
    formatRate
  );

  const placeholder = (direction: TaxDirection) =>
    required?.has(direction) ? t`Required` : t`Select provider rate`;

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
      <input
        type="hidden"
        name="salesExternalName"
        value={salesChoice.selectedName}
      />
      <input
        type="hidden"
        name="salesExternalRate"
        value={salesChoice.selectedRate ?? ""}
      />
      <input
        type="hidden"
        name="purchaseExternalName"
        value={purchaseChoice.selectedName}
      />
      <input
        type="hidden"
        name="purchaseExternalRate"
        value={purchaseChoice.selectedRate ?? ""}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{code.name}</span>
        <span className="text-xs text-muted-foreground">
          {formatRate(code.rate)}
        </span>
      </div>
      <div className="w-[220px] shrink-0">
        <Combobox
          name="salesExternalId"
          options={salesChoice.options}
          placeholder={placeholder("sales")}
          onChange={(option) => salesChoice.setPicked(option?.value ?? null)}
        />
      </div>
      <div className="w-[220px] shrink-0">
        <Combobox
          name="purchaseExternalId"
          options={purchaseChoice.options}
          placeholder={placeholder("purchase")}
          onChange={(option) => purchaseChoice.setPicked(option?.value ?? null)}
        />
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
  proposals,
  codesById,
  formatRate,
  canUpdate,
  onClose
}: {
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
          externalId: proposal.externalId,
          externalName: proposal.externalName,
          externalRate: proposal.externalRate
        })
      );
    }
    submittedRef.current = true;
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Drawer
      open
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
