// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuChevronRight } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Assignee, Empty, Hyperlink } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import type { getServiceJobsForReturnLine } from "~/modules/sales/sales.service";
import CoverageBadge from "~/modules/service/ui/ServiceJob/CoverageBadge";
import ServiceJobStatus from "~/modules/service/ui/ServiceJob/ServiceJobStatus";
import { path } from "~/utils/path";

export type ReturnLineServiceJob = NonNullable<
  Awaited<ReturnType<typeof getServiceJobsForReturnLine>>["data"]
>[number];

/**
 * The service jobs of a Return for Service or Return for Warranty line, as a
 * sales order line lists its jobs. The receipt opens the job, so the card
 * has no action of its own.
 */
export default function SalesReturnOrderLineServiceJobs({
  serviceJobs
}: {
  serviceJobs: ReturnLineServiceJob[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Service Jobs</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {serviceJobs.length > 0 ? (
          <div className="border rounded-lg">
            {serviceJobs.map((job, index) => (
              <div
                key={job.id}
                className={cn(
                  "border-b p-6",
                  index === serviceJobs.length - 1 && "border-b-0"
                )}
              >
                <ServiceJobItem job={job} />
              </div>
            ))}
          </div>
        ) : (
          <Empty className="pb-12">
            <p className="text-sm text-muted-foreground">
              <Trans>The service job opens when the receipt is posted.</Trans>
            </p>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceJobItem({ job }: { job: ReturnLineServiceJob }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const formatQuantity = useQuantityFormatter();
  const hours = (job.serviceJobTime ?? []).reduce(
    (sum, entry) => sum + Number(entry.hours ?? 0),
    0
  );

  return (
    <HStack className="w-full justify-between">
      <HStack>
        <Hyperlink to={path.to.serviceJob(job.id)}>
          <div className="flex flex-col gap-0">
            {job.serviceJobId}
            <HStack spacing={1}>
              <ServiceJobStatus status={job.status} />
            </HStack>
          </div>
        </Hyperlink>
        <Assignee
          id={job.id}
          table="serviceJob"
          size="sm"
          value={job.assignee ?? ""}
          isReadOnly
        />
      </HStack>
      <HStack className="justify-between items-center" spacing={8}>
        <div>
          <label className="text-xs text-muted-foreground">
            <Trans>Coverage</Trans>
          </label>
          <div className="text-sm">
            <CoverageBadge coverage={job.coverage} />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            <Trans>Hours</Trans>
          </label>
          <p className="text-sm tabular-nums">{formatQuantity(hours)}</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            <Trans>Repairable</Trans>
          </label>
          <p className="text-sm">
            {job.repairable === true ? (
              <Trans>Yes</Trans>
            ) : job.repairable === false ? (
              <Trans>No</Trans>
            ) : (
              "—"
            )}
          </p>
        </div>
      </HStack>
      <IconButton
        aria-label={t`Open service job`}
        icon={<LuChevronRight />}
        variant="ghost"
        onClick={() => navigate(path.to.serviceJob(job.id))}
      />
    </HStack>
  );
}
