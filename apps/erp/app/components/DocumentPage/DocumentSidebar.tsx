// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { AuditLogFeed } from "~/components/AuditLog";
import { useUser } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";

type DocumentSidebarProps = {
  /** Related documents — usually `RelatedDocumentGroup`s. */
  documents: ReactNode;
  /** The audit-logged entity whose history the Activity tab shows. */
  activity: {
    entityType: string;
    entityId: string;
    /** e.g. the record's `updatedAt`, so a save refreshes the history. */
    refreshKey?: string | null;
  };
};

/**
 * The side panel of a `DocumentPage`: the documents around this one, and
 * everything that has happened to it.
 */
export function DocumentSidebar({ documents, activity }: DocumentSidebarProps) {
  const { company } = useUser();
  const { isGated } = usePlanGate({ feature: "AUDIT_LOG" });
  const [tab, setTab] = useState<"documents" | "activity">("documents");

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as typeof tab)}
      className="flex flex-col h-full min-h-0"
    >
      <div className="flex items-center shrink-0 px-4 pt-5 pb-3">
        <TabsList className="w-full">
          <TabsTrigger value="documents" className="flex-1">
            <Trans>Documents</Trans>
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex-1">
            <Trans>Activity</Trans>
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="documents"
        className="min-h-0 overflow-y-auto px-4 pb-8"
      >
        <div className="flex flex-col gap-6">{documents}</div>
      </TabsContent>
      <TabsContent
        value="activity"
        className="min-h-0 overflow-y-auto px-4 pb-8"
      >
        <AuditLogFeed
          entityType={activity.entityType}
          entityId={activity.entityId}
          companyId={company.id}
          planRestricted={isGated}
          isActive={tab === "activity"}
          refreshKey={activity.refreshKey}
        />
      </TabsContent>
    </Tabs>
  );
}
