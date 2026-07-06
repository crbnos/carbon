import {
  Button,
  DatePicker,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCalendarDays, LuSearch, LuX } from "react-icons/lu";
import { New } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";

type ChartOfAccountsTableFiltersProps = {
  search: string;
  onSearchChange: (value: string) => void;
};

const ChartOfAccountsTableFilters = ({
  search,
  onSearchChange
}: ChartOfAccountsTableFiltersProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();
  const permissions = usePermissions();

  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
      <HStack>
        <InputGroup size="sm" className="w-64">
          <InputLeftElement>
            <LuSearch className="h-4 w-4 text-muted-foreground" />
          </InputLeftElement>
          <Input
            placeholder={t`Search accounts...`}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </InputGroup>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" leftIcon={<LuCalendarDays />}>
              <Trans>Date Range</Trans>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[390px]">
            <PopoverHeader>
              <p className="text-sm">
                <Trans>Edit date range</Trans>
              </p>
              <p className="text-xs text-muted-foreground">
                <Trans>
                  Select date range to filter net change and balance at date
                </Trans>
              </p>
            </PopoverHeader>

            <div className="grid grid-cols-[1fr_3fr] gap-y-2 items-center">
              <p className="text-sm text-muted-foreground">
                <Trans>Start Date</Trans>
              </p>
              <DatePicker
                value={startDate ? parseDate(startDate) : null}
                onChange={(value) =>
                  setParams({ startDate: value?.toString() })
                }
              />
              <p className="text-sm text-muted-foreground">
                <Trans>End Date</Trans>
              </p>
              <DatePicker
                value={endDate ? parseDate(endDate) : null}
                onChange={(value) => setParams({ endDate: value?.toString() })}
              />
            </div>
          </PopoverContent>
        </Popover>
        {[...params.entries()].length > 0 && (
          <Button
            variant="secondary"
            rightIcon={<LuX />}
            onClick={() =>
              setParams({
                startDate: undefined,
                endDate: undefined
              })
            }
          >
            <Trans>Reset</Trans>
          </Button>
        )}
      </HStack>
      <HStack>
        {permissions.can("create", "accounting") && (
          <>
            <New label={t`Group`} to={`new-group?${params.toString()}`} />
            <New label={t`Account`} to={`new?${params.toString()}`} />
          </>
        )}
      </HStack>
    </div>
  );
};

export default ChartOfAccountsTableFilters;
