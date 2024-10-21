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
  exchangeRateUpdatedAt: string | undefined;
}

const ExchangeRate: React.FC<ExchangeRateProps> = ({
  onRefresh,
  exchangeRateUpdatedAt,
  ...props
}) => {
  const { locale } = useLocale();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale]
  );

  const formattedDate = exchangeRateUpdatedAt
    ? formatter.format(new Date(exchangeRateUpdatedAt))
    : "";

  return (
    <div className="relative">
      <HStack spacing={0} className="items-end">
        <Input
          label={
            <HStack spacing={1}>
              <span>Exchange Rate</span>
              {exchangeRateUpdatedAt && (
                <Tooltip>
                  <TooltipTrigger tabIndex={-1}>
                    <LuInfo className="w-4 h-4" />
                  </TooltipTrigger>
                  <TooltipContent>Last updated: {formattedDate}</TooltipContent>
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
            className="flex-shrink-0 h-10 w-10 px-3 rounded-l-none border-l-0 shadow-sm"
            icon={<LuRefreshCw />}
            variant="secondary"
            size="md"
            onClick={onRefresh}
          />
        )}
      </HStack>
    </div>
  );
};

export default ExchangeRate;
