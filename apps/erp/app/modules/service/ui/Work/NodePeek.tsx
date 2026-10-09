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
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuPackageMinus,
  LuReceipt,
  LuShieldQuestion,
  LuTimer,
  LuTriangleAlert
} from "react-icons/lu";
import { DateTime } from "~/components";
import { Hidden, Select, Submit, TextArea } from "~/components/Form";
import { useCurrencyFormatter, useQuantityFormatter } from "~/hooks";
import { IssueMaterialModal } from "~/modules/projects/ui/Element/IssueMaterialModal";
import { LogTimeModal } from "~/modules/projects/ui/Element/LogTimeModal";
import { ElementTypeIcon } from "~/modules/projects/ui/Elements/ElementTypeIcon";
import { useItems } from "~/stores";
import type { ServiceCoverage } from "../../service.models";
import {
  canOverrideCoverage,
  coverageOverrideValidator,
  serviceCoverages
} from "../../service.models";
import type { ServiceCharge, ServiceNode } from "../../types";
import AddExpenseModal from "./AddExpenseModal";
import { CoveragePill, useCoverageLabels } from "./CoveragePill";

type OpenModal = "time" | "part" | "expense" | null;

export type NodePeekProps = ServiceNode & {
  projectId: string;
  /** The order's charge route. */
  chargeAction: string;
  laborCategories: { id: string; name: string }[];
  defaultLaborCategoryId: string | null;
  /** The signed-in user's van: where a part is issued from first. */
  van: { storageUnitId: string; locationId: string } | null;
  /** The visit the charges belong to, when there is one. */
  serviceVisitId?: string | null;
  canCharge: boolean;
  canIssue: boolean;
  onClose: () => void;
};

/**
 * One node of the work: what it is linked to, its charges with who pays for
 * each, and the three ways to charge it (time, a part, an expense). A charge
 * that is not billed can move to another coverage, with a reason.
 */
export default function NodePeek({
  element,
  charges,
  lastServiceDate,
  projectId,
  chargeAction,
  laborCategories,
  defaultLaborCategoryId,
  van,
  serviceVisitId,
  canCharge,
  canIssue,
  onClose
}: NodePeekProps) {
  const { t } = useLingui();
  const [items] = useItems();
  const formatCurrency = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const [modal, setModal] = useState<OpenModal>(null);
  const [overriding, setOverriding] = useState<ServiceCharge | null>(null);

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

  const node = {
    id: element.id,
    readableId: element.readableId,
    name: element.name,
    itemId: element.itemId
  };
  const hiddenFields = (intent: string) => ({
    intent,
    ...(serviceVisitId ? { serviceVisitId } : {})
  });

  return (
    <>
      <Drawer open onOpenChange={(open) => !open && onClose()}>
        <DrawerContent size="lg">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 min-w-0">
              <ElementTypeIcon type={element.type} />
              <span className="shrink-0 whitespace-nowrap font-mono text-sm text-muted-foreground">
                {element.readableId}
              </span>
              <span className="truncate">{element.name}</span>
            </DrawerTitle>
            {(element.item || element.trackedEntity) && (
              <DrawerDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {element.item && (
                  <span>
                    {[element.item.readableIdWithRevision, element.item.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                {element.trackedEntity && (
                  <span className="whitespace-nowrap">
                    {element.trackedEntity.readableId}
                  </span>
                )}
                <span>
                  {lastServiceDate ? (
                    <Trans>
                      Last service{" "}
                      <DateTime value={lastServiceDate} variant="date" />
                    </Trans>
                  ) : (
                    <Trans>Never serviced</Trans>
                  )}
                </span>
              </DrawerDescription>
            )}
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={8}>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  leftIcon={<LuTimer />}
                  isDisabled={!canCharge || laborCategories.length === 0}
                  onClick={() => setModal("time")}
                >
                  <Trans>Log Time</Trans>
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<LuPackageMinus />}
                  isDisabled={!canCharge || !canIssue}
                  onClick={() => setModal("part")}
                >
                  <Trans>Issue Part</Trans>
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<LuReceipt />}
                  isDisabled={!canCharge}
                  onClick={() => setModal("expense")}
                >
                  <Trans>Add Expense</Trans>
                </Button>
              </div>

              <div className="flex w-full flex-col gap-2">
                <h3 className="text-sm font-medium">
                  <Trans>Charges</Trans>
                </h3>
                {charges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    <Trans>Nothing has been charged to this node yet.</Trans>
                  </p>
                ) : (
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>
                          <Trans>Date</Trans>
                        </Th>
                        <Th className="w-full">
                          <Trans>Charge</Trans>
                        </Th>
                        <Th className="text-right">
                          <Trans>Quantity</Trans>
                        </Th>
                        <Th className="text-right">
                          <Trans>Cost</Trans>
                        </Th>
                        <Th>
                          <Trans>Coverage</Trans>
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
                        return (
                          <Tr key={charge.id}>
                            <Td className="whitespace-nowrap">
                              <DateTime
                                value={charge.postingDate}
                                variant="date"
                              />
                            </Td>
                            <Td>
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">
                                  {costTypeLabels[charge.costType] ??
                                    charge.costType}
                                  {charge.itemId &&
                                    ` · ${itemLabel.get(charge.itemId) ?? ""}`}
                                </span>
                                {charge.reversalOfId && (
                                  <span className="text-xs text-muted-foreground">
                                    <Trans>Reversal</Trans>
                                  </span>
                                )}
                                {billable?.status === "Billed" && (
                                  <span className="text-xs text-muted-foreground">
                                    <Trans>Billed</Trans>
                                  </span>
                                )}
                              </div>
                            </Td>
                            <Td className="text-right tabular-nums whitespace-nowrap">
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
                              <Button
                                variant="ghost"
                                size="sm"
                                leftIcon={<LuShieldQuestion />}
                                isDisabled={!canOverride}
                                onClick={() => setOverriding(charge)}
                              >
                                <Trans>Override</Trans>
                              </Button>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                )}
              </div>
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {modal === "time" && (
        <LogTimeModal
          projectId={projectId}
          element={node}
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
          element={node}
          defaultLocationId={van?.locationId}
          defaultStorageUnitId={van?.storageUnitId}
          action={chargeAction}
          hiddenFields={hiddenFields("part")}
          variant="service"
          onClose={() => setModal(null)}
        />
      )}
      {modal === "expense" && (
        <AddExpenseModal
          action={chargeAction}
          node={node}
          serviceVisitId={serviceVisitId}
          onClose={() => setModal(null)}
        />
      )}
      {overriding && (
        <OverrideCoverageModal
          action={chargeAction}
          charge={overriding}
          onClose={() => setOverriding(null)}
        />
      )}
    </>
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
              <Select name="coverage" label={t`Coverage`} options={options} />
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
