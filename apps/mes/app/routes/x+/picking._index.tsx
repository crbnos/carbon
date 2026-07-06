import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  SidebarTrigger,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { PickingListStatus } from "~/components/PickingListStatus";
import { userContext } from "~/context";
import { getAssignedPickingLists } from "~/services/picking.service";
import { path } from "~/utils/path";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;

  const pickingLists = await getAssignedPickingLists(client, effectiveUserId);

  return {
    pickingLists: pickingLists.data ?? []
  };
}

export default function PickingIndexRoute() {
  const { pickingLists } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">
            <Trans>Picking</Trans>
          </Heading>
        </div>
      </header>

      <main className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        {pickingLists.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4">
            {pickingLists.map((pl) => {
              const lineCount = Number(pl.lineCount ?? 0);
              const completedLineCount = Number(pl.completedLineCount ?? 0);
              const progress =
                lineCount > 0
                  ? Math.round((completedLineCount / lineCount) * 100)
                  : 0;

              return (
                <Link
                  key={pl.id}
                  to={path.to.pickingDetail(pl.id!)}
                  className="no-underline"
                >
                  <Card className="hover:border-primary transition-colors cursor-pointer">
                    <CardHeader className="pb-2">
                      <HStack className="justify-between">
                        <CardTitle className="text-base">
                          {pl.pickingListId}
                        </CardTitle>
                        <PickingListStatus status={pl.status!} />
                      </HStack>
                    </CardHeader>
                    <CardContent>
                      <VStack className="gap-1">
                        <HStack className="justify-between text-sm">
                          <span className="text-muted-foreground">
                            <Trans>Location</Trans>
                          </span>
                          <span>{pl.locationName}</span>
                        </HStack>
                        {pl.dueDate && (
                          <HStack className="justify-between text-sm">
                            <span className="text-muted-foreground">
                              <Trans>Due Date</Trans>
                            </span>
                            <span>
                              {new Date(pl.dueDate).toLocaleDateString()}
                            </span>
                          </HStack>
                        )}
                        <HStack className="justify-between text-sm">
                          <span className="text-muted-foreground">
                            <Trans>Progress</Trans>
                          </span>
                          <span>
                            {completedLineCount}/{lineCount} · {progress}%
                          </span>
                        </HStack>
                      </VStack>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col flex-1 w-full h-[calc(100%-var(--header-height))] items-center justify-center gap-4">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
              <LuTriangleAlert className="h-6 w-6" />
            </div>
            <span className="text-xs font-mono font-light text-foreground uppercase">
              <Trans>No picking lists assigned</Trans>
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
