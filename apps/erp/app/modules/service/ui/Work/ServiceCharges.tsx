// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  LabelWithHelp,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  LuEllipsis,
  LuPackageMinus,
  LuReceipt,
  LuShieldQuestion,
  LuTimer,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import { DateTime } from "~/components";
import {
  Hidden,
  NumberControlled,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyFormatter, useQuantityFormatter, useUser } from "~/hooks";
import { useCurrencyDecimals } from "~/hooks/useCurrencies";
import { IssueMaterialModal } from "~/modules/projects/ui/Element/IssueMaterialModal";
import { LogTimeModal } from "~/modules/projects/ui/Element/LogTimeModal";
import { useItems } from "~/stores";
import type { ServiceCoverage } from "../../service.models";
import {
  canOverrideCoverage,
  canReverseCharge,
  coverageOverrideValidator,
  isReversibleDocument,
  serviceChargeReversalValidator,
  serviceCoverages,
  serviceNodeFixedPriceValidator
} from "../../service.models";
import type { ServiceCharge } from "../../types";
import AddExpenseModal from "./AddExpenseModal";
import { CoveragePill, useCoverageLabels } from "./CoveragePill";

type ServiceChargeElement = {
  id: string;
  readableId: string;
  name: string;
  itemId: string | null;
};

/**
 * The charge actions of a service element's ⋯ menu (Log time, Issue part,
 * Add expense) and the dialogs they open. The dialogs post to the order's
 * charge route, as the visit page's do.
 */
