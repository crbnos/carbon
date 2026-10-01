// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { View } from "@react-pdf/renderer";
import { Header } from "../../components";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";

/** Company logo + "Job Traveler" title + job id (and SO sub-id). */
export function HeaderBlock({ data }: { data: JobTravelerData }) {
  const { company, job, locale, headerOptions } = data;
  return (
    <View style={tw("mb-6")}>
      <Header
        company={company}
        title="Job Traveler"
        documentId={job.jobId}
        documentSubId={
          job.salesOrderReadableId
            ? `SO# ${job.salesOrderReadableId}`
            : undefined
        }
        date={job.startDate}
        locale={locale}
        options={headerOptions}
      />
    </View>
  );
}
