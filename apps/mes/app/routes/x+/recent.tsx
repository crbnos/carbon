import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Heading,
  Input,
  SidebarTrigger,
  useIsMobile,
} from "@carbon/react";
import { json, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuAlertTriangle, LuSearch } from "react-icons/lu";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { OperationsList } from "~/components";
import { getRecentJobOperationsByEmployee } from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const [operations] = await Promise.all([
    getRecentJobOperationsByEmployee(client, {
      employeeId: userId,
      companyId,
    }),
  ]);

  return json({
    operations: operations?.data?.map(makeDurations) ?? [],
  });
}

export default function ActiveRoute() {
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
        operation.itemReadableId?.toLowerCase().includes(lowercasedTerm)
    );
  }, [operations, searchTerm]);

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">Recent</Heading>
        </div>
      </header>

      <main className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="w-full p-4 h-[var(--header-height)]">
          <div className="relative">
            <div className="flex justify-between gap-4">
              <div className="flex flex-grow">
                <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search"
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </div>
        {filteredOperations.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,420px),1fr))] p-4 gap-4">
            <OperationsList key="active" operations={filteredOperations} />
          </div>
        ) : searchTerm ? (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height)*2)] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuAlertTriangle className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              No results exist
            </span>
            <Button onClick={() => setSearchTerm("")}>Clear Search</Button>
          </div>
        ) : (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height)*2)] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuAlertTriangle className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              No recent operations
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
