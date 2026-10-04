// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack
} from "@carbon/react";
import { equals } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useState } from "react";
import {
  LuCalendarArrowUp,
  LuCalendarDays,
  LuChevronDown,
  LuChevronRight,
  LuEllipsisVertical,
  LuMerge,
  LuRotateCcw,
  LuSplit,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { DatePicker, Hidden, Select, Submit } from "~/components/Form";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import { customerContractScheduleEditValidator } from "../../sales.models";
import ContractInvoiceSplitModal from "./ContractInvoiceSplitModal";
import ContractMoney from "./ContractMoney";
import type {
  ContractInvoiceStatusType,
  ContractLine,
  ContractRouteData
} from "./types";

type ContractInvoicesProps = Pick<
  ContractRouteData,
  | "contract"
  | "lines"
  | "schedule"
  | "credits"
  | "computedSchedule"
  | "residuals"
>;

/** A schedule row as the table shows it, persisted or computed. */
type ScheduleRowView = {
  /** The row's id, or its planned ref while the schedule is computed. */
  ref: string;
  lineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  isAdjustment: boolean;
};

type InvoiceView = {
  /** The invoice's id, or its planned ref while the schedule is computed. */
  ref: string;
  invoiceDate: string;
  status: ContractInvoiceStatusType;
  isEdited: boolean;
  salesInvoiceId: string | null;
  rows: ScheduleRowView[];
  total: number;
};

type Editing =
  | { intent: "move"; invoice: InvoiceView }
  | { intent: "merge"; invoice: InvoiceView }
  | { intent: "moveLine"; row: ScheduleRowView; invoice: InvoiceView }
  | { intent: "split"; row: ScheduleRowView; invoice: InvoiceView };

// An unedited Draft's schedule is computed, not stored (plan decision 2), so
// its invoices and rows have no ids yet. They are addressed by what makes
// them unique within the plan; the first edit materializes the schedule.
const plannedInvoiceRef = (invoiceDate: string) => `planned:${invoiceDate}`;
const plannedRowRef = (
  invoiceDate: string,
  row: Pick<ScheduleRowView, "lineId" | "periodStart" | "isAdjustment">
) =>
  `planned:${invoiceDate}:${row.lineId}:${row.periodStart}${row.isAdjustment ? ":adjustment" : ""}`;

const lineName = (line: ContractLine | undefined, fallback: string) =>
  line ? line.description || line.item?.name || line.itemId : fallback;

/** The invoice schedule: every planned invoice with its lines, editable while
 *  the contract is a Draft — move or merge an invoice, split or move a line. */
const ContractInvoices = ({
  contract,
  lines,
  schedule,
  credits,
  computedSchedule,
  residuals
}: ContractInvoicesProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const resetFetcher = useFetcher<{}>();

  const contractId = contract.id ?? "";
  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(contractId)
  );
  const invoiceLinks = routeData?.invoiceLinks ?? {};
  const creditMemoLinks = routeData?.creditMemoLinks ?? {};

  const currencyCode = contract.currencyCode ?? company.baseCurrencyCode;
  const isDraft = contract.status === "Draft";
  const canEdit = permissions.can("update", "sales");
  const action = path.to.contractSchedule(contractId);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const nameOf = (lineId: string) =>
    lineName(lineById.get(lineId), t`Removed line`);

  const invoices: InvoiceView[] = computedSchedule
    ? computedSchedule.map((invoice) => {
        const rows = invoice.rows.map((row) => ({
          ref: plannedRowRef(invoice.invoiceDate, row),
          lineId: row.lineId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          amount: row.amount,
          isAdjustment: row.isAdjustment
        }));
        return {
          ref:
            invoice.status === "Planned"
              ? plannedInvoiceRef(invoice.invoiceDate)
              : `${invoice.status}:${invoice.invoiceDate}`,
          invoiceDate: invoice.invoiceDate,
          status: invoice.status,
          isEdited: false,
          salesInvoiceId: null,
          rows,
          total: rows.reduce((sum, row) => sum + row.amount, 0)
        };
      })
    : schedule.map((invoice) => {
        const rows = invoice.customerContractInvoiceLine.map((row) => ({
          ref: row.id,
          lineId: row.customerContractLineId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          amount: Number(row.amount),
          isAdjustment: row.isAdjustment
        }));
        return {
          ref: invoice.id,
          invoiceDate: invoice.invoiceDate,
          status: invoice.status,
          isEdited: invoice.isEdited,
          salesInvoiceId: invoice.salesInvoiceId,
          rows,
          total: rows.reduce((sum, row) => sum + row.amount, 0)
        };
      });

  const plannedInvoices = invoices.filter((i) => i.status === "Planned");
  const isEditable = (invoice: InvoiceView) =>
    isDraft && invoice.status === "Planned";

  const residualEntries = Object.entries(residuals).filter(
    ([, residual]) => !equals(residual, 0)
  );
  const hasPersistedSchedule =
    isDraft && !computedSchedule && invoices.length > 0;

  const creditsByMemo = new Map<string, typeof credits>();
  for (const row of credits) {
    const key = row.memoId ?? "";
    creditsByMemo.set(key, [...(creditsByMemo.get(key) ?? []), row]);
  }

  const toggle = (ref: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  const reset = () =>
    resetFetcher.submit({ intent: "reset" }, { method: "post", action });

  const resetButton = (
    <Button
      variant="secondary"
      leftIcon={<LuRotateCcw />}
      isDisabled={!canEdit || resetFetcher.state !== "idle"}
      isLoading={resetFetcher.state !== "idle"}
      onClick={reset}
    >
      <Trans>Reset Schedule</Trans>
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Invoices</Trans>
        </CardTitle>
        {hasPersistedSchedule && residualEntries.length === 0 ? (
          <CardAction>{resetButton}</CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          {isDraft && residualEntries.length > 0 && (
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>The schedule no longer matches the lines</Trans>
              </AlertTitle>
              <AlertDescription>
                <VStack spacing={2}>
                  <ul className="list-disc pl-4">
                    {residualEntries.map(([lineId, residual]) => (
                      <li key={lineId}>
                        {residual > 0 ? (
                          <Trans>
                            {nameOf(lineId)}:{" "}
                            <ContractMoney
                              value={residual}
                              currencyCode={currencyCode}
                            />{" "}
                            not on any invoice
                          </Trans>
                        ) : (
                          <Trans>
                            {nameOf(lineId)}:{" "}
                            <ContractMoney
                              value={-residual}
                              currencyCode={currencyCode}
                            />{" "}
                            more than the line now totals
                          </Trans>
                        )}
                      </li>
                    ))}
                  </ul>
                  <span>
                    <Trans>
                      A line changed after the schedule was edited. Reset the
                      schedule to plan it again from the lines.
                    </Trans>
                  </span>
                  {resetButton}
                </VStack>
              </AlertDescription>
            </Alert>
          )}

          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isDraft && !contract.startDate ? (
                <Trans>
                  Set a start date and add lines to plan the invoices.
                </Trans>
              ) : isDraft ? (
                <Trans>Add lines to plan the invoices.</Trans>
              ) : (
                <Trans>No invoices planned.</Trans>
              )}
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-8" />
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Lines</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Total</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Invoice</Trans>
                  </Th>
                  {isDraft && <Th className="w-10" />}
                </Tr>
              </Thead>
              <Tbody>
                {invoices.map((invoice) => {
                  const isOpen = expanded.has(invoice.ref);
                  const link = invoice.salesInvoiceId
                    ? invoiceLinks[invoice.salesInvoiceId]
                    : undefined;
                  const canMerge = plannedInvoices.length > 1;
                  return (
                    <Fragment key={invoice.ref}>
                      <Tr>
                        <Td>
                          <IconButton
                            aria-label={isOpen ? t`Hide lines` : t`Show lines`}
                            icon={
                              isOpen ? <LuChevronDown /> : <LuChevronRight />
                            }
                            variant="ghost"
                            size="sm"
                            onClick={() => toggle(invoice.ref)}
                          />
                        </Td>
                        <Td>
                          <HStack spacing={2} className="flex-wrap">
                            <span className="whitespace-nowrap">
                              <DateTime
                                value={invoice.invoiceDate}
                                variant="date"
                              />
                            </span>
                            {invoice.isEdited && (
                              <Badge variant="secondary">
                                <Trans>Edited</Trans>
                              </Badge>
                            )}
                          </HStack>
                        </Td>
                        <Td className="tabular-nums">
                          {invoice.rows.length === 1 ? (
                            <Trans>1 line</Trans>
                          ) : (
                            <Trans>{invoice.rows.length} lines</Trans>
                          )}
                        </Td>
                        <Td className="text-right">
                          <ContractMoney
                            value={invoice.total}
                            currencyCode={currencyCode}
                          />
                        </Td>
                        <Td>
                          <ContractInvoiceStatus status={invoice.status} />
                        </Td>
                        <Td>
                          {link ? (
                            <HStack spacing={2}>
                              <Hyperlink
                                to={path.to.salesInvoiceDetails(link.id)}
                              >
                                {link.invoiceId}
                              </Hyperlink>
                              {link.status === "Draft" &&
                                link.automationHoldReason && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="orange">
                                        <Trans>Held</Trans>
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {link.automationHoldReason}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                            </HStack>
                          ) : (
                            "—"
                          )}
                        </Td>
                        {isDraft && (
                          <Td>
                            {isEditable(invoice) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <IconButton
                                    aria-label={t`Invoice actions`}
                                    icon={<LuEllipsisVertical />}
                                    variant="ghost"
                                    size="sm"
                                  />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={!canEdit}
                                    onClick={() =>
                                      setEditing({ intent: "move", invoice })
                                    }
                                  >
                                    <DropdownMenuIcon
                                      icon={<LuCalendarDays />}
                                    />
                                    <Trans>Move Date</Trans>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={!canEdit || !canMerge}
                                    onClick={() =>
                                      setEditing({ intent: "merge", invoice })
                                    }
                                  >
                                    <DropdownMenuIcon icon={<LuMerge />} />
                                    <Trans>Merge Into…</Trans>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </Td>
                        )}
                      </Tr>
                      {isOpen &&
                        invoice.rows.map((row) => (
                          <Tr key={row.ref} className="bg-muted/30">
                            <Td />
                            <Td className="text-muted-foreground">
                              <span className="whitespace-nowrap">
                                <DateTime
                                  value={row.periodStart}
                                  variant="date"
                                />{" "}
                                –{" "}
                                <DateTime
                                  value={row.periodEnd}
                                  variant="date"
                                />
                              </span>
                            </Td>
                            <Td>
                              <HStack spacing={2} className="flex-wrap">
                                <span className="line-clamp-1">
                                  {nameOf(row.lineId)}
                                </span>
                                {row.isAdjustment && (
                                  <Badge variant="orange">
                                    <Trans>Adjustment</Trans>
                                  </Badge>
                                )}
                              </HStack>
                            </Td>
                            <Td className="text-right">
                              <ContractMoney
                                value={row.amount}
                                currencyCode={currencyCode}
                              />
                            </Td>
                            <Td />
                            <Td />
                            {isDraft && (
                              <Td>
                                {isEditable(invoice) && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <IconButton
                                        aria-label={t`Line actions`}
                                        icon={<LuEllipsisVertical />}
                                        variant="ghost"
                                        size="sm"
                                      />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        disabled={!canEdit}
                                        onClick={() =>
                                          setEditing({
                                            intent: "split",
                                            row,
                                            invoice
                                          })
                                        }
                                      >
                                        <DropdownMenuIcon icon={<LuSplit />} />
                                        <Trans>Split</Trans>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={!canEdit}
                                        onClick={() =>
                                          setEditing({
                                            intent: "moveLine",
                                            row,
                                            invoice
                                          })
                                        }
                                      >
                                        <DropdownMenuIcon
                                          icon={<LuCalendarArrowUp />}
                                        />
                                        <Trans>Move To…</Trans>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </Td>
                            )}
                          </Tr>
                        ))}
                    </Fragment>
                  );
                })}
              </Tbody>
            </Table>
          )}

          {computedSchedule && invoices.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                Planned from the lines. Editing an invoice saves the schedule.
              </Trans>
            </p>
          )}

          {creditsByMemo.size > 0 && (
            <VStack spacing={2}>
              {[...creditsByMemo.entries()].map(([memoKey, rows]) => {
                const memo = creditMemoLinks[memoKey];
                return (
                  <VStack key={memoKey} spacing={1}>
                    <span className="text-sm font-medium">
                      {memo ? (
                        <Trans>
                          Credited on{" "}
                          <Hyperlink to={path.to.memo(memo.id)}>
                            {memo.memoId}
                          </Hyperlink>
                        </Trans>
                      ) : (
                        <Trans>Credited</Trans>
                      )}
                    </span>
                    {rows.map((row) => (
                      <HStack
                        key={row.id}
                        className="w-full text-sm text-muted-foreground"
                      >
                        <span className="flex-1 min-w-0 truncate">
                          {nameOf(row.customerContractLineId)}
                        </span>
                        <span className="shrink-0 whitespace-nowrap">
                          <DateTime value={row.periodStart} variant="date" /> –{" "}
                          <DateTime value={row.periodEnd} variant="date" />
                        </span>
                        <span className="shrink-0 w-28 text-right">
                          <ContractMoney
                            value={Number(row.amount)}
                            currencyCode={currencyCode}
                          />
                        </span>
                      </HStack>
                    ))}
                  </VStack>
                );
              })}
            </VStack>
          )}
        </VStack>
      </CardContent>

      {editing?.intent === "split" && (
        <ContractInvoiceSplitModal
          action={action}
          currencyCode={currencyCode}
          row={{
            ref: editing.row.ref,
            lineName: nameOf(editing.row.lineId),
            periodStart: editing.row.periodStart,
            periodEnd: editing.row.periodEnd,
            invoiceDate: editing.invoice.invoiceDate,
            amount: editing.row.amount
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && editing.intent !== "split" && (
        <ScheduleEditModal
          action={action}
          editing={editing}
          plannedInvoices={plannedInvoices}
          currencyCode={currencyCode}
          lineName={
            editing.intent === "moveLine" ? nameOf(editing.row.lineId) : ""
          }
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
};

/** Planned / Invoiced / Billed externally. */
const ContractInvoiceStatus = ({
  status
}: {
  status: ContractInvoiceStatusType;
}) => {
  switch (status) {
    case "Planned":
      return (
        <Status color="gray">
          <Trans>Planned</Trans>
        </Status>
      );
    case "Invoiced":
      return (
        <Status color="green">
          <Trans>Invoiced</Trans>
        </Status>
      );
    case "Billed Externally":
      return (
        <Status color="blue">
          <Trans>Billed Externally</Trans>
        </Status>
      );
    default:
      return null;
  }
};

/** Move an invoice's date, merge it into another, or move one row to a date. */
const ScheduleEditModal = ({
  action,
  editing,
  plannedInvoices,
  currencyCode,
  lineName,
  onClose
}: {
  action: string;
  editing: Exclude<Editing, { intent: "split" }>;
  plannedInvoices: InvoiceView[];
  currencyCode: string;
  lineName: string;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const { formatDate } = useDateFormatter();
  const formatter = useCurrencyFormatter({ currency: currencyCode });

  const { invoice } = editing;
  const defaultValues =
    editing.intent === "move"
      ? {
          intent: "move" as const,
          customerContractInvoiceId: invoice.ref,
          invoiceDate: invoice.invoiceDate
        }
      : editing.intent === "merge"
        ? {
            intent: "merge" as const,
            sourceInvoiceId: invoice.ref,
            targetInvoiceId: ""
          }
        : {
            intent: "moveLine" as const,
            customerContractInvoiceLineId: editing.row.ref,
            invoiceDate: invoice.invoiceDate
          };

  const mergeOptions = plannedInvoices
    .filter((other) => other.ref !== invoice.ref)
    .map((other) => ({
      value: other.ref,
      label: `${formatDate(other.invoiceDate)} · ${formatter.format(other.total)}`
    }));

  const invoiceLabel = formatDate(invoice.invoiceDate);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={customerContractScheduleEditValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={defaultValues}
          onSubmit={onClose}
        >
          <ModalHeader>
            <ModalTitle>
              {editing.intent === "move" ? (
                <Trans>Move the {invoiceLabel} invoice</Trans>
              ) : editing.intent === "merge" ? (
                <Trans>Merge the {invoiceLabel} invoice</Trans>
              ) : (
                <Trans>Move {lineName}</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value={editing.intent} />
            <VStack spacing={4}>
              {editing.intent === "move" && (
                <>
                  <Hidden name="customerContractInvoiceId" />
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Moving onto the date of another planned invoice merges the
                      two.
                    </Trans>
                  </p>
                  <DatePicker name="invoiceDate" label={t`Invoice Date`} />
                </>
              )}
              {editing.intent === "merge" && (
                <>
                  <Hidden name="sourceInvoiceId" />
                  <Select
                    name="targetInvoiceId"
                    label={t`Merge Into`}
                    options={mergeOptions}
                  />
                </>
              )}
              {editing.intent === "moveLine" && (
                <>
                  <Hidden name="customerContractInvoiceLineId" />
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      The line joins the planned invoice on that date, or a new
                      one if there is none.
                    </Trans>
                  </p>
                  <DatePicker name="invoiceDate" label={t`Invoice Date`} />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit isDisabled={!permissions.can("update", "sales")}>
              {editing.intent === "merge" ? (
                <Trans>Merge</Trans>
              ) : (
                <Trans>Move</Trans>
              )}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default ContractInvoices;
