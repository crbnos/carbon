import { Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import {
  getLocalTimeZone,
  parseAbsolute,
  parseDate,
  toCalendarDate
} from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuCalendarCheck,
  LuExternalLink,
  LuLayers,
  LuPackage,
  LuPencil,
  LuShieldCheck
} from "react-icons/lu";
import { Link } from "react-router";
import { useDateFormatter } from "~/hooks";
import type { TrackedEntity } from "~/modules/inventory";
import { path } from "~/utils/path";

/**
 * Steps a tracked entity's expirationDate can flow through. Mirrors the
 * shape of {@link PriceTraceStep} (sales/types) so the popover layout
 * stays consistent with PriceTracePopover.
 *
 * - "Source"   : where this entity was created (Receipt / Production /
 *                Split / Manual).
 * - "Policy"   : the itemShelfLife mode that drove the expirationDate
 *                (Fixed Duration / Calculated / Set on Receipt).
 * - "Inputs"   : when policy = Calculated, the inputs whose expiries fed
 *                MIN(). Optional — only shown when present.
 * - "Resolved" : the date now sitting in the column.
 */
type ExpiryTraceStep = {
  step: "Source" | "Policy" | "Inputs" | "Override" | "Resolved";
  /** Short human label for the row. */
  label: string;
  /** Optional muted detail line below the label. */
  detail?: string;
  /** Optional link target; renders as an external-link affordance. */
  href?: string;
  /** Optional ISO date string — rendered right-aligned. */
  date?: string | null;
};

const STEP_ICON: Record<ExpiryTraceStep["step"], ReactNode> = {
  Source: <LuPackage className="size-3.5" />,
  Policy: <LuShieldCheck className="size-3.5" />,
  Inputs: <LuLayers className="size-3.5" />,
  Override: <LuPencil className="size-3.5" />,
  Resolved: <LuCalendarCheck className="size-3.5" />
};

type ExpiryTracePopoverProps = {
  /** The row driving the popover. */
  entity: Pick<
    TrackedEntity,
    | "expirationDate"
    | "sourceDocument"
    | "sourceDocumentId"
    | "sourceDocumentReadableId"
    | "attributes"
    | "createdAt"
  >;
  /** Optional shelf-life policy for the entity's item, if known by caller. */
  policy?: {
    mode: "Fixed Duration" | "Calculated" | "Set on Receipt" | null;
    days?: number | null;
    calculateFromBom?: boolean | null;
  } | null;
  /** Optional precomputed input expiries when the policy is Calculated. */
  inputs?: Array<{ id: string; expirationDate: string | null; label?: string }>;
  /** The trigger that opens the popover. */
  children: ReactNode;
};

/**
 * Hover-style popover that explains how the expirationDate column was
 * resolved. Same layout as PriceTracePopover so users get a single
 * mental model for "trace" UIs.
 *
 * Steps are derived from the row's attributes JSONB plus optional
 * caller-supplied policy + inputs. Returns the trigger as-is when there
 * is no expiry to trace (renders no popover).
 */
