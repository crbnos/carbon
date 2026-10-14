// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import {
  formatPeriodLabel,
  PERIOD_CLOSE_STATUS_COLOR_MAP
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuBookOpen, LuCalendarCheck } from "react-icons/lu";
import { RelatedDocument } from "~/components/DocumentPage";
import { path } from "~/utils/path";
import JournalEntryStatus from "./JournalEntries/JournalEntryStatus";

/** What `getPeriodRunRelatedItems` streams to a run's Documents panel. */
export type PeriodRunRelatedItems = {
  accountingPeriod: {
    id: string;
    startDate: string;
    endDate: string;
    closeStatus: Database["public"]["Enums"]["periodCloseStatus"];
  } | null;
  journals: {
    id: string;
    journalEntryId: string;
    status: Database["public"]["Enums"]["journalEntryStatus"];
  }[];
};

/** The accounting period a run's period end falls in. */
export function AccountingPeriodDocument({
  period
}: {
  period: NonNullable<PeriodRunRelatedItems["accountingPeriod"]>;
}) {
  const { t } = useLingui();
  const closeStatusLabels: Record<typeof period.closeStatus, ReactNode> = {
    Open: <Trans>Open</Trans>,
    Locked: <Trans>Locked</Trans>,
    Closed: <Trans>Closed</Trans>
  };

  return (
    <RelatedDocument
      to={path.to.accountingPeriodClose(period.id)}
      icon={<LuCalendarCheck />}
      title={formatPeriodLabel(period.startDate)}
      description={t`Accounting Period`}
      status={
        <Status
          color={PERIOD_CLOSE_STATUS_COLOR_MAP[period.closeStatus] ?? "gray"}
        >
          {closeStatusLabels[period.closeStatus] ?? period.closeStatus}
        </Status>
      }
    />
  );
}

/** A journal entry a run posted. */
export function JournalEntryDocument({
  journal,
  description
}: {
  journal: PeriodRunRelatedItems["journals"][number];
  description?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <RelatedDocument
      to={path.to.journalEntry(journal.id)}
      icon={<LuBookOpen />}
      title={journal.journalEntryId}
      description={description ?? t`Journal Entry`}
      status={<JournalEntryStatus status={journal.status} />}
    />
  );
}
