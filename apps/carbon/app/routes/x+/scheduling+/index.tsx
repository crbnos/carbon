import { Button, HStack, cn } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { LuListFilter } from "react-icons/lu";
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
        customerId: "6bd344cd-5ea8-406e-9253-2d3672a56533",
        dueDate: "2024-05-20",
        deadlineType: "HARD_DEADLINE",
        status: {
          status: "WARNING",
          message: "Paused",
        },
      },
      {
        id: "item1",
        columnId: "3",
        title: "1032",
        dueDate: "2024-05-20",
        deadlineType: "SOFT_DEADLINE",
        status: {
          status: "WARNING",
          message: "Paused",
        },
      },
      {
        id: "item2",
        columnId: "3",
        title: "1023",
        dueDate: "2024-05-20",
        deadlineType: "ASAP",
        customerId: "6bd344cd-5ea8-406e-9253-2d3672a56533",
        status: {
          status: "INFO",
          message: "Ready",
        },
      },
      {
        id: "item3",
        columnId: "3",
        title: "1022",
        deadlineType: "NO_DEADLINE",
        status: {
          status: "INFO",
          message: "Ready",
        },
      },
      {
        id: "item4",
        columnId: "2",
        title: "1492",
        deadlineType: "NO_DEADLINE",
        status: {
          status: "ERROR",
          message: "Waiting",
        },
      },
      {
        id: "item5",
        columnId: "2",
        title: "1109",
        dueDate: "2024-05-20",
        deadlineType: "SOFT_DEADLINE",
        status: {
          status: "ERROR",
          message: "Waiting",
        },
      },
      {
        id: "item6",
        columnId: "1",
        title: "1013",
        deadlineType: "NO_DEADLINE",
        employeeIds: [
          "1ab986d3-362b-4d7f-849e-bc57697c4aff",
          "98bc4b87-37a9-4032-9f8e-97849e8dd8d4",
        ],
        status: {
          status: "SUCCESS",
          message: "In Progress",
        },
      },
      {
        id: "item7",
        columnId: "1",
        title: "1014",
        dueDate: "2024-05-20",
        deadlineType: "HARD_DEADLINE",
        customerId: "1af341c6-d71c-4e4e-8382-e3850e4808cc",
        status: {
          status: "DEFAULT",
          message: "Pending",
        },
      },
      {
        id: "item8",
        columnId: "1",
        title: "1032",
        dueDate: "2024-05-20",
        deadlineType: "SOFT_DEADLINE",
        customerId: "6bd344cd-5ea8-406e-9253-2d3672a56533",
        status: {
          status: "DEFAULT",
          message: "Pending",
        },
      },
      {
        id: "item9",
        columnId: "1",
        title: "1010",
        dueDate: "2024-05-20",
        deadlineType: "ASAP",
        status: {
          status: "DEFAULT",
          message: "Pending",
        },
      },
      {
        id: "item10",
        columnId: "1",
        title: "1403",
        dueDate: "2024-05-20",
        deadlineType: "NO_DEADLINE",
        customerId: "1af341c6-d71c-4e4e-8382-e3850e4808cc",
        status: {
          status: "DEFAULT",
          message: "Pending",
        },
      },
    ] satisfies Item[],
  });
}

export default function KanbanView() {
  const { columns, items } = useTypedLoaderData<typeof loader>();
  return (
    <div className={cn("flex flex-col h-full max-h-full  overflow-hidden")}>
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
      </HStack>

      <Kanban columns={columns} items={items} />
    </div>
  );
}
