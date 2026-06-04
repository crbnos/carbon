import { cn, IconButton } from "@carbon/react";
import {
  availableOperators,
  type Condition,
  type FieldDef,
  getFieldDef,
  getFieldSurfaceNotes,
  isFieldAvailableOnSurfaces,
  type Operator,
  SURFACES_BY_TARGET_TYPE,
  type TransactionSurface
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { memo, useEffect, useMemo } from "react";
import { LuX } from "react-icons/lu";
import FieldCombobox from "./FieldCombobox";
import OperatorCombobox from "./OperatorCombobox";
import type { ValueOptionsByLoader } from "./useValueOptions";
import ValueInput from "./ValueInput";

// Pretty labels for per-surface notes. Mirrors SURFACE_META in SurfacesField
// but kept lean — only the title is shown.
const SURFACE_LABEL: Record<TransactionSurface, string> = {
  receipt: "Receipts",
  shipment: "Shipments",
  stockTransfer: "Stock transfers",
  warehouseTransfer: "Warehouse transfers",
  inventoryAdjustment: "Inventory adjustments",
  place: "Place",
  pick: "Pick",
  operationStart: "Operation start",
  operationFinish: "Operation finish",
  materialIssue: "Material issue",
  materialReceive: "Material receive"
};

const pickDefaultOp = (ops: Operator[]): Operator =>
  ops.includes("eq") ? "eq" : (ops[0] ?? "eq");

export const CONDITION_GRID_CLASS =
  "grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]";

type ConditionRowProps = {
  condition: Condition;
  index: number;
  canRemove: boolean;
  onChange: (index: number, patch: Partial<Condition>) => void;
  onRemove: (index: number) => void;
  optionsByLoader: ValueOptionsByLoader;
  targetType?: "item" | "workCenter";
  /**
   * Live list of surfaces the parent rule is configured for. When provided,
   * the per-surface notes panel filters to this set. Falls back to all
   * surfaces valid for the targetType when omitted.
   */
  surfaces?: TransactionSurface[];
};

function ConditionRowImpl({
  condition,
  index,
  canRemove,
  onChange,
  onRemove,
  optionsByLoader,
  targetType,
  surfaces
}: ConditionRowProps) {
  const { t } = useLingui();

  const fieldDef = useMemo<FieldDef | undefined>(
    () => getFieldDef(condition.field),
    [condition.field]
  );

  // A field selected before the surfaces changed may no longer be populated on
  // the rule's current surfaces. Flag it so the author re-picks — mirrors the
  // save-time validator gate (storageRules.models.ts) client-side.
  const fieldUnavailable = useMemo(
    () =>
      !!fieldDef &&
      !!surfaces &&
      surfaces.length > 0 &&
      !isFieldAvailableOnSurfaces(fieldDef, surfaces),
    [fieldDef, surfaces]
  );

  const availableOps = useMemo<Operator[]>(
    () => (fieldDef ? availableOperators(fieldDef) : []),
    [fieldDef]
  );

  const valueOptions = useMemo(
    () =>
      fieldDef?.valueOptionsLoader
        ? optionsByLoader[fieldDef.valueOptionsLoader]
        : undefined,
    [fieldDef, optionsByLoader]
  );

  // Per-surface semantic notes for ambiguous fields (e.g. transaction.quantity
  // means different things on operationStart vs operationFinish). Filter to
  // surfaces the rule actually fires on when the parent supplies them; fall
  // back to all surfaces valid for the targetType otherwise.
  const surfaceNotes = useMemo<
    { surface: TransactionSurface; note: string }[] | null
  >(() => {
    const all = getFieldSurfaceNotes(condition.field);
    if (!all) return null;
    const scope: readonly TransactionSurface[] =
      surfaces && surfaces.length > 0
        ? surfaces
        : targetType
          ? SURFACES_BY_TARGET_TYPE[targetType]
          : [];
    const rows: { surface: TransactionSurface; note: string }[] = [];
    for (const s of scope) {
      const note = all[s];
      if (note) rows.push({ surface: s, note });
    }
    return rows.length > 0 ? rows : null;
  }, [condition.field, targetType, surfaces]);

  // Self-heal: stored op no longer in the field's allowed set (legacy data,
  // or the field's `nullable` flag flipped post-save). Patch down to a valid
  // op so the user can save the rule back clean.
  useEffect(() => {
    if (!fieldDef) return;
    if (availableOps.includes(condition.op)) return;
    onChange(index, { op: pickDefaultOp(availableOps), value: undefined });
  }, [fieldDef, availableOps, condition.op, index, onChange]);

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className={cn(
          "group flex-1 min-w-0 rounded-lg border border-border bg-card p-3",
          "transition-colors hover:border-border/80"
        )}
      >
        <div className={CONDITION_GRID_CLASS}>
          <FieldCombobox
            value={condition.field}
            targetType={targetType}
            surfaces={surfaces}
            onChange={(path) => {
              const nextDef = getFieldDef(path);
              const nextOps = nextDef ? availableOperators(nextDef) : [];
              onChange(index, {
                field: path,
                op: pickDefaultOp(nextOps),
                value: undefined
              });
            }}
          />

          <OperatorCombobox
            value={condition.op}
            onChange={(op: Operator) =>
              onChange(index, { op, value: undefined })
            }
            available={availableOps}
            disabled={!fieldDef}
          />

          <ValueInput
            fieldDef={fieldDef}
            op={condition.op}
            value={condition.value}
            options={valueOptions}
            onChange={(next) => onChange(index, { value: next })}
          />
        </div>

        {fieldUnavailable && (
          <p className="mt-2 text-xs font-medium leading-none text-destructive">
            {t`"${fieldDef?.label ?? condition.field}" isn't available on the selected surface(s). Pick another field.`}
          </p>
        )}

        {surfaceNotes && (
          <details className="mt-2 group rounded-md border border-dashed border-border/70 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-muted-foreground/90 hover:text-foreground">
              {t`Value source by surface`}
            </summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {surfaceNotes.map(({ surface, note }) => (
                <li
                  key={surface}
                  className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2"
                >
                  <span className="font-medium text-foreground/80">
                    {SURFACE_LABEL[surface]}
                  </span>
                  <span className="leading-snug">{note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <IconButton
        icon={<LuX />}
        aria-label={t`Remove condition`}
        variant="ghost"
        size="sm"
        onClick={() => onRemove(index)}
        isDisabled={!canRemove}
        className={cn(
          "shrink-0",
          !canRemove && "opacity-0 pointer-events-none"
        )}
      />
    </div>
  );
}

export default memo(ConditionRowImpl);
