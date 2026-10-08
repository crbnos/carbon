// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Input, useViewport } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuSearch } from "react-icons/lu";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { OperationsList } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { getActiveJobOperationsByEmployee } from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";
import type { Handle } from "~/utils/handle";

export const handle: Handle = {
  realtime: ["jobOperation", "productionEvent"]
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const [operations] = await Promise.all([
    getActiveJobOperationsByEmployee(client, {
      employeeId: userId,
      companyId
    })
  ]);

  return {
    operations: operations?.data?.map(makeDurations) ?? []
  };
}

export default function ActiveRoute() {
  const { t } = useLingui();
  const { operations } = useLoaderData<typeof loader>();
  const [searchTerm, setSearchTerm] = useState("");

  const panelRef = useRef<ImperativePanelHandle>(null);
  const { isPhone: isMobile } = useViewport();
  const { operationId } = useParams();

  useEffect(() => {
    if (isMobile && !!operationId) {
      panelRef.current?.collapse();
    } else {
      panelRef.current?.expand();
    }
  }, [isMobile, operationId]);

  const filteredOperations = useMemo(() => {
    if (!searchTerm) return operations;
    const lowercasedTerm = searchTerm.toLowerCase();
    return operations.filter(
      (operation) =>
        operation.description?.toLowerCase().includes(lowercasedTerm) ||
        operation.jobReadableId?.toLowerCase().includes(lowercasedTerm) ||
        operation.itemReadableId?.toLowerCase().includes(lowercasedTerm) ||
        operation.itemDescription?.toLowerCase().includes(lowercasedTerm)
    );
  }, [operations, searchTerm]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Active</Trans>} />
      <MesQueueHeader title={<Trans>Active</Trans>} />

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="w-full p-4 h-[var(--header-height)] max-md:h-auto max-md:pb-0">
          <div className="relative">
            <div className="flex justify-between gap-4">
              <div className="flex flex-grow">
                <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t`Search`}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </div>
        {filteredOperations.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4 max-md:pt-3">
            <OperationsList key="active" operations={filteredOperations} />
          </div>
        ) : searchTerm ? (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height)*2)]"
            title={<Trans>No results exist</Trans>}
            action={
              <Button onClick={() => setSearchTerm("")}>
                <Trans>Clear Search</Trans>
              </Button>
            }
          />
        ) : (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height)*2)]"
            title={<Trans>No active operations</Trans>}
          />
        )}
      </main>
    </div>
  );
}
