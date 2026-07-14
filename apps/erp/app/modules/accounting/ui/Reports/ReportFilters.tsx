import {
  Button,
  HStack,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuLanguages, LuSearch, LuX } from "react-icons/lu";
import { PeriodSelector } from "~/components";
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
  periodVariant?: "range" | "asOf";
  fiscalStartMonth?: number;
  search: string;
  onSearchChange: (value: string) => void;
};

const ReportFilters = ({
  companies,
  selectedCompanyIds,
  isMultiCompany,
  isForeignCurrency = false,
  parentCurrency,
  periodVariant = "range",
  fiscalStartMonth,
  search,
  onSearchChange
}: ReportFiltersProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();

  const showTranslated = params.get("showTranslated") === "true";

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
        <CompanySelector
          companies={companies}
          selectedCompanyIds={selectedCompanyIds}
        />
        <PeriodSelector
          variant={periodVariant}
          fiscalStartMonth={fiscalStartMonth}
        />
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
            {t`Reset`}
          </Button>
        )}
      </HStack>
    </div>
  );
};

export default ReportFilters;
