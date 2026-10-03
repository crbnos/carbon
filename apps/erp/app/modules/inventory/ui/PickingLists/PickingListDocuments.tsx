// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuCirclePlay } from "react-icons/lu";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocument,
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { usePermissions, useRouteData } from "~/hooks";
import type { getPickingListRelatedItems } from "~/modules/inventory";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

type RelatedItems = Awaited<ReturnType<typeof getPickingListRelatedItems>>;

/**
 * The documents around a picking list: the jobs it picks material for. A
 * picking list has no file of its own to print.
 */
const PickingListDocuments = () => {
  const { t } = useLingui();
  const { pickingListId } = useParams();
  if (!pickingListId) throw new Error("pickingListId not found");

  const permissions = usePermissions();
  const [items] = useItems();
  const routeData = useRouteData<{
    relatedItems?: Promise<RelatedItems>;
  }>(path.to.pickingList(pickingListId));

  if (!permissions.can("view", "production")) {
    return <Empty className="py-12" />;
  }

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(resolved) => {
          const jobs = resolved?.jobs ?? [];
          if (jobs.length === 0) return <Empty className="py-12" />;

          return (
            <RelatedDocumentGroup>
              {jobs.map((job) => {
                const itemReadableId = items.find(
                  (i) => i.id === job.itemId
                )?.readableIdWithRevision;
                return (
                  <RelatedDocument
                    key={job.id}
                    to={path.to.job(job.id)}
                    icon={<LuCirclePlay />}
                    title={job.jobId}
                    description={
                      itemReadableId ? t`Job · ${itemReadableId}` : t`Job`
                    }
                    status={<JobStatus status={job.status} />}
                  />
                );
              })}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default PickingListDocuments;
