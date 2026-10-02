// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { useState } from "react";
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
  // Labelled with the parameter's name (`step.label`) when it has one.
  Configuration: { label: "Configuration", variant: "purple" },
  "Final Price": null
};

const HEAD_CELL =
  "text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap";

// True when anything beyond the base price moved the price — an override,
// a pricing rule or a configuration price.
export function hasPriceAdjustments(
  trace: PriceTraceStep[] | null | undefined
) {
  return (
    Array.isArray(trace) &&
    trace.some(
      (step) => step.step !== "Base Price" && step.step !== "Final Price"
    )
  );
}

type PriceTraceModalProps = {
  trace: PriceTraceStep[] | null | undefined;
  currencyCode: string;
};

export function PriceTraceModal({ trace, currencyCode }: PriceTraceModalProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const steps = Array.isArray(trace) ? trace : [];
  if (steps.length === 0) return null;

  // The button is the dialog's trigger so Radix returns focus to it on close.
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <ModalTrigger asChild>
            <button
              type="button"
              aria-label={t`How this price was calculated`}
              className="text-xxs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
            >
              <LuCalculator className="size-3" />
            </button>
          </ModalTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <Trans>How this price was calculated</Trans>
        </TooltipContent>
      </Tooltip>
      <ModalContent size="xxlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Pricing Trace</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>How the resolved price was calculated.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <PriceTraceTable trace={steps} currencyCode={currencyCode} />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export function PriceTraceTable({
  trace,
  currencyCode
}: {
  trace: PriceTraceStep[];
  currencyCode: string;
}) {
  const currencyFormatter = useCurrencyFormatter({
    rate: true,
    currency: currencyCode
  });
  const format = (value: number) => currencyFormatter.format(value);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <Thead>
          <Tr>
            <Th className={HEAD_CELL}>
              <Trans>Step</Trans>
            </Th>
            <Th className={HEAD_CELL}>
              <Trans>Type</Trans>
            </Th>
            <Th className={HEAD_CELL}>
              <Trans>Description</Trans>
            </Th>
            <Th className={`${HEAD_CELL} text-right`}>
              <Trans>Change</Trans>
            </Th>
            <Th className={`${HEAD_CELL} text-right`}>
              <Trans>Running Total</Trans>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {trace.map((step, i) => {
            const isFinal = step.step === "Final Price";
            return (
              <Tr
                key={i}
                className={
                  isFinal ? "border-t border-border font-semibold" : undefined
                }
              >
                <Td className="text-sm whitespace-nowrap">{step.step}</Td>
                <Td className="text-sm whitespace-nowrap">
                  <StepTypeBadge step={step} />
                </Td>
                <Td
                  className="text-sm text-muted-foreground max-w-[320px]"
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
                <Td className="text-right text-sm whitespace-nowrap tabular-nums">
                  {format(step.amount)}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </div>
  );
}

function StepTypeBadge({ step }: { step: PriceTraceStep }) {
  const mapping = STEP_BADGE[step.step];
  if (mapping === null) return null;
  if (!mapping) return <Badge variant="gray">{step.step}</Badge>;
  return <Badge variant={mapping.variant}>{step.label ?? mapping.label}</Badge>;
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
