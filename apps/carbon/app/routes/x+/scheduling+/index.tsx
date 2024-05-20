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
        id: "item1",
        columnId: "3",
        content: "Project initiation and planning",
      },
      {
        id: "item2",
        columnId: "3",
        content: "Gather requirements from stakeholders",
      },
      {
        id: "item3",
        columnId: "3",
        content: "Create wireframes and mockups",
      },
      {
        id: "item4",
        columnId: "2",
        content: "Develop homepage layout",
      },
      {
        id: "item5",
        columnId: "2",
        content: "Design color scheme and typography",
      },
      {
        id: "item6",
        columnId: "1",
        content: "Implement user authentication",
      },
      {
        id: "item7",
        columnId: "1",
        content: "Build contact us page",
      },
      {
        id: "item8",
        columnId: "1",
        content: "Create product catalog",
      },
      {
        id: "item9",
        columnId: "1",
        content: "Develop about us page",
      },
      {
        id: "item10",
        columnId: "1",
        content: "Optimize website for mobile devices",
      },
      {
        id: "item11",
        columnId: "1",
        content: "Integrate payment gateway",
      },
      {
        id: "item12",
        columnId: "1",
        content: "Perform testing and bug fixing",
      },
      {
        id: "item13",
        columnId: "1",
        content: "Launch website and deploy to server",
      },
    ] satisfies Item[],
  });
}

export default function KanbanView() {
  const { columns, items } = useTypedLoaderData<typeof loader>();
  return (
    <div className={cn("grid grid-cols-1 h-full max-h-full  overflow-hidden")}>
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border w-full">
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
