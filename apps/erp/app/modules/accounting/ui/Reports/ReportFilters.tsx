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
import { LuCalendarDays, LuLanguages, LuSearch, LuX } from "react-icons/lu";
import { useUrlParams } from "~/hooks";
import CompanySelector from "./CompanySelector";

type Company = {
  id: string;
  name: string;
};

type ReportFiltersProps = {
  companies: Company[];
  selectedCompanyIds: string[];
  isMultiCompany: boolean;
  isForeignCurrency?: boolean;
  parentCurrency?: string | null;
  search: string;
  onSearchChange: (value: string) => void;
};

const ReportFilters = ({
  companies,
  selectedCompanyIds,
  isMultiCompany,
  isForeignCurrency = false,
  parentCurrency,
  search,
  onSearchChange
}: ReportFiltersProps) => {
  const [params, setParams] = useUrlParams();

  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const showTranslated = params.get("showTranslated") === "true";

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
      <HStack>
        <InputGroup size="sm" className="w-64">
          <InputLeftElement>
            <LuSearch className="h-4 w-4 text-muted-foreground" />
          </InputLeftElement>
          <Input
            placeholder="Search accounts..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </InputGroup>
        <CompanySelector
          companies={companies}
          selectedCompanyIds={selectedCompanyIds}
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
                Select date range to filter balances
              </p>
            </PopoverHeader>

            <div className="grid grid-cols-[1fr_3fr] gap-y-2 items-center">
              <p className="text-sm text-muted-foreground">Start Date</p>
              <DatePicker
                value={startDate ? parseDate(startDate) : null}
                onChange={(value) =>
                  setParams({ startDate: value?.toString() })
                }
              />
              <p className="text-sm text-muted-foreground">End Date</p>
              <DatePicker
                value={endDate ? parseDate(endDate) : null}
                onChange={(value) => setParams({ endDate: value?.toString() })}
              />
            </div>
          </PopoverContent>
        </Popover>
        {!isMultiCompany && isForeignCurrency && parentCurrency && (
          <Button
            variant={showTranslated ? "primary" : "secondary"}
            leftIcon={<LuLanguages />}
            onClick={() =>
              setParams({
                showTranslated: showTranslated ? undefined : "true"
              })
            }
          >
            Show in {parentCurrency}
          </Button>
        )}
        {isMultiCompany && parentCurrency && (
          <span className="text-sm text-muted-foreground">
            Showing in {parentCurrency}
          </span>
        )}
        {[...params.entries()].length > 0 && (
          <Button
            variant="secondary"
            rightIcon={<LuX />}
            onClick={() =>
              setParams({
                companies: undefined,
                startDate: undefined,
                endDate: undefined,
                showTranslated: undefined
              })
            }
          >
            Reset
          </Button>
        )}
      </HStack>
    </div>
  );
};

export default ReportFilters;
