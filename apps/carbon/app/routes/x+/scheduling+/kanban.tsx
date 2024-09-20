import {
  Button,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  useLocalStorage,
} from "@carbon/react";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import { LuListFilter, LuRefreshCcw } from "react-icons/lu";
import { SearchFilter } from "~/components";
import type { Column, DisplaySettings, Item } from "~/components/Kanban";
import { Kanban } from "~/components/Kanban";

export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    columns: [
      {
        id: "1",
        type: "assembly",
        title: "Assembly Station 1",
        active: true,
      },
      {
        id: "2",
        type: "assembly",
        title: "Assembly Station 2",
      },
      {
        id: "3",
        type: "saw",
        title: "Band Saw",
      },
      {
        id: "4",
        type: "grinder",
        title: "Bench Grinder",
        active: true,
      },
      {
        id: "5",
        title: "CNC Mill 1",
        type: "cnc",
      },
    ] satisfies Column[],
    items: [
      {
        id: "item0",
        columnId: "4",
        columnType: "grinder",
        title: "1503",
        subtitle: "F011432",
        description: "Grind",
        customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
        dueDate: "2024-05-28",
        duration: 30 * 60 * 1000,
        deadlineType: "Hard Deadline",
        progress: 5 * 60 * 1000,
        status: "IN_PROGRESS",
      },
      {
        id: "item1",
        columnId: "3",
        columnType: "saw",
        title: "1032",
        subtitle: "F011432",
        description: "Cut",
        dueDate: "2024-05-30",
        duration: 2 * 60 * 60 * 1000,
        deadlineType: "Soft Deadline",
        status: "PAUSED",
        progress: 1.3 * 60 * 60 * 1000,
      },
      {
        id: "item2",
        columnId: "3",
        columnType: "saw",
        title: "1023",
        subtitle: "F011432",
        description: "Cut",
        dueDate: "2024-05-20",
        duration: 2 * 60 * 60 * 1000,
        deadlineType: "ASAP",
        customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
        status: "READY",
      },
      {
        id: "item3",
        columnId: "3",
        columnType: "saw",
        title: "1022",
        subtitle: "F011432",
        description: "Cut",
        duration: 10 * 60 * 1000,
        deadlineType: "No Deadline",
        status: "READY",
      },
      {
        id: "item6",
        columnId: "1",
        columnType: "assembly",
        title: "1013",
        subtitle: "F011432",
        description: "Assemble",
        deadlineType: "No Deadline",
        duration: 2 * 60 * 60 * 1000,
        employeeIds: ["52cdefed-f4b7-45b1-9ec8-701473671fb7"],
        status: "IN_PROGRESS",
        progress: 35 * 60 * 1000,
      },
      {
        id: "item4",
        columnId: getRandomBetweenRange(1, 2),
        columnType: "assembly",
        title: "1492",
        subtitle: "F011432",
        description: "Assemble",
        duration: 4 * 60 * 60 * 1000,
        deadlineType: "No Deadline",
        status: "WAITING",
      },
      {
        id: "item5",
        columnId: getRandomBetweenRange(1, 2),
        columnType: "assembly",
        title: "1109",
        subtitle: "F011432",
        description: "Assemble",
        dueDate: "2024-05-20",
        duration: 4 * 60 * 60 * 1000,
        deadlineType: "Soft Deadline",
        status: "WAITING",
      },

      {
        id: "item7",
        columnId: getRandomBetweenRange(1, 2),
        columnType: "assembly",
        title: "1014",
        subtitle: "F011432",
        description: "Assemble",
        dueDate: "2024-06-20",
        duration: 20 * 60 * 1000,
        deadlineType: "Hard Deadline",
        customerId: "bcbe0bca-6516-4a6c-bb8a-b3942f1a9a33",
        status: "TODO",
      },
      {
        id: "item8",
        columnId: getRandomBetweenRange(1, 2),
        columnType: "assembly",
        title: "1032",
        subtitle: "F011432",
        description: "Assemble",
        dueDate: "2024-05-24",
        duration: 2 * 60 * 60 * 1000,
        deadlineType: "Soft Deadline",
        customerId: "ca2f11f8-1464-4753-9690-00107f141f3a",
        status: "TODO",
      },
      {
        id: "item9",
        columnId: getRandomBetweenRange(1, 2),
        columnType: "assembly",
        title: "1010",
        subtitle: "F011432",
        description: "Assemble",
        dueDate: "2024-05-20",
        duration: 32 * 1000,
        deadlineType: "ASAP",
        status: "TODO",
      },
      {
        id: "item10",
        columnId: getRandomBetweenRange(1, 2),
        columnType: "assembly",
        title: "1403",
        subtitle: "F011432",
        description: "Assemble",
        dueDate: "2024-05-20",
        duration: 6 * 60 * 60 * 1000,
        deadlineType: "No Deadline",
        customerId: "bcbe0bca-6516-4a6c-bb8a-b3942f1a9a33",
        status: "TODO",
      },
    ] satisfies Item[],
  });
}

