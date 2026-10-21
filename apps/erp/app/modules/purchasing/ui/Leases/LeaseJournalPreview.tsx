// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { JournalPreview } from "~/components";
import type { LeaseJournalPreviewRow } from "./utils";

/** The journal a lifecycle action would post, before the user confirms.
 *  Rows with nothing on either side are left out. */
const LeaseJournalPreview = ({
  rows,
  currencyCode
}: {
  rows: LeaseJournalPreviewRow[];
  currencyCode: string | null | undefined;
}) => <JournalPreview rows={rows} currencyCode={currencyCode} />;

export default LeaseJournalPreview;
