import { Button, HStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { LuListFilter, LuRefreshCcw } from "react-icons/lu";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import type { Column, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";
import { DebouncedInput } from "~/components/Search";

export async function loader({ request }: LoaderFunctionArgs) {
  return typedjson({
    columns: [
      {
        id: "1",
        title: "Assembly Station 1",
        active: true,
      },
      {
        id: "2",
        title: "Assembly Station 2",
      },
      {
        id: "3",
        title: "Band Saw",
      },
      {
        id: "4",
        title: "Bench Grinder",
        active: true,
      },
      {
        id: "5",
        title: "CNC Mill 1",
      },
    ] satisfies Column[],
    items: [
      {
        id: "item0",
        columnId: "4",
        title: "1503",
        customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
        dueDate: "2024-05-28",
        duration: 30 * 60 * 1000,
        deadlineType: "HARD_DEADLINE",
        progress: 5 * 60 * 1000,
        status: "IN_PROGRESS",
      },
      {
        id: "item1",
        columnId: "3",
        title: "1032",
        dueDate: "2024-05-30",
        duration: 2 * 60 * 60 * 1000,
        deadlineType: "SOFT_DEADLINE",
        status: "PAUSED",
        progress: 1.3 * 60 * 60 * 1000,
      },
      {
        id: "item2",
        columnId: "3",
        title: "1023",
        dueDate: "2024-05-20",
        duration: 2 * 60 * 60 * 1000,
        deadlineType: "ASAP",
        customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
        status: "READY",
      },
      {
        id: "item3",
        columnId: "3",
        title: "1022",
        duration: 10 * 60 * 1000,
        deadlineType: "NO_DEADLINE",
        status: "READY",
      },
      {
        id: "item4",
        columnId: "2",
        title: "1492",
        duration: 4 * 60 * 60 * 1000,
        deadlineType: "NO_DEADLINE",
        status: "WAITING",
      },
      {
        id: "item5",
        columnId: "2",
        title: "1109",
        dueDate: "2024-05-20",
        duration: 4 * 60 * 60 * 1000,
        deadlineType: "SOFT_DEADLINE",
        status: "WAITING",
      },
      {
        id: "item6",
        columnId: "1",
        title: "1013",
        deadlineType: "NO_DEADLINE",
        duration: 2 * 60 * 60 * 1000,
        employeeIds: ["52cdefed-f4b7-45b1-9ec8-701473671fb7"],
        status: "IN_PROGRESS",
        progress: 35 * 60 * 1000,
      },
      {
        id: "item7",
        columnId: "1",
        title: "1014",
        dueDate: "2024-06-20",
        duration: 20 * 60 * 1000,
        deadlineType: "HARD_DEADLINE",
        customerId: "bcbe0bca-6516-4a6c-bb8a-b3942f1a9a33",
        status: "TODO",
      },
      {
        id: "item8",
        columnId: "1",
        title: "1032",
        dueDate: "2024-05-24",
        duration: 2 * 60 * 60 * 1000,
        deadlineType: "SOFT_DEADLINE",
        customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
        status: "TODO",
      },
      {
        id: "item9",
        columnId: "1",
        title: "1010",
        dueDate: "2024-05-20",
        duration: 32 * 1000,
        deadlineType: "ASAP",
        status: "TODO",
      },
      {
        id: "item10",
        columnId: "1",
        title: "1403",
        dueDate: "2024-05-20",
        duration: 6 * 60 * 60 * 1000,
        deadlineType: "NO_DEADLINE",
        customerId: "bcbe0bca-6516-4a6c-bb8a-b3942f1a9a33",
        status: "TODO",
      },
    ] satisfies Item[],
  });
}

export default function KanbanView() {
  const { columns, items } = useTypedLoaderData<typeof loader>();
  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
        <HStack>
          <DebouncedInput param="search" size="sm" placeholder="Search" />
          {/* <Filter filters={filters} /> */}
          <Button
            rightIcon={<LuListFilter />}
            role="combobox"
            variant="secondary"
            className={"!border-dashed border-border"}
          >
            Filter
          </Button>
        </HStack>
        <Button leftIcon={<LuRefreshCcw />}>Reschedule</Button>
      </HStack>
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
          <div className="flex flex-1 min-h-0 w-full relative">
            <Kanban columns={columns} items={items} />
          </div>
        </div>
      </div>
    </div>
  );
}
