import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { LuCalculator, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type { PriceTraceStep } from "../../types";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const STEP_BADGE: Record<
  string,
  { label: string; variant: BadgeVariant } | null
> = {
  "Base Price": { label: "Base", variant: "gray" },
  Override: { label: "Override", variant: "yellow" },
  "Type Override": { label: "Type Override", variant: "blue" },
  "All Override": { label: "All Override", variant: "gray" },
  Discount: { label: "Discount", variant: "red" },
  Markup: { label: "Markup", variant: "green" },
  "Final Price": null
};

type PriceTracePopoverProps = {
  trace: PriceTraceStep[] | null | undefined;
  currencyCode: string;
  /** Optional trigger content. If omitted, renders a "View calc" text button. */
  children?: ReactNode;
};

export function PriceTracePopover({
  trace,
  currencyCode,
  children
}: PriceTracePopoverProps) {
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });
  const format = (value: number) => currencyFormatter.format(value);

  const steps = Array.isArray(trace) ? trace : [];
  if (steps.length === 0) {
    return children ? <>{children}</> : null;
  }

  const trigger = children ? (
    <button
      type="button"
      className="cursor-help decoration-dotted underline-offset-2 hover:underline"
    >
      {children}
    </button>
  ) : (
    <button
      type="button"
      aria-label="How this price was calculated"
      className="text-xxs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
    >
      <LuCalculator className="size-3" />
    </button>
  );

  return (
    <Popover>
      {children ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <Trans>How this price was calculated</Trans>
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent align="end" sideOffset={8} className="max-w-[800px] p-0">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">
            <Trans>Pricing Trace</Trans>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <Trans>How the resolved price was calculated.</Trans>
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  <Trans>Step</Trans>
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  <Trans>Type</Trans>
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  <Trans>Description</Trans>
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">
                  <Trans>Change</Trans>
                </Th>
                <Th className="text-xs uppercase tracking-wide text-muted-foreground text-right whitespace-nowrap">
                  <Trans>Running Total</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {steps.map((step, i) => {
                const isFinal = step.step === "Final Price";
                return (
                  <Tr
                    key={i}
                    className={
                      isFinal
                        ? "border-t border-border font-semibold"
                        : undefined
                    }
                  >
                    <Td className="text-sm whitespace-nowrap">{step.step}</Td>
                    <Td className="text-sm whitespace-nowrap">
                      <StepTypeBadge step={step} />
                    </Td>
                    <Td
                      className="text-sm text-muted-foreground max-w-[240px]"
                      title={step.source}
                    >
                      {step.ruleId ? (
                        <Link
                          to={path.to.pricingRule(step.ruleId)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground hover:underline decoration-dotted underline-offset-2 inline-flex items-center gap-1 max-w-full"
                        >
                          <span className="truncate">{step.source}</span>
                          <LuExternalLink className="size-3 shrink-0" />
                        </Link>
                      ) : (
                        <span className="block truncate">{step.source}</span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <DeltaPill value={step.adjustment} format={format} />
                    </Td>
                    <Td className="text-right text-sm whitespace-nowrap">
                      {format(step.amount)}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StepTypeBadge({ step }: { step: PriceTraceStep }) {
  const mapping = STEP_BADGE[step.step];
  if (mapping === null) return null;
  if (!mapping) return <Badge variant="gray">{step.step}</Badge>;
  return <Badge variant={mapping.variant}>{mapping.label}</Badge>;
}

export function DeltaPill({
  value,
  format
}: {
  value: number | undefined;
  format: (value: number) => string;
}) {
  if (value === undefined || value === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const isNegative = value < 0;
  const variant = isNegative ? "red" : "green";
  const sign = isNegative ? "" : "+";
  return (
    <Badge variant={variant}>
      {sign}
      {format(value)}
    </Badge>
  );
}
