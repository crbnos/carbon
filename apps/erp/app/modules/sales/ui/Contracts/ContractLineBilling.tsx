// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  LabelWithHelp,
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
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { BILLABLE_REASON_FUNDING_LIMIT, round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuEllipsisVertical,
  LuFileText,
  LuPencil,
  LuRefreshCw
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { Hidden, Submit } from "~/components/Form";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import type { ProjectCostType } from "~/modules/projects/projects.models";
import { useGovernmentContracting } from "~/modules/projects/ui/useGovernmentContracting";
import { BillableItemStatus } from "~/modules/service/ui/ServiceStatus";
import { path } from "~/utils/path";
import { contractLineFundingValidator } from "../../sales.models";
import ContractFundingActions, {
  type ContractFundingAction
} from "./ContractFundingActions";
import ContractLaborRates, {
  type ContractLaborRate
} from "./ContractLaborRates";
import {
  ContractLineBillingFields,
  useBillingMethodLabels
} from "./ContractLineBillingFields";
import ContractMoney from "./ContractMoney";
import ContractRateCeilings, {
  type CeilingPool,
  type ContractRateCeiling
} from "./ContractRateCeilings.ee";
import FundingBar, { type ContractLineFundingPosition } from "./FundingBar";
import type { ContractLine } from "./types";

export type ContractLineBillableItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  status: "Unbilled" | "On Hold" | "Billed" | "Written Off";
  statusReason: string | null;
  ledger: { postingDate: string; costType: ProjectCostType } | null;
};

/**
 * The billing of one Time & Materials or Cost Plus line: its funding, its
 * bill rates (Time & Materials) and its billable items, with Generate
 * Billable Items for work posted before the line or by the job SQL (the one
 * primary action; Line Details and Edit Funding are in the ⋯ menu). Items
 * are reviewed (hold, release, write off, price) in Projects → Approvals.
 */
export default function ContractLineBilling({
  contractId,
  line,
  currencyCode,
  funding,
  laborRates,
  items,
  fundingActions,
  fundedByActions,
  rateCeilings,
  ceilingPools,
  canUpdate
}: {
  contractId: string;
  line: ContractLine;
  currencyCode: string;
  funding: ContractLineFundingPosition;
  laborRates: ContractLaborRate[];
  items: ContractLineBillableItem[];
  /** The line's funding actions (contract modifications), by funded date. */
  fundingActions: ContractFundingAction[];
  /** DCAA mode: the funding actions own the funded cost and amount. */
  fundedByActions: boolean;
  /** Cost Plus: the indirect rate ceilings of the line (Phase 5b). */
  rateCeilings: ContractRateCeiling[];
  /** Cost Plus: the active pools that apply to projects. */
  ceilingPools: CeilingPool[];
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const billingLabels = useBillingMethodLabels();
  const generateFetcher = useFetcher();
  const [editingFunding, setEditingFunding] = useState(false);
  const isGovernment = useGovernmentContracting();
  const isTimeAndMaterials = line.billingMethod === "Time & Materials";
  const title = line.description || line.item?.name || line.itemId;

  return (
    <VStack spacing={4} className="w-full p-2">
      <HStack className="w-full justify-between">
        <VStack spacing={0} className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <span className="text-sm text-muted-foreground">
            {billingLabels[line.billingMethod]}
          </span>
        </VStack>
        <HStack className="shrink-0">
          <generateFetcher.Form
            method="post"
            action={path.to.contractLineGenerate(contractId, line.id)}
          >
            <Button
              type="submit"
              leftIcon={<LuRefreshCw />}
              isLoading={generateFetcher.state !== "idle"}
              isDisabled={!canUpdate || generateFetcher.state !== "idle"}
            >
              <Trans>Generate Billable Items</Trans>
            </Button>
          </generateFetcher.Form>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={path.to.contractLine(contractId, line.id)}>
                  <DropdownMenuIcon icon={<LuFileText />} />
                  <Trans>Line Details</Trans>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => setEditingFunding(true)}
              >
                <DropdownMenuIcon icon={<LuPencil />} />
                <Trans>Edit Funding</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </HStack>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Funding</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FundingBar
            position={funding}
            terms={line}
            currencyCode={currencyCode}
          />
        </CardContent>
      </Card>

      {/* Layer 5: funding actions are government contracting. */}
      {(isGovernment || fundedByActions || fundingActions.length > 0) && (
        <ContractFundingActions
          lineId={line.id}
          actions={fundingActions}
          currencyCode={currencyCode}
          action={path.to.contractLineFundingActions(contractId, line.id)}
          isDisabled={!canUpdate}
        />
      )}

      {isTimeAndMaterials && (
        <ContractLaborRates
          lineId={line.id}
          rates={laborRates}
          currencyCode={currencyCode}
          action={path.to.contractLineLaborRates(contractId, line.id)}
          isDisabled={!canUpdate}
        />
      )}

      {line.billingMethod === "Cost Plus" && (
        <ContractRateCeilings
          lineId={line.id}
          ceilings={rateCeilings}
          pools={ceilingPools}
          action={path.to.contractLineLaborRates(contractId, line.id)}
          isDisabled={!canUpdate}
        />
      )}

      <ContractLineBillableItems items={items} currencyCode={currencyCode} />

      {editingFunding && (
        <EditFundingModal
          action={path.to.contractLineFunding(contractId, line.id)}
          line={line}
          currencyCode={currencyCode}
          fundedByActions={fundedByActions}
          title={t`Edit Funding`}
          onClose={() => setEditingFunding(false)}
        />
      )}
    </VStack>
  );
}

