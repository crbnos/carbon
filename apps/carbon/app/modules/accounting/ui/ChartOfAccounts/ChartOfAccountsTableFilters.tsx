import {
  Button,
  DatePicker,
  HStack,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { LuCalendarDays, LuX } from "react-icons/lu";
import { New, Select } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { incomeBalanceTypes } from "~/modules/accounting";

const ChartOfAccountsTableFilters = () => {
  const [params, setParams] = useUrlParams();
  const permissions = usePermissions();

  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  const incomeBalanceOptions = incomeBalanceTypes.map((type) => ({
    label: type,
    value: type,
  }));

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
      <HStack>
        <Select
          value={params.get("incomeBalance") ?? ""}
          placeholder="Income/Balance Sheet"
          options={incomeBalanceOptions}
          size="sm"
          isClearable
          onChange={(newValue) => setParams({ incomeBalance: newValue })}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" leftIcon={<LuCalendarDays />}>
              Date Range
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[390px]">
            <PopoverHeader>
              <p className="text-sm">Edit date range</p>
              <p className="text-xs text-muted-foreground">
                Select date range to filter net change and balance at date
              </p>
            </PopoverHeader>

            <div className="grid grid-cols-[1fr_3fr] gap-y-2 items-center">
              <p className="text-sm text-muted-foreground">Start Date</p>
              <DatePicker
                value={startDate ? parseDate(startDate) : null}
                onChange={(value) => setParams({ startDate: value.toString() })}
              />
              <p className="text-sm text-muted-foreground">End Date</p>
              <DatePicker
                value={endDate ? parseDate(endDate) : null}
                onChange={(value) => setParams({ endDate: value.toString() })}
              />
            </div>
          </PopoverContent>
        </Popover>
        {[...params.entries()].length > 0 && (
          <Button
            variant="solid"
            rightIcon={<LuX />}
            onClick={() =>
              setParams({
                incomeBalance: undefined,
                startDate: undefined,
                endDate: undefined,
              })
            }
          >
            Reset
          </Button>
        )}
      </HStack>
      <HStack>
        {permissions.can("create", "accounting") && (
          <New label="Account" to={`new?${params.toString()}`} />
        )}
      </HStack>
    </div>
  );
};

export default ChartOfAccountsTableFilters;
