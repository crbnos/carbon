import {
  Badge,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { toDisplayCredit, toDisplayDebit } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { useUrlParams } from "~/hooks";
import type {
  AccountClass,
  AccountLedgerLine,
  AccountLedgerSummary
} from "~/modules/accounting";
import { path } from "~/utils/path";
import JournalEntryStatus from "../JournalEntries/JournalEntryStatus";

type AccountLedgerDrawerProps = {
  account: {
    id: string;
    number: string | null;
    name: string | null;
    class: AccountClass | null;
  };
  lines: AccountLedgerLine[];
  count: number;
  summary: AccountLedgerSummary;
  startDate: string | null;
  endDate: string | null;
  offset: number;
  limit: number;
  backTo: string;
};

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

const AccountLedgerDrawer = ({
  account,
  lines,
  count,
  summary,
  startDate,
  endDate,
  offset,
  limit,
  backTo
}: AccountLedgerDrawerProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params, setParams] = useUrlParams();

  const onClose = () => {
    const backParams = new URLSearchParams(params);
    backParams.delete("offset");
    const search = backParams.toString();
    navigate(search ? `${backTo}?${search}` : backTo);
  };

  const periodLabel =
    startDate && endDate
      ? `${formatDate(startDate)} – ${formatDate(endDate)}`
      : endDate
        ? t`Through ${formatDate(endDate)}`
        : startDate
          ? t`From ${formatDate(startDate)}`
          : t`All Time`;

  const accountClass = (account.class ?? "Asset") as AccountClass;
  const from = count === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, count);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>{account.name}</DrawerTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{account.number}</span>
            {account.class && (
              <Badge variant="secondary">{account.class}</Badge>
            )}
            <span>{periodLabel}</span>
          </div>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <div className="grid w-full grid-cols-3 divide-x divide-border border-b border-border">
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">
                <Trans>Opening</Trans>
              </p>
              <p className="text-sm font-medium tabular-nums">
                {formatAmount(summary.opening)}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">
                <Trans>Net Change</Trans>
              </p>
              <p className="text-sm font-medium tabular-nums">
                {formatAmount(summary.netChange)}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">
                <Trans>Closing</Trans>
              </p>
              <p className="text-sm font-medium tabular-nums">
                {formatAmount(summary.closing)}
              </p>
            </div>
          </div>
          {lines.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Trans>No transactions in this period</Trans>
            </div>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="px-4">
                    <Trans>Date</Trans>
                  </Th>
                  <Th className="px-4">
                    <Trans>Entry</Trans>
                  </Th>
                  <Th className="px-4 w-full">
                    <Trans>Description</Trans>
                  </Th>
                  <Th className="px-4 text-right">
                    <Trans>Debit</Trans>
                  </Th>
                  <Th className="px-4 text-right">
                    <Trans>Credit</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {lines.map((line) => {
                  const debit = toDisplayDebit(line.amount, accountClass);
                  const credit = toDisplayCredit(line.amount, accountClass);
                  return (
                    <Tr key={line.id} className="hover:bg-muted/50">
                      <Td className="px-4 whitespace-nowrap text-muted-foreground">
                        {formatDate(line.postingDate)}
                      </Td>
                      <Td className="px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Link
                            to={path.to.journalEntryDetails(line.journalId)}
                            prefetch="intent"
                            className="font-mono text-xs text-foreground hover:underline"
                          >
                            {line.journalEntryId}
                          </Link>
                          {line.status !== "Posted" && (
                            <JournalEntryStatus status={line.status} />
                          )}
                        </div>
                      </Td>
                      <Td className="px-4">
                        <p className="line-clamp-1">
                          {line.description ?? line.journalDescription ?? "–"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {line.sourceType}
                        </p>
                      </Td>
                      <Td className="px-4 text-right tabular-nums">
                        {debit !== 0 ? formatAmount(debit) : ""}
                      </Td>
                      <Td className="px-4 text-right tabular-nums">
                        {credit !== 0 ? formatAmount(credit) : ""}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
          {count > limit && (
            <div className="flex w-full items-center justify-between border-t border-border px-4 py-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                <Trans>
                  {from}–{to} of {count}
                </Trans>
              </p>
              <div className="flex items-center gap-1">
                <IconButton
                  aria-label={t`Previous page`}
                  variant="ghost"
                  size="sm"
                  icon={<LuChevronLeft />}
                  isDisabled={offset === 0}
                  onClick={() =>
                    setParams({
                      offset:
                        offset - limit > 0 ? String(offset - limit) : undefined
                    })
                  }
                />
                <IconButton
                  aria-label={t`Next page`}
                  variant="ghost"
                  size="sm"
                  icon={<LuChevronRight />}
                  isDisabled={offset + limit >= count}
                  onClick={() => setParams({ offset: String(offset + limit) })}
                />
              </div>
            </div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

export default AccountLedgerDrawer;
