import { Combobox, Radios, Submit, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Combobox as ControlledCombobox,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuArrowRight, LuLink, LuPlus, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import {
  dimensionSlotsUpdateValidator,
  dimensionValueMappingUpsertValidator
} from "~/modules/settings/settings.models";

/**
 * Local structural mirrors of @carbon/ee/accounting's DimensionTarget /
 * PostingSyncDimensionSlot / DimensionValueMapping /
 * DimensionValueMatchProposal. Deliberately NOT imported (even type-only)
 * to keep this component's type graph light: marginal additions around
 * the settings module push unrelated supabase select-string parses over
 * TS2589's instantiation-depth limit (see SyncActivity.tsx and the note
 * in ./index.ts — this component isn't barrel-exported for the same
 * reason). The route's loader passes real service rows, so any drift
 * fails typecheck there.
 */
export type DimensionTargetOption = {
  id: string;
  label: string;
  capacity: number;
  values: { id: string; name: string }[];
};

export type CarbonDimensionOption = {
  id: string;
  name: string;
  entityType: string;
  valueCount: number;
};

export type DimensionSlotRow = {
  dimensionId: string;
  target: string;
  autoCreate?: boolean;
};

export type DimensionValueMappingRow = {
  id: string;
  dimensionId: string;
  valueId: string;
  label: string | null;
  externalId: string | null;
  externalName: string | null;
};

export type UnmappedDimensionValueRow = {
  dimensionId: string;
  valueId: string;
  label: string | null;
};

export type DimensionValueMatchProposalRow = {
  dimensionId: string;
  valueId: string;
  label: string;
  externalId: string;
  externalName: string | null;
};

/** Dimensions with more values than this get a high-cardinality warning. */
const HIGH_CARDINALITY_THRESHOLD = 100;

type DimensionMappingProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  targets: DimensionTargetOption[];
  /** True when the provider target fetch failed (targets renders empty). */
  targetsError: boolean;
  /** Provider structural cap on slots; null = no cap. */
  maxSlots: number | null;
  /** Provider default for new slots' auto-create (Rillet: on). */
  autoCreateDefault: boolean;
  dimensions: CarbonDimensionOption[];
  slots: DimensionSlotRow[];
  onUnmappedDimensionValue: "warn" | "drop";
  mappings: DimensionValueMappingRow[];
  unmapped: UnmappedDimensionValueRow[];
  proposals: DimensionValueMatchProposalRow[];
};

type EditableSlot = {
  key: string;
  dimensionId: string | null;
  target: string | null;
  autoCreate: boolean;
};

