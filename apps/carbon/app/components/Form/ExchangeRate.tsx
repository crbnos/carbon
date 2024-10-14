import {
  cn,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import React, { useMemo } from "react";
import { LuInfo, LuRefreshCw } from "react-icons/lu";
import { Input } from "~/components/Form";

interface ExchangeRateProps extends React.ComponentProps<typeof Input> {
  onRefresh?: () => void;
  exchangeRateDate: string | undefined;
}

const ExchangeRate: React.FC<ExchangeRateProps> = ({
  onRefresh,
  exchangeRateDate,
  ...props
}) => {
  const { locale } = useLocale();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }),
    [locale]
  );

  const formattedDate = exchangeRateDate
    ? formatter.format(new Date(exchangeRateDate))
    : "";

  return (
    <div className="relative">
      <HStack spacing={0}>
        <Input
          label={
            <HStack spacing={1}>
              <span>Exchange Rate</span>
              {exchangeRateDate && onRefresh && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Last updated on: {formattedDate}
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
          }
          {...props}
          isReadOnly
          className={cn("z-10", onRefresh ? "rounded-r-none" : "")}
        />
        {onRefresh && (
          <IconButton
            aria-label="Refresh exchange rate"
            className="bg-transparent flex-shrink-0 h-10 rounded-l-none border-l-0 shadow-sm self-end"
            icon={<LuRefreshCw />}
            variant="secondary"
            size="lg"
            onClick={onRefresh}
          />
        )}
      </HStack>
    </div>
  );
};

export default ExchangeRate;
