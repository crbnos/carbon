import { Status } from "@carbon/react";
import { JOURNAL_ENTRY_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { journalEntryStatuses } from "../../accounting.models";

type JournalEntryStatusProps = {
  status?: (typeof journalEntryStatuses)[number] | null;
};

const JournalEntryStatus = ({ status }: JournalEntryStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;
  const color = JOURNAL_ENTRY_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const labels: Record<(typeof journalEntryStatuses)[number], string> = {
    Draft: t`Draft`,
    Posted: t`Posted`,
    Reversed: t`Reversed`
  };

  return <Status color={color}>{labels[status] ?? status}</Status>;
};

export default JournalEntryStatus;