/** The line's billable items, oldest first: what was posted, its price and
 *  where it stands. A "Funding limit" hold is amber. */
function ContractLineBillableItems({
  items,
  currencyCode
}: {
  items: ContractLineBillableItem[];
  currencyCode: string;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();
  const costTypeLabels: Record<ProjectCostType, string> = {
    Material: t`Material`,
    Labor: t`Labor`,
    Machine: t`Machine`,
    Overhead: t`Overhead`,
    "Outside Processing": t`Outside Processing`,
    "Purchased Service": t`Purchased Service`,
    "Other Direct": t`Other Direct`,
    "Material Variance": t`Material Variance`,
    "Payback Variance": t`Payback Variance`,
    Burden: t`Burden`
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <LabelWithHelp termId="billable-item" variant="inline">
            <Trans>Billable Items</Trans>
          </LabelWithHelp>
        </CardTitle>
        <CardDescription>
          <Trans>
            Hold, release, write off or reprice items in{" "}
            <Link
              to={`${path.to.projectTimesheetApprovals}?tab=billing`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Projects → Approvals
            </Link>
            , on the Billing tab.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No billable items yet. Work charged to the billing element and the
              elements below it shows here.
            </Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Posted</Trans>
                </Th>
                <Th>
                  <Trans>Cost Type</Trans>
                </Th>
                <Th className="w-full">
                  <Trans>Description</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Quantity</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Unit Price</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <Td className="whitespace-nowrap tabular-nums">
                    {item.ledger ? formatDate(item.ledger.postingDate) : "—"}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {item.ledger
                      ? (costTypeLabels[item.ledger.costType] ??
                        item.ledger.costType)
                      : "—"}
                  </Td>
                  <Td>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{item.description}</span>
                      {item.statusReason && (
                        <span
                          className={cn(
                            "truncate text-xs",
                            item.statusReason === BILLABLE_REASON_FUNDING_LIMIT
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {item.statusReason}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">
                    {formatQuantity(Number(item.quantity))}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ContractMoney
                      value={item.unitPrice}
                      currencyCode={currencyCode}
                      rate
                    />
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <ContractMoney
                      value={item.amount}
                      currencyCode={currencyCode}
                    />
                  </Td>
                  <Td>
                    <BillableItemStatus status={item.status} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Edit Funding: a funding modification on a Draft or Active contract. */
function EditFundingModal({
  action,
  line,
  currencyCode,
  fundedByActions,
  title,
  onClose
}: {
  action: string;
  line: ContractLine;
  currencyCode: string;
  fundedByActions: boolean;
  title: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save funding`)
  });
  const amount = (value: number | null) =>
    value === null ? undefined : Number(value);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent size="large">
        <ValidatedForm
          validator={contractLineFundingValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            id: line.id,
            fundedAmount: amount(line.fundedAmount),
            fundedCost: amount(line.fundedCost),
            ceilingAmount: amount(line.ceilingAmount),
            noticePercent: round(Number(line.noticePercent) * 100),
            noticeWindowDays: Number(line.noticeWindowDays)
          }}
        >
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
            <ModalDescription>
              <Trans>
                A funding change applies from the next billing run. Billing
                stops at the funded amount.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
              <FundingFields
                line={line}
                currencyCode={currencyCode}
                fundedByActions={fundedByActions}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/** The funding fields only: the shared billing fields without the element
 *  and the percent, which change through the line or Amend. */
function FundingFields({
  line,
  currencyCode,
  fundedByActions
}: {
  line: ContractLine;
  currencyCode: string;
  fundedByActions: boolean;
}) {
  return (
    <ContractLineBillingFields
      billingMethod={line.billingMethod}
      projectId={line.projectId ?? ""}
      currencyCode={currencyCode}
      fundingOnly
      fundedByActions={fundedByActions}
    />
  );
}
