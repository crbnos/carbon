import { Status } from "@carbon/react";
import { JOURNAL_ENTRY_STATUS_COLOR_MAP } from "@carbon/utils";
import type { journalEntryStatuses } from "../../accounting.models";

type JournalEntryStatusProps = {
  status?: (typeof journalEntryStatuses)[number] | null;
};

const JournalEntryStatus = ({ status }: JournalEntryStatusProps) => {
  if (!status) return null;
  const color = JOURNAL_ENTRY_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default JournalEntryStatus;