export function DimensionMapping({
  tabs,
  targets,
  targetsError,
  maxSlots,
  autoCreateDefault,
  dimensions,
  slots,
  onUnmappedDimensionValue,
  mappings,
  unmapped,
  proposals
}: DimensionMappingProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");
  const [showMatchDrawer, setShowMatchDrawer] = useState(false);

  const nextKeyRef = useRef(slots.length);
  const [rows, setRows] = useState<EditableSlot[]>(() =>
    slots.map((slot, index) => ({
      key: `slot-${index}`,
      dimensionId: slot.dimensionId,
      target: slot.target,
      autoCreate: slot.autoCreate ?? autoCreateDefault
    }))
  );

  const dimensionsById = useMemo(
    () => new Map(dimensions.map((dimension) => [dimension.id, dimension])),
    [dimensions]
  );
  const targetsById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets]
  );

  // The saved slot config decides which provider option list each
  // dimension's value-mapping rows offer (value mapping applies to SAVED
  // slots — the unmapped list is computed from them server-side).
  const targetByDimension = useMemo(() => {
    const map = new Map<string, DimensionTargetOption>();
    for (const slot of slots) {
      const target = targetsById.get(slot.target);
      if (target) map.set(slot.dimensionId, target);
    }
    return map;
  }, [slots, targetsById]);

  const totalCapacity = targets.reduce(
    (sum, target) => sum + target.capacity,
    0
  );
  const slotCap = Math.min(maxSlots ?? Number.POSITIVE_INFINITY, totalCapacity);
  const canAddSlot = canUpdate && rows.length < slotCap;

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        key: `slot-new-${nextKeyRef.current++}`,
        dimensionId: null,
        target: null,
        autoCreate: autoCreateDefault
      }
    ]);
  };

  const updateRow = (key: string, patch: Partial<EditableSlot>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  };

  const removeRow = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const completeRows = rows.filter(
    (row): row is EditableSlot & { dimensionId: string; target: string } =>
      Boolean(row.dimensionId && row.target)
  );

  const dimensionName = (dimensionId: string) =>
    dimensionsById.get(dimensionId)?.name ?? dimensionId;

  return (
    <>
      <DrawerBody className="gap-6">
        {tabs}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            <Trans>
              Ride Carbon dimensions along on pushed journals. Each slot maps
              one Carbon dimension to one provider analytics target; the value
              mapping below pairs individual dimension values with provider
              options.
            </Trans>
          </p>
          {targets.length > 0 && slots.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<LuLink />}
              onClick={() => setShowMatchDrawer(true)}
            >
              <Trans>Match by name</Trans>
            </Button>
          )}
        </div>

        <ValidatedForm
          validator={dimensionSlotsUpdateValidator}
          method="post"
          defaultValues={{
            intent: "update-dimension-slots",
            onUnmappedDimensionValue
          }}
          className="flex w-full flex-col gap-6"
        >
          <input type="hidden" name="intent" value="update-dimension-slots" />
          {completeRows.map((row) => (
            <input
              key={row.key}
              type="hidden"
              name="slots"
              value={JSON.stringify({
                dimensionId: row.dimensionId,
                target: row.target,
                autoCreate: row.autoCreate
              })}
            />
          ))}

          <section className="flex w-full flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
                  <Trans>Dimension slots</Trans>
                </span>
                <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
                  {rows.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Pick a Carbon dimension and the provider target it posts to.
                  Auto-create adds missing provider options by name at push
                  time.
                </Trans>
              </p>
            </div>
            {targets.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {targetsError ? (
                  <Trans>
                    Couldn't load the provider's dimension targets — check the
                    connection and reload.
                  </Trans>
                ) : (
                  <Trans>
                    The provider offers no dimension targets. Enable the feature
                    in the provider first (e.g. tracking categories, class
                    tracking, or fields).
                  </Trans>
                )}
              </p>
            )}
            <div className="w-full rounded-lg border border-border">
              {rows.length === 0 ? (
                <div className="flex w-full items-center justify-center py-8 text-sm text-muted-foreground">
                  <Trans>No dimension slots configured</Trans>
                </div>
              ) : (
                <div className="flex w-full flex-col divide-y divide-border">
                  {rows.map((row) => (
                    <SlotRowEditor
                      key={row.key}
                      row={row}
                      rows={rows}
                      dimensions={dimensions}
                      dimensionsById={dimensionsById}
                      targets={targets}
                      canUpdate={canUpdate}
                      onChange={(patch) => updateRow(row.key, patch)}
                      onRemove={() => removeRow(row.key)}
                    />
                  ))}
                </div>
              )}
            </div>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<LuPlus />}
                isDisabled={!canAddSlot}
                onClick={addRow}
              >
                <Trans>Add slot</Trans>
              </Button>
              {maxSlots !== null && (
                <span className="text-xs text-muted-foreground">
                  <Trans>
                    {rows.length} of {maxSlots} provider slots used
                  </Trans>
                </span>
              )}
            </HStack>
          </section>

          <section className="flex w-full flex-col gap-2 border-t border-border pt-4">
            <Radios
              name="onUnmappedDimensionValue"
              label={t`Unmapped dimension values`}
              options={[
                {
                  label: t`Park the journal with a warning until the value is mapped`,
                  value: "warn"
                },
                {
                  label: t`Push the journal without the dimension`,
                  value: "drop"
                }
              ]}
            />
          </section>

          <HStack>
            <Submit size="sm" isDisabled={!canUpdate}>
              <Trans>Save dimension settings</Trans>
            </Submit>
          </HStack>
        </ValidatedForm>

        <MappingSection
          title={<Trans>Unmapped values</Trans>}
          description={
            <Trans>
              Dimension values on posted journals that have no provider mapping
              yet.
            </Trans>
          }
          count={unmapped.length}
          emptyMessage={<Trans>All slotted dimension values are mapped</Trans>}
        >
          {unmapped.map((value) => (
            <DimensionValueMappingRowForm
              key={`${value.dimensionId}:${value.valueId}`}
              dimensionId={value.dimensionId}
              dimensionName={dimensionName(value.dimensionId)}
              valueId={value.valueId}
              valueLabel={value.label}
              currentExternalId={null}
              currentExternalName={null}
              target={targetByDimension.get(value.dimensionId) ?? null}
              canUpdate={canUpdate}
            />
          ))}
        </MappingSection>

        <MappingSection
          title={<Trans>Mapped values</Trans>}
          description={
            <Trans>
              Existing mappings. Pick a different provider option to re-map.
            </Trans>
          }
          count={mappings.length}
          emptyMessage={<Trans>No dimension values mapped yet</Trans>}
        >
          {mappings.map((mapping) => (
            <DimensionValueMappingRowForm
              key={mapping.id}
              dimensionId={mapping.dimensionId}
              dimensionName={dimensionName(mapping.dimensionId)}
              valueId={mapping.valueId}
              valueLabel={mapping.label}
              currentExternalId={mapping.externalId}
              currentExternalName={mapping.externalName}
              target={targetByDimension.get(mapping.dimensionId) ?? null}
              canUpdate={canUpdate}
            />
          ))}
        </MappingSection>
      </DrawerBody>

      {showMatchDrawer && (
        <MatchByNameDrawer
          proposals={proposals}
          dimensionName={dimensionName}
          canUpdate={canUpdate}
          onClose={() => setShowMatchDrawer(false)}
        />
      )}
    </>
  );
}