export default function KanbanView() {
  const { columns, items } = useLoaderData<typeof loader>();
  const [kanbanSettings, setKanbanSettings] = useKanbanSettings();
  const revalidator = useRevalidator();

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
        <HStack>
          <SearchFilter param="search" size="sm" placeholder="Search" />
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
        <HStack>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                leftIcon={<HiOutlineAdjustmentsHorizontal />}
                variant="secondary"
              >
                Display
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="overflow-y-auto p-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-fit"
              align="end"
            >
              <div className="flex flex-col items-end gap-2 pl-4">
                <Switch
                  variant="small"
                  label="Description"
                  checked={kanbanSettings.showDescription}
                  onCheckedChange={(e) =>
                    setKanbanSettings("showDescription", e.valueOf())
                  }
                />
                <Switch
                  variant="small"
                  label="Customer"
                  checked={kanbanSettings.showCustomer}
                  onCheckedChange={(e) =>
                    setKanbanSettings("showCustomer", e.valueOf())
                  }
                />
                <Switch
                  variant="small"
                  label="Employee"
                  checked={kanbanSettings.showEmployee}
                  onCheckedChange={(e) =>
                    setKanbanSettings("showEmployee", e.valueOf())
                  }
                />
                <Switch
                  variant="small"
                  label="Due Date"
                  checked={kanbanSettings.showDueDate}
                  onCheckedChange={(e) =>
                    setKanbanSettings("showDueDate", e.valueOf())
                  }
                />
                <Switch
                  variant="small"
                  label="Duration"
                  checked={kanbanSettings.showDuration}
                  onCheckedChange={(e) =>
                    setKanbanSettings("showDuration", e.valueOf())
                  }
                />
                <Switch
                  variant="small"
                  label="Progress"
                  checked={kanbanSettings.showProgress}
                  onCheckedChange={(e) =>
                    setKanbanSettings("showProgress", e.valueOf())
                  }
                />
              </div>
            </PopoverContent>
          </Popover>
          <Button
            leftIcon={<LuRefreshCcw />}
            variant="secondary"
            onClick={revalidator.revalidate}
          >
            Rebalance
          </Button>
        </HStack>
      </HStack>
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
          <div className="flex flex-1 min-h-0 w-full relative">
            <Kanban columns={columns} items={items} {...kanbanSettings} />
          </div>
        </div>
      </div>
    </div>
  );
}

function useKanbanSettings() {
  const [kanbanSettings, setKanbanSettings] = useLocalStorage<DisplaySettings>(
    "kanbanSettings",
    {
      showCustomer: false,
      showDescription: false,
      showDueDate: false,
      showDuration: false,
      showEmployee: false,
      showProgress: false,
      showStatus: false,
    }
  );

  const updateKanbanSettings = (
    key: keyof typeof kanbanSettings,
    value: boolean
  ) => {
    setKanbanSettings({ ...kanbanSettings, [key]: value });
  };

  return [kanbanSettings, updateKanbanSettings] as const;
}

function getRandomBetweenRange(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}
