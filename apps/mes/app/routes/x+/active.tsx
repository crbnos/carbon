import { requirePermissions } from "@carbon/auth/auth.server";
import { Heading, Input, ResizablePanel, Separator, Tabs } from "@carbon/react";
import { json, Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { useMemo, useState } from "react";

import { LuSearch } from "react-icons/lu";
import { OperationsList } from "~/components";
import { getActiveJobOperationsByEmployee } from "~/services/jobs.service";
import { makeDurations } from "~/utils/jobs";

import { defaultLayout } from "~/utils/layout";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const [operations] = await Promise.all([
    getActiveJobOperationsByEmployee(client, {
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
    <>
      <ResizablePanel defaultSize={defaultLayout[1]} minSize={30}>
        <Tabs defaultValue="current">
          <div className="flex items-center px-4 py-2 h-[52px] bg-background">
            <Heading size="h2">Active</Heading>
          </div>
          <Separator />
          <div className="p-4">
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

          <div className="p-4 pt-0">
            <OperationsList
              key="active"
              emptyMessage="No active jobs"
              operations={filteredOperations}
            />
          </div>
        </Tabs>
      </ResizablePanel>
      <Outlet />
    </>
  );
}