/**
 * One dimension-slot row: Carbon dimension picker → provider target →
 * auto-create switch → remove. Controlled state owned by the parent; the
 * surrounding ValidatedForm posts complete rows as JSON-encoded hidden
 * `slots` fields. Already-used dimensions and at-capacity targets are
 * filtered from the other rows' options (the standalone Combobox has no
 * per-option disable), which enforces one-target-per-dimension and
 * per-target capacity client-side; the action re-validates with
 * validateDimensionSlots server-side.
 */
function SlotRowEditor({
  row,
  rows,
  dimensions,
  dimensionsById,
  targets,
  canUpdate,
  onChange,
  onRemove
}: {
  row: EditableSlot;
  rows: EditableSlot[];
  dimensions: CarbonDimensionOption[];
  dimensionsById: Map<string, CarbonDimensionOption>;
  targets: DimensionTargetOption[];
  canUpdate: boolean;
  onChange: (patch: Partial<EditableSlot>) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();

  const otherRows = rows.filter((candidate) => candidate.key !== row.key);
  const usedDimensionIds = new Set(
    otherRows.flatMap((candidate) =>
      candidate.dimensionId ? [candidate.dimensionId] : []
    )
  );
  const targetUseCounts = new Map<string, number>();
  for (const candidate of otherRows) {
    if (!candidate.target) continue;
    targetUseCounts.set(
      candidate.target,
      (targetUseCounts.get(candidate.target) ?? 0) + 1
    );
  }

  const dimensionOptions = dimensions
    .filter((dimension) => !usedDimensionIds.has(dimension.id))
    .map((dimension) => ({
      value: dimension.id,
      label: dimension.name,
      helper: t`${dimension.valueCount} values`
    }));
  // A saved slot can reference a dimension that is no longer active: keep
  // it selectable/visible via a fallback option.
  if (row.dimensionId && !dimensionsById.has(row.dimensionId)) {
    dimensionOptions.unshift({
      value: row.dimensionId,
      label: row.dimensionId,
      helper: ""
    });
  }

  const targetOptions = targets
    .filter((target) => (targetUseCounts.get(target.id) ?? 0) < target.capacity)
    .map((target) => ({ value: target.id, label: target.label }));
  // A saved slot can point at a target the provider no longer reports (or
  // the target fetch failed): keep it visible via a fallback option.
  if (row.target && !targets.some((target) => target.id === row.target)) {
    targetOptions.unshift({ value: row.target, label: row.target });
  }

  const selectedDimension = row.dimensionId
    ? dimensionsById.get(row.dimensionId)
    : undefined;
  const isHighCardinality =
    (selectedDimension?.valueCount ?? 0) > HIGH_CARDINALITY_THRESHOLD;

  return (
    <div className="flex w-full items-center gap-3 p-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ControlledCombobox
          value={row.dimensionId ?? ""}
          options={dimensionOptions}
          placeholder={t`Select dimension`}
          isReadOnly={!canUpdate}
          onChange={(selected) =>
            onChange({ dimensionId: selected ? selected : null })
          }
        />
        {isHighCardinality && (
          <Badge variant="yellow">
            <Trans>{selectedDimension?.valueCount} values</Trans>
          </Badge>
        )}
      </div>
      <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
      <div className="w-[220px] shrink-0">
        <ControlledCombobox
          value={row.target ?? ""}
          options={targetOptions}
          placeholder={t`Select provider target`}
          isReadOnly={!canUpdate}
          onChange={(selected) =>
            onChange({ target: selected ? selected : null })
          }
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          variant="small"
          checked={row.autoCreate}
          disabled={!canUpdate}
          onCheckedChange={(checked) => onChange({ autoCreate: checked })}
        />
        <span className="text-xs text-muted-foreground">
          <Trans>Auto-create</Trans>
        </span>
      </div>
      <IconButton
        aria-label={t`Remove slot`}
        icon={<LuTrash2 />}
        variant="ghost"
        isDisabled={!canUpdate}
        onClick={onRemove}
      />
    </div>
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
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
            {title}
          </span>
          <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="w-full rounded-lg border border-border">
        {count === 0 ? (
          <div className="flex w-full items-center justify-center py-8 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex w-full flex-col divide-y divide-border">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One Carbon dimension value → provider option row. Each row is its own
 * ValidatedForm posting intent=upsert-dimension-value-mapping; the
 * provider option name travels in a hidden field because the journal
 * syncer surfaces it as the mapping's display metadata (mirroring the
 * account-mapping row form).
 */
function DimensionValueMappingRowForm({
  dimensionId,
  dimensionName,
  valueId,
  valueLabel,
  currentExternalId,
  currentExternalName,
  target,
  canUpdate
}: {
  dimensionId: string;
  dimensionName: string;
  valueId: string;
  valueLabel: string | null;
  currentExternalId: string | null;
  currentExternalName: string | null;
  target: DimensionTargetOption | null;
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const [selectedName, setSelectedName] = useState<string | null>(
    currentExternalId ? currentExternalName : null
  );

  const optionsById = useMemo(
    () => new Map((target?.values ?? []).map((value) => [value.id, value])),
    [target]
  );

  // A mapped provider option can be missing from the target's list (the
  // dimension is no longer slotted, the option was removed, or the target
  // fetch failed): keep it selectable/visible via a fallback option built
  // from the mapping metadata.
  const options = useMemo(() => {
    const base = (target?.values ?? []).map((value) => ({
      value: value.id,
      label: value.name
    }));
    if (!currentExternalId || optionsById.has(currentExternalId)) {
      return base;
    }
    return [
      {
        value: currentExternalId,
        label: currentExternalName ?? currentExternalId
      },
      ...base
    ];
  }, [currentExternalId, currentExternalName, optionsById, target]);

  return (
    <ValidatedForm
      validator={dimensionValueMappingUpsertValidator}
      method="post"
      defaultValues={{
        intent: "upsert-dimension-value-mapping",
        dimensionId,
        valueId,
        externalId: currentExternalId ?? undefined
      }}
      className="flex w-full items-center gap-3 p-3"
    >
      <input
        type="hidden"
        name="intent"
        value="upsert-dimension-value-mapping"
      />
      <input type="hidden" name="dimensionId" value={dimensionId} />
      <input type="hidden" name="valueId" value={valueId} />
      <input type="hidden" name="externalName" value={selectedName ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {valueLabel ?? valueId}
        </span>
        <span className="text-xs text-muted-foreground">{dimensionName}</span>
      </div>
      <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
      <div className="w-[260px] shrink-0">
        <Combobox
          name="externalId"
          options={options}
          placeholder={t`Select provider value`}
          onChange={(option) => {
            if (!option) {
              setSelectedName(null);
              return;
            }
            const providerValue = optionsById.get(option.value);
            if (providerValue) {
              setSelectedName(providerValue.name);
            } else if (option.value === currentExternalId) {
              setSelectedName(currentExternalName);
            } else {
              setSelectedName(null);
            }
          }}
        />
      </div>
      <Submit size="sm" variant="secondary" isDisabled={!canUpdate}>
        <Trans>Save</Trans>
      </Submit>
    </ValidatedForm>
  );
}

/**
 * Preview of exact Carbon-label = provider-name matches with confirm-all.
 * Confirm submits one bulk POST with repeated JSON-encoded `mappings`
 * fields (mirroring the account-mapping MatchByCodeDrawer).
 */
function MatchByNameDrawer({
  proposals,
  dimensionName,
  canUpdate,
  onClose
}: {
  proposals: DimensionValueMatchProposalRow[];
  dimensionName: (dimensionId: string) => string;
  canUpdate: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const submittedRef = useRef(false);

  // Close once the confirm-all POST settles; revalidation has already
  // refreshed the sections behind the drawer.
  useEffect(() => {
    if (submittedRef.current && fetcher.state === "idle") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  const confirmAll = () => {
    if (proposals.length === 0) return;
    const formData = new FormData();
    formData.append("intent", "bulk-upsert-dimension-value-mappings");
    for (const proposal of proposals) {
      formData.append(
        "mappings",
        JSON.stringify({
          dimensionId: proposal.dimensionId,
          valueId: proposal.valueId,
          externalId: proposal.externalId,
          ...(proposal.externalName
            ? { externalName: proposal.externalName }
            : {})
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
            <Trans>Match by name</Trans>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>
              Proposed matches where the Carbon dimension value's name equals a
              provider option name exactly.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {proposals.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Trans>No unmapped values match a provider option name</Trans>
            </div>
          ) : (
            <div className="w-full rounded-lg border border-border">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="px-4">
                      <Trans>Carbon value</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Provider option</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {proposals.map((proposal) => (
                    <Tr key={`${proposal.dimensionId}:${proposal.valueId}`}>
                      <Td className="px-4">
                        <div className="flex flex-col py-1">
                          <span className="text-sm font-medium">
                            {proposal.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {dimensionName(proposal.dimensionId)}
                          </span>
                        </div>
                      </Td>
                      <Td className="px-4">
                        <span className="text-sm font-medium">
                          {proposal.externalName ?? proposal.externalId}
                        </span>
                      </Td>
                    </Tr>
                  ))}
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
