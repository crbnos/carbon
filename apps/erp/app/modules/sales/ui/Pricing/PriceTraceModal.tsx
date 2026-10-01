// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
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
import { type ComponentProps, type ReactNode, useState } from "react";
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

type PriceTraceModalProps = {
  trace: PriceTraceStep[] | null | undefined;
  currencyCode: string;
  /** Optional trigger content. If omitted, renders a "View calc" text button. */
  children?: ReactNode;
};

export function PriceTraceModal({
  trace,
  currencyCode,
  children
}: PriceTraceModalProps) {
  const [open, setOpen] = useState(false);
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
      onClick={() => setOpen(true)}
    >
      {children}
    </button>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="How this price was calculated"
          className="text-xxs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
          onClick={() => setOpen(true)}
        >
          <LuCalculator className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <Trans>How this price was calculated</Trans>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <>
      {trigger}
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="xlarge">
          <ModalHeader>
            <ModalTitle>
              <Trans>Pricing Trace</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>How the resolved price was calculated.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
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
                        <Td className="text-sm whitespace-nowrap">
                          {step.step}
                        </Td>
                        <Td className="text-sm whitespace-nowrap">
                          <StepTypeBadge step={step} />
                        </Td>
                        <Td
                          className="text-sm text-muted-foreground max-w-[240px]"
                          title={step.source}
                        >
                          <PriceTraceStepSource step={step} />
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
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              <Trans>Close</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

// A step's description; links to the pricing rule behind it when there is one.
export function PriceTraceStepSource({ step }: { step: PriceTraceStep }) {
  if (!step.ruleId) {
    return <span className="block truncate">{step.source}</span>;
  }
  return (
    <Link
      to={path.to.pricingRule(step.ruleId)}
      target="_blank"
      rel="noreferrer"
      className="hover:text-foreground hover:underline decoration-dotted underline-offset-2 inline-flex items-center gap-1 max-w-full"
    >
      <span className="truncate">{step.source}</span>
      <LuExternalLink className="size-3 shrink-0" />
    </Link>
  );
}

export function StepTypeBadge({ step }: { step: PriceTraceStep }) {
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
