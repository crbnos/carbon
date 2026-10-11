// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, cn, HStack, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuBookOpen,
  LuCalendarRange,
  LuFileText,
  LuHistory,
  LuReceipt,
  LuWallet
} from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { useDateFormatter, useOptimisticLocation, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { LeaseRouteData } from "./types";

/** The lease's sections, then the documents that name it: its purchase
 *  invoices and its journals. */
export default function LeaseExplorer() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  const { formatDate } = useDateFormatter();
  if (!routeData) return null;

  const { payments, schedule, events, purchaseInvoices, journals } = routeData;

  return (
    <VStack
      className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
      spacing={0}
    >
      <ExplorerItem
        icon={<LuFileText />}
        label={t`Details`}
        to={path.to.leaseDetails(id)}
      />
      <ExplorerItem
        icon={<LuWallet />}
        label={t`Payments`}
        to={`${path.to.leaseDetails(id)}#payments`}
        count={payments.length}
        matchPath={false}
      />
      <ExplorerItem
        icon={<LuCalendarRange />}
        label={t`Schedule`}
        to={path.to.leaseSchedule(id)}
        count={schedule.length}
      />
      <ExplorerItem
        icon={<LuHistory />}
        label={t`Events`}
        to={path.to.leaseEvents(id)}
        count={events.length}
      />

      <div className="w-full px-2 pt-4 pb-1">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Purchase Invoices</Trans>
        </h3>
      </div>
      {purchaseInvoices.length === 0 ? (
        <p className="w-full px-2 pb-2 text-xs text-muted-foreground">
          <Trans>None yet</Trans>
        </p>
      ) : (
        purchaseInvoices.map((invoice) => (
          <ExplorerItem
            key={invoice.id}
            icon={<LuReceipt />}
            label={invoice.invoiceId ?? t`Invoice`}
            detail={invoice.status ?? undefined}
            to={path.to.purchaseInvoiceDetails(invoice.id)}
          />
        ))
      )}

      <div className="w-full px-2 pt-4 pb-1">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          <Trans>Journals</Trans>
        </h3>
      </div>
      {journals.length === 0 ? (
        <p className="w-full px-2 pb-2 text-xs text-muted-foreground">
          <Trans>None yet</Trans>
        </p>
      ) : (
        journals.map((journal) => (
          <ExplorerItem
            key={journal.id}
            icon={<LuBookOpen />}
            label={journal.journalEntryId ?? t`Journal`}
            detail={formatDate(journal.postingDate) || undefined}
            to={path.to.journalEntryDetails(journal.id)}
          />
        ))
      )}
    </VStack>
  );
}

function ExplorerItem({
  icon,
  label,
  detail,
  to,
  count,
  matchPath = true
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  to: string;
  count?: number;
  matchPath?: boolean;
}) {
  const location = useOptimisticLocation();
  const navigate = useNavigate();
  const isSelected = matchPath && location.pathname === to;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center border-b hover:bg-accent/30 cursor-pointer",
        isSelected && "bg-accent/60 hover:bg-accent/50"
      )}
      onClick={() => {
        if (!isSelected) navigate(to);
      }}
    >
      <HStack spacing={2} className="flex-grow min-w-0">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <VStack spacing={0} className="min-w-0 flex-1">
          <span className="font-medium line-clamp-1 w-full whitespace-nowrap">
            {label}
          </span>
          {detail && (
            <span className="text-muted-foreground text-xs truncate w-full">
              {detail}
            </span>
          )}
        </VStack>
      </HStack>
      {count !== undefined && (
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {count}
        </Badge>
      )}
    </HStack>
  );
}
