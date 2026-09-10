import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Heading,
  Input,
  SidebarTrigger,
  useIsMobile
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuSearch, LuTriangleAlert } from "react-icons/lu";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { OperationsList } from "~/components";
import { getActiveJobOperationsByEmployee } from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";

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
  const isMobile = useIsMobile();
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
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-card">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">
            <Trans>Active</Trans>
          </Heading>
        </div>
      </header>

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="w-full p-4 h-[var(--header-height)]">
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4">
            <OperationsList key="active" operations={filteredOperations} />
          </div>
        ) : searchTerm ? (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height)*2)] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuTriangleAlert className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              <Trans>No results exist</Trans>
            </span>
            <Button onClick={() => setSearchTerm("")}>
              <Trans>Clear Search</Trans>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height)*2)] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuTriangleAlert className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              <Trans>No active operations</Trans>
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