export function useServiceChargeActions({
  projectId,
  element,
  chargeAction,
  laborCategories,
  defaultLaborCategoryId,
  serviceVisitId,
  canCharge,
  canIssue
}: {
  projectId: string;
  element: ServiceChargeElement;
  /** The order's charge route. */
  chargeAction: string;
  laborCategories: { id: string; name: string }[];
  defaultLaborCategoryId: string | null;
  /** The visit the charges belong to, when there is one. */
  serviceVisitId?: string | null;
  canCharge: boolean;
  canIssue: boolean;
}): { menuItems: ReactNode; dialogs: ReactNode } {
  const [modal, setModal] = useState<"time" | "part" | "expense" | null>(null);
  const hiddenFields = (intent: string) => ({
    intent,
    ...(serviceVisitId ? { serviceVisitId } : {})
  });

  const menuItems = (
    <>
      <DropdownMenuItem
        disabled={!canCharge || laborCategories.length === 0}
        onClick={() => setModal("time")}
      >
        <DropdownMenuIcon icon={<LuTimer />} />
        <Trans>Log time</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canCharge || !canIssue}
        onClick={() => setModal("part")}
      >
        <DropdownMenuIcon icon={<LuPackageMinus />} />
        <Trans>Issue part</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canCharge}
        onClick={() => setModal("expense")}
      >
        <DropdownMenuIcon icon={<LuReceipt />} />
        <Trans>Add expense</Trans>
      </DropdownMenuItem>
    </>
  );

  const dialogs = (
    <>
      {modal === "time" && (
        <LogTimeModal
          projectId={projectId}
          element={element}
          laborCategories={laborCategories}
          defaultLaborCategoryId={defaultLaborCategoryId}
          action={chargeAction}
          hiddenFields={hiddenFields("time")}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "part" && (
        <IssueMaterialModal
          projectId={projectId}
          element={element}
          action={chargeAction}
          hiddenFields={hiddenFields("part")}
          variant="service"
          onClose={() => setModal(null)}
        />
      )}
      {modal === "expense" && (
        <AddExpenseModal
          action={chargeAction}
          node={element}
          serviceVisitId={serviceVisitId}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );

  return { menuItems, dialogs };
}

/**
 * A service element's charges, with who pays for each. A charge that is not
 * billed can move to another coverage, with a reason. A time or expense
 * charge can be reversed, with a reason; a part is returned with Issue part.
 */
export function ServiceCharges({
  charges,
  chargeAction,
  serviceVisitId,
  canCharge
}: {
  charges: ServiceCharge[];
  /** The order's charge route. */
  chargeAction: string;
  serviceVisitId?: string | null;
  canCharge: boolean;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const formatCurrency = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const [overriding, setOverriding] = useState<ServiceCharge | null>(null);
  const [reversing, setReversing] = useState<ServiceCharge | null>(null);

  const reversedIds = useMemo(
    () =>
      new Set(
        charges
          .map((charge) => charge.reversalOfId)
          .filter((id): id is string => Boolean(id))
      ),
    [charges]
  );
  const itemLabel = useMemo(
    () => new Map(items.map((item) => [item.id, item.readableIdWithRevision])),
    [items]
  );
  const costTypeLabels: Record<string, string> = {
    Labor: t`Labor`,
    Material: t`Part`,
    "Other Direct": t`Expense`
  };

  return (
    <>
      <div className="w-full overflow-x-auto rounded-md border border-border">
        <Table full>
          <Thead>
            <Tr>
              <Th>
                <Trans>Charge</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Quantity</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Cost</Trans>
              </Th>
              <Th>
                <LabelWithHelp termId="coverage" variant="inline">
                  <Trans>Coverage</Trans>
                </LabelWithHelp>
              </Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {charges.map((charge) => {
              const billable = charge.billableItems?.[0] ?? null;
              const canOverride =
                canCharge &&
                canOverrideCoverage(
                  charge,
                  reversedIds,
                  billable?.status ?? null
                );
              const canReverse =
                canCharge && canReverseCharge(charge, reversedIds);
              const reversible =
                isReversibleDocument(charge.documentType) &&
                !charge.reversalOfId;
              return (
                <Tr key={charge.id}>
                  <Td>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {costTypeLabels[charge.costType] ?? charge.costType}
                        {charge.itemId &&
                          ` · ${itemLabel.get(charge.itemId) ?? ""}`}
                      </span>
                      <span className="flex flex-wrap gap-x-1 text-xs text-muted-foreground">
                        <DateTime value={charge.postingDate} variant="date" />
                        {charge.reversalOfId && (
                          <span>
                            · <Trans>Reversal</Trans>
                          </span>
                        )}
                        {billable?.status === "Billed" && (
                          <span>
                            · <Trans>Billed</Trans>
                          </span>
                        )}
                      </span>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    {charge.quantity === null
                      ? "—"
                      : `${formatQuantity(Number(charge.quantity))} ${charge.unitOfMeasureCode ?? ""}`}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatCurrency.format(Number(charge.amount))}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      {charge.coverage ? (
                        <CoveragePill coverage={charge.coverage} />
                      ) : (
                        "—"
                      )}
                      {charge.coverageReason && (
                        <Badge variant="outline">
                          <Trans>Overridden</Trans>
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`More options`}
                          icon={<LuEllipsis />}
                          variant="ghost"
                          size="sm"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!canOverride}
                          onClick={() => setOverriding(charge)}
                        >
                          <DropdownMenuIcon icon={<LuShieldQuestion />} />
                          <Trans>Override coverage</Trans>
                        </DropdownMenuItem>
                        {reversible && (
                          <DropdownMenuItem
                            disabled={!canReverse}
                            onClick={() => setReversing(charge)}
                          >
                            <DropdownMenuIcon icon={<LuUndo2 />} />
                            <Trans>Reverse</Trans>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </div>

      {overriding && (
        <OverrideCoverageModal
          action={chargeAction}
          charge={overriding}
          onClose={() => setOverriding(null)}
        />
      )}
      {reversing && (
        <ReverseChargeModal
          action={chargeAction}
          charge={reversing}
          description={costTypeLabels[reversing.costType] ?? reversing.costType}
          serviceVisitId={serviceVisitId}
          onClose={() => setReversing(null)}
        />
      )}
    </>
  );
}

/**
 * Reverses one time or expense charge: the reversal posts at the charge's
 * coverage and reverses its billable item. The reason is required.
 */
function ReverseChargeModal({
  action,
  charge,
  description,
  serviceVisitId,
  onClose
}: {
  action: string;
  charge: ServiceCharge;
  description: string;
  serviceVisitId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const formatCurrency = useCurrencyFormatter();
  const amount = formatCurrency.format(Number(charge.amount));
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({ onSuccess: () => onClose() });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={serviceChargeReversalValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{ projectLedgerId: charge.id, reason: "" }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Reverse Charge</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                {description} of {amount}. The reversal posts at the same
                coverage, and its billable item is written off or credited.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="reverse" />
            <Hidden name="projectLedgerId" />
            {serviceVisitId && (
              <Hidden name="serviceVisitId" value={serviceVisitId} />
            )}
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <TextArea name="reason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Reverse</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/** Moves one charge to another coverage. The reason is required. */
function OverrideCoverageModal({
  action,
  charge,
  onClose
}: {
  action: string;
  charge: ServiceCharge;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const labels = useCoverageLabels();
  const fetcher = useAction<{
    success?: boolean;
    error?: { message: string } | null;
  }>({ onSuccess: () => onClose() });
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;
  const options = serviceCoverages
    .filter((coverage) => coverage !== charge.coverage)
    .map((coverage: ServiceCoverage) => ({
      value: coverage,
      label: labels[coverage]
    }));

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={coverageOverrideValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{ coverage: options[0]?.value, reason: "" }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Override Coverage</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                The charge moves to the new coverage, and its cost to that
                coverage's account.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="reclass" />
            <Hidden name="projectLedgerId" value={charge.id} />
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <Select
                name="coverage"
                label={t`Coverage`}
                termId="coverage"
                options={options}
              />
              <TextArea name="reason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Override</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * The element's fixed price, inline in the sidebar's Work group. With one,
 * the invoice bills the element and the work under it as one line at that
 * price; empty bills each item.
 */
export function FixedPriceField({
  action,
  fixedPrice,
  isDisabled
}: {
  /** The element page's route, which saves `intent=fixedPrice`. */
  action: string;
  fixedPrice: number | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currencyCode);
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save the fixed price`)
  });
  const pending = fetcher.formData?.get("fixedPrice");
  const current =
    typeof pending === "string"
      ? pending === ""
        ? null
        : Number(pending)
      : fixedPrice;

  return (
    <ValidatedForm
      key={`fixedPrice:${fixedPrice ?? ""}`}
      validator={serviceNodeFixedPriceValidator}
      defaultValues={{ fixedPrice: fixedPrice ?? undefined }}
      className="w-full"
    >
      <NumberControlled
        name="fixedPrice"
        label={t`Fixed price`}
        inline
        isReadOnly={isDisabled}
        value={current ?? Number.NaN}
        minValue={0}
        formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
        step={INPUT_STEP.money(decimals)}
        onChange={(next) => {
          const nextValue = Number.isNaN(next) ? null : next;
          if (nextValue === current) return;
          fetcher.submit(
            {
              intent: "fixedPrice",
              fixedPrice: nextValue === null ? "" : String(nextValue)
            },
            { method: "post", action }
          );
        }}
      />
    </ValidatedForm>
  );
}
