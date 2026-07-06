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
