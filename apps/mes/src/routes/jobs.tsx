import {
  Avatar,
  Button,
  Heading,
  IconButton,
  Input,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipProvider,
  cn,
  useDebounce,
  useLocalStorage,
} from "@carbon/react";

import { useMemo, useState } from "react";
import { AiOutlineFieldTime } from "react-icons/ai";
import { LuCalendarClock, LuLogOut, LuSearch } from "react-icons/lu";
import { Outlet, useLoaderData, useOutletContext } from "react-router-dom";
import { JobsList } from "~/components/Jobs/JobsList";
import { WorkCellSelect } from "~/components/Jobs/WorkCellSelect";
import { Nav } from "~/components/Nav";
import { requireAuthentication } from "~/lib/auth";
import { jobs, workCells } from "~/lib/data";
import type { Job, JobSettings, OutletContext } from "~/types";

const jobSettings: JobSettings = {
  showCustomer: false,
  showDescription: true,
  showDueDate: true,
  showDuration: true,
  showEmployee: false,
  showProgress: false,
  showStatus: true,
};

export async function loader() {
  await requireAuthentication();

  return {
    jobs: jobs satisfies Job[],
    jobSettings,
    workCells,
  };
}

interface JobsProps {
  defaultLayout?: number[] | undefined;
  defaultCollapsed?: boolean;
  navCollapsedSize: number;
}

export const defaultJobLayout = [265, 440, 655];

export function Jobs({
  defaultLayout = defaultJobLayout,
  defaultCollapsed = false,
  navCollapsedSize = 50,
}: JobsProps) {
  const { user, signOut } = useOutletContext<OutletContext>();
  const { jobs, jobSettings, workCells } = useLoaderData() as Awaited<
    ReturnType<typeof loader>
  >;

  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const [selectedWorkCell, setSelectedWorkCell] = useLocalStorage<string>(
    `${user?.id}:workCell`,
    workCells?.[0]?.id ?? ""
  );

  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const debounceSearch = useDebounce((input: string) => {
    setSearch(input);
  }, 500);
  const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    debounceSearch(e.target.value);
  };

  const workCellJobs = useMemo(
    () =>
      jobs.filter((job) => {
        if (!search) return job.workCenterId === selectedWorkCell;

        return (
          job.workCenterId === selectedWorkCell &&
          job.readableId.includes(search.toLowerCase())
        );
      }),
    [jobs, search, selectedWorkCell]
  );

  return (
    <TooltipProvider delayDuration={0}>
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full items-stretch"
      >
        <ResizablePanel
          defaultSize={defaultLayout[0]}
          collapsedSize={navCollapsedSize}
          collapsible={true}
          minSize={15}
          maxSize={20}
          onCollapse={() => {
            setIsCollapsed(true);
          }}
          onExpand={() => {
            setIsCollapsed(false);
          }}
          className={cn(
            isCollapsed &&
              "min-w-[50px] transition-all duration-300 ease-in-out"
          )}
        >
          <div
            className={cn(
              "flex h-[52px] items-center justify-start bg-background",
              isCollapsed ? "h-[52px]" : "px-2"
            )}
          >
            <div
              className={cn(
                "flex items-center space-x-2 w-full",
                isCollapsed ? "justify-center" : "justify-start"
              )}
            >
              <Avatar
                size="sm"
                src={user?.avatarUrl ?? undefined}
                name={user?.fullName ?? ""}
              />
              {!isCollapsed && (
                <span className="text-sm truncate">{user?.fullName}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col h-[calc(100%-52px)] justify-between overflow-y-auto">
            <div className="flex flex-col">
              <Separator />
              <Nav
                isCollapsed={isCollapsed}
                links={[
                  {
                    title: "Jobs",
                    label: "128",
                    icon: LuCalendarClock,
                    variant: "primary",
                  },
                  {
                    title: "Active",
                    label: "1",
                    icon: AiOutlineFieldTime,
                    variant: "ghost",
                  },
                ]}
              />
              {/* <Separator />
              <Nav
                isCollapsed={isCollapsed}
                links={[
                  {
                    title: "Messages",
                    label: "972",
                    icon: LuMessageSquare,
                    variant: "ghost",
                  },
                ]}
              /> */}
            </div>
            <div
              className={cn(
                "flex flex-col p-2 w-full",
                isCollapsed && "items-center justify-center "
              )}
            >
              {isCollapsed ? (
                <IconButton
                  aria-label="Sign out"
                  icon={<LuLogOut />}
                  onClick={signOut}
                />
              ) : (
                <Button size="lg" onClick={signOut}>
                  Sign out
                </Button>
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={defaultLayout[1]} minSize={30}>
          <Tabs defaultValue="current">
            <div className="flex items-center px-4 py-2 h-[52px] bg-background">
              <Heading size="h2">Jobs</Heading>
              <TabsList className="ml-auto">
                <TabsTrigger value="current">Current</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </div>
            <Separator />
            <div className="bg-background/95 p-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="relative">
                <div className="flex justify-between space-x-4">
                  <div className="flex flex-grow">
                    <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={input}
                      onChange={onSearchChange}
                      placeholder="Search"
                      className="pl-8"
                    />
                  </div>
                  <div className="flex flex-shrink">
                    <WorkCellSelect
                      workCells={workCells}
                      value={selectedWorkCell}
                      onChange={setSelectedWorkCell}
                    />
                  </div>
                </div>
              </div>
            </div>
            <TabsContent value="current" className="m-0">
              <JobsList
                jobs={workCellJobs.filter((job) =>
                  ["IN_PROGRESS", "PAUSED", "READY", "TODO"].includes(
                    job.status
                  )
                )}
                {...jobSettings}
              />
            </TabsContent>
            <TabsContent value="all" className="m-0">
              <JobsList jobs={workCellJobs} {...jobSettings} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
        <Outlet context={{ user }} />
      </ResizablePanelGroup>
    </TooltipProvider>
  );
}
