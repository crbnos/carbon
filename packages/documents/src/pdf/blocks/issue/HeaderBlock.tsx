// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Header } from "../../components";
import type { IssueData } from "./types";

/** Company logo + "Issue Report" title + issue id. */
export function HeaderBlock({ data }: { data: IssueData }) {
  return (
    <Header
      company={data.company}
      title="Issue Report"
      documentId={data.nonConformance.nonConformanceId}
      date={data.nonConformance.openDate}
      locale={data.locale}
      options={data.headerOptions}
    />
  );
}
