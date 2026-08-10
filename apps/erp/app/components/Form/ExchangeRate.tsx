import { cn, HStack, IconButton, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { LuInfo, LuLoaderCircle } from "react-icons/lu";
import { DateTime } from "~/components";
import { NumberControlled } from "~/components/Form";

interface ExchangeRateProps
  extends React.ComponentProps<typeof NumberControlled> {
  inline?: boolean;
  onRefresh?: () => void;
  exchangeRateUpdatedAt: string | undefined;
}

const ExchangeRate: React.FC<ExchangeRateProps> = ({
  onRefresh,
  inline = false,
  exchangeRateUpdatedAt,
  value,
  ...props
}) => {
  const { t } = useLingui();

  return (
    <div className="relative">
      <HStack spacing={0} className="items-end">
        {inline ? (
          <VStack spacing={2}>
            <HStack className="w-full justify-between">
              <span className="text-xs text-muted-foreground">
                <Trans>Exchange Rate</Trans>
              </span>
              {exchangeRateUpdatedAt && (
                <DateTime
                  value={exchangeRateUpdatedAt}
                  variant="absolute"
                  side="bottom"
                >
                  <LuInfo className="h-4 w-4 text-muted-foreground" />
                </DateTime>
              )}
            </HStack>
            <HStack className="w-full justify-between">
              <span>{value}</span>
            </HStack>
          </VStack>
        ) : (
          <NumberControlled
            label={
              <HStack spacing={1}>
                <span>
                  <Trans>Exchange Rate</Trans>
                </span>
                {exchangeRateUpdatedAt && (
                  <DateTime
                    value={exchangeRateUpdatedAt}
                    variant="absolute"
                    side="bottom"
                  >
                    <LuInfo className="h-4 w-4 text-muted-foreground" />
                  </DateTime>
                )}
              </HStack>
            }
            {...props}
            value={value}
            isReadOnly
            className={cn("z-10", onRefresh ? "rounded-r-none" : "")}
          />
        )}

        {onRefresh && (
          <IconButton
            aria-label={t`Refresh exchange rate`}
            className="flex-shrink-0 h-10 w-10 px-3 rounded-l-none border-l-0 shadow-sm"
            icon={<LuLoaderCircle />}
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
