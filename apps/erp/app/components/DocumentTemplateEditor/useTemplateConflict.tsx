// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useChangedRows } from "@carbon/query";
import { useState } from "react";
import { useUser } from "~/hooks";

/**
 * Watches the company's `documentTemplate` rows over realtime and flags when
 * *another* user saves the template currently open in the editor. Own writes
 * (matched by `updatedBy`) are ignored, so saving here — or editing in another
 * of your own tabs — never raises a false conflict.
 *
 * The editor does not auto-revalidate on the event (that would silently discard
 * in-progress edits); it surfaces a banner letting the user refresh or keep
 * their version.
 */
export function useTemplateConflict(documentType: string) {
  const { id: userId, company } = useUser();
  const [conflict, setConflict] = useState(false);

  useChangedRows<{ id: string; documentType?: string; updatedBy?: string }>({
    companyId: company.id,
    table: "documentTemplate",
    columns: "id, documentType, updatedBy",
    onChange: ({ rows }) => {
      // Only this template, and only someone else's write.
      const theirs = rows.some(
        (row) =>
          row.documentType === documentType &&
          row.updatedBy &&
          row.updatedBy !== userId
      );
      if (theirs) setConflict(true);
    }
  });

  return { conflict, dismiss: () => setConflict(false) };
}