export function ExpiryTracePopover({
  entity,
  policy,
  inputs,
  children
}: ExpiryTracePopoverProps) {
  const { formatDate } = useDateFormatter();
  if (!entity.expirationDate) {
    return <>{children}</>;
  }

  const steps = buildSteps(entity, policy, inputs, formatDate);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-help decoration-dotted underline-offset-2 hover:underline text-left"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0">
        {/* Header: tight, scannable. */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="text-sm font-semibold">
              <Trans>Expiry trace</Trans>
            </p>
          </div>
        </div>

        {/* Vertical timeline. Each step = icon column (with connector line)
            + content. Compact rows, two-line content (label + detail),
            right-aligned date when present. */}
        <ol className="px-4 py-3">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const isResolved = step.step === "Resolved";
            return (
              <li
                key={i}
                className="grid grid-cols-[20px_1fr_auto] gap-x-3 gap-y-0"
              >
                {/* Icon + connector */}
                <div className="flex flex-col items-center">
                  <span
                    className={
                      isResolved
                        ? "flex h-5 w-5 items-center justify-center rounded-full text-emerald-500"
                        : "flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
                    }
                  >
                    {STEP_ICON[step.step]}
                  </span>
                  {!isLast && (
                    <span className="w-px flex-1 bg-border min-h-3" />
                  )}
                </div>

                {/* Content */}
                <div className={"min-w-0 " + (isLast ? "pb-0" : "pb-3")}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground">
                      {step.step}
                    </span>
                  </div>
                  {step.href ? (
                    <Link
                      to={step.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium hover:underline decoration-dotted underline-offset-2 inline-flex items-center gap-1 min-w-0 max-w-full"
                    >
                      <span className="truncate">{step.label}</span>
                      <LuExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </Link>
                  ) : (
                    <div className="text-sm font-medium truncate">
                      {step.label}
                    </div>
                  )}
                  {step.detail && (
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={step.detail}
                    >
                      {step.detail}
                    </div>
                  )}
                </div>

                {/* Date column */}
                <div
                  className={
                    "text-xs font-mono tabular-nums whitespace-nowrap pt-3.5 " +
                    (isResolved
                      ? "text-foreground font-semibold"
                      : "text-muted-foreground")
                  }
                >
                  {step.date ? formatDate(step.date) : ""}
                </div>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Build the trace from the row's attributes blob. Pulls in policy + inputs
 * if the caller passed them; otherwise emits the steps it can derive.
 */
function buildSteps(
  entity: ExpiryTracePopoverProps["entity"],
  policy: ExpiryTracePopoverProps["policy"],
  inputs: ExpiryTracePopoverProps["inputs"],
  formatDate: (date: string | null | undefined) => string
): ExpiryTraceStep[] {
  const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
  const out: ExpiryTraceStep[] = [];

  // 1. Source: how the entity got created. Use the entity's createdAt as
  // the Source row's date — that's when the receipt / production / split
  // happened. For receipt-source entities this is the goods-in date.
  const sourceDate = entity.createdAt ?? null;
  const splitFrom = attrs["Split Entity ID"];
  const receiptId = attrs.Receipt;
  const jobId = attrs.Job;
  const adjustment = attrs["Inventory Adjustment"] as
    | { userId?: string; at?: string; reason?: string }
    | undefined;
  if (typeof splitFrom === "string" && splitFrom) {
    out.push({
      step: "Source",
      label: "Split from another batch",
      detail: `Parent ${splitFrom}`,
      date: sourceDate
    });
  } else if (typeof receiptId === "string" && receiptId) {
    out.push({
      step: "Source",
      label: "Goods receipt",
      detail: entity.sourceDocumentReadableId ?? receiptId,
      href: path.to.receipt(receiptId),
      date: sourceDate
    });
  } else if (typeof jobId === "string" && jobId) {
    out.push({
      step: "Source",
      label: "Production output",
      detail: entity.sourceDocumentReadableId ?? jobId,
      href: path.to.job(jobId),
      date: sourceDate
    });
  } else if (adjustment && typeof adjustment === "object") {
    out.push({
      step: "Source",
      label: "Manual inventory adjustment",
      detail: adjustment.at
        ? `Recorded ${formatDate(adjustment.at)}`
        : (entity.sourceDocumentReadableId ?? undefined),
      date: sourceDate
    });
  } else {
    out.push({
      step: "Source",
      label: entity.sourceDocument ?? "Unknown",
      detail: entity.sourceDocumentReadableId ?? undefined,
      date: sourceDate
    });
  }

  // 2. Policy: itemShelfLife mode (when caller passed it).
  if (policy?.mode) {
    const baseDetail =
      policy.mode === "Fixed Duration" && policy.days
        ? `${policy.days} day${policy.days === 1 ? "" : "s"} from trigger`
        : policy.mode === "Calculated"
          ? "MIN expiry across consumed inputs"
          : "Date entered at receipt";
    const detailParts = [baseDetail];
    if (policy.mode === "Fixed Duration" && policy.calculateFromBom) {
      detailParts.push("Capped by earliest input expiry");
    }
    out.push({
      step: "Policy",
      label: policy.mode,
      detail: detailParts.join(" · "),
      date: computePolicyDate(policy, entity, inputs, attrs, sourceDate)
    });
  }

  // 3. Inputs: only meaningful for Calculated mode.
  if (policy?.mode === "Calculated" && inputs && inputs.length > 0) {
    inputs.forEach((input) => {
      out.push({
        step: "Inputs",
        label: input.label ?? input.id,
        detail: input.expirationDate ? undefined : "no expiry",
        date: input.expirationDate
      });
    });
  }

  // 4. Manual overrides recorded by updateTrackedEntityExpiry. Each entry
  // shows the date set, the reason, and when it was applied.
  const overrides = Array.isArray(attrs.expiryOverrides)
    ? (attrs.expiryOverrides as Array<{
        previous?: string | null;
        next?: string | null;
        reason?: string;
        source?: string | null;
        userId?: string;
        at?: string;
      }>)
    : [];
  overrides.forEach((o) => {
    const detailParts: string[] = [];
    if (o.source) detailParts.push(o.source);
    if (o.at) detailParts.push(`recorded ${formatDate(o.at)}`);
    out.push({
      step: "Override",
      label: o.reason ?? "Manual override",
      detail: detailParts.length ? detailParts.join(" · ") : undefined,
      date: o.next ?? null
    });
  });

  // 5. Resolved.
  out.push({
    step: "Resolved",
    label: "Final expiration date",
    date: entity.expirationDate
  });

  return out;
}

/**
 * Date the policy *originally produced*, before any manual overrides.
 * Falls back to the current expirationDate when there are no overrides
 * (since the resolved value is the policy output in that case).
 */
function computePolicyDate(
  policy: NonNullable<ExpiryTracePopoverProps["policy"]>,
  entity: ExpiryTracePopoverProps["entity"],
  inputs: ExpiryTracePopoverProps["inputs"],
  attrs: Record<string, unknown>,
  sourceDate: string | null
): string | null {
  const overrides = Array.isArray(attrs.expiryOverrides)
    ? (attrs.expiryOverrides as Array<{ previous?: string | null }>)
    : [];
  if (overrides.length > 0 && typeof overrides[0].previous === "string") {
    return overrides[0].previous;
  }

  if (policy.mode === "Fixed Duration" && policy.days && sourceDate) {
    try {
      const calendarDate = sourceDate.includes("T")
        ? toCalendarDate(parseAbsolute(sourceDate, getLocalTimeZone()))
        : parseDate(sourceDate);
      return calendarDate.add({ days: policy.days }).toString();
    } catch {
      // fall through to default
    }
  }

  if (policy.mode === "Calculated" && inputs && inputs.length > 0) {
    const dates = inputs
      .map((i) => i.expirationDate)
      .filter((d): d is string => typeof d === "string" && d.length > 0)
      .sort();
    if (dates.length > 0) return dates[0];
  }

  return entity.expirationDate ?? null;
}
