// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import type { ReportColumnGranularity } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import {
  LuColumns3,
  LuDownload,
  LuLanguages,
  LuSearch,
  LuX
} from "react-icons/lu";
import { PeriodSelector } from "~/components";
import { AppBarAction } from "~/components/New";
import { useUrlParams } from "~/hooks";
import { financialReportColumns } from "../../accounting.models";
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
  /** Preset shown as active in the period selector when no date params are set */
  defaultPeriodId?: string;
  /** Renders the Columns granularity select (BS & IS only) */
  showColumns?: boolean;
  /** Renders the account search box (hidden for fixed summary reports) */
  showSearch?: boolean;
  /** Renders a Download (CSV) button on the right */
  onDownload?: () => void;
  /** Omitted for fixed summary reports that render no search box */
  search?: string;
  onSearchChange?: (value: string) => void;
};

const ReportFilters = ({
  companies,
  selectedCompanyIds,
  isMultiCompany,
  isForeignCurrency = false,
  parentCurrency,
  periodVariant = "range",
  fiscalStartMonth,
  defaultPeriodId,
  showColumns = false,
  showSearch = true,
  onDownload,
  search = "",
  onSearchChange
}: ReportFiltersProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();

  const showTranslated = params.get("showTranslated") === "true";
  const columnsParam = params.get("columns");
  const columns: ReportColumnGranularity = financialReportColumns.includes(
    columnsParam as ReportColumnGranularity
  )
    ? (columnsParam as ReportColumnGranularity)
    : "month";

  const columnLabels: Record<ReportColumnGranularity, string> = {
    month: t`Monthly`,
    quarter: t`Quarterly`,
    year: t`Yearly`
  };

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full max-md:flex-col max-md:items-stretch max-md:space-x-0 max-md:px-0 max-md:py-0">
      {/* Phones: search on its own row, then company, period and columns as
          one sideways-scrolling chip row; Download moves to the app bar. */}
      <div className="flex min-w-0 items-center gap-2 max-md:flex-col max-md:items-stretch max-md:gap-0">
        {showSearch && (
          <div className="max-md:px-4 max-md:pt-2">
            <InputGroup size="sm" className="w-64 max-md:w-full">
              <InputLeftElement>
                <LuSearch className="h-4 w-4 text-muted-foreground" />
              </InputLeftElement>
              <Input
                placeholder={t`Search accounts...`}
                value={search}
                onChange={(e) => onSearchChange?.(e.target.value)}
              />
            </InputGroup>
          </div>
        )}
        <HStack className="max-md:w-full max-md:flex-nowrap max-md:overflow-x-auto max-md:scrollbar-hide max-md:scroll-fade-x max-md:whitespace-nowrap max-md:px-4 max-md:py-2 max-md:[&>*]:shrink-0">
          <CompanySelector
            companies={companies}
            selectedCompanyIds={selectedCompanyIds}
          />
          <PeriodSelector
            variant={periodVariant}
            fiscalStartMonth={fiscalStartMonth}
            defaultPresetId={defaultPeriodId}
          />
          {showColumns && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" leftIcon={<LuColumns3 />}>
                  {columnLabels[columns]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={columns}
                  onValueChange={(value) =>
                    setParams({
                      columns: value === "month" ? undefined : value
                    })
                  }
                >
                  {financialReportColumns.map((granularity) => (
                    <DropdownMenuRadioItem
                      key={granularity}
                      value={granularity}
                    >
                      {columnLabels[granularity]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
                  columns: undefined,
                  showTranslated: undefined
                })
              }
            >
              {t`Reset`}
            </Button>
          )}
        </HStack>
      </div>
      {onDownload && (
        <AppBarAction
          icon={<LuDownload />}
          label={t`Download`}
          onClick={onDownload}
        >
          <Button
            variant="secondary"
            leftIcon={<LuDownload />}
            onClick={onDownload}
          >
            {t`Download`}
          </Button>
        </AppBarAction>
      )}
    </div>
  );
};

export default ReportFilters;
