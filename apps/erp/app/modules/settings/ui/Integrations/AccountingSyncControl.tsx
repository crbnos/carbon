// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Button, Switch } from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useFetcher, useSearchParams } from "react-router";
import { usePermissions } from "~/hooks";

type AccountingSyncControlProps = {
  enabled: boolean;
  /** Required accounts with no provider account yet; sync stays off while > 0. */
  unmappedRequiredCount: number;
  /** Used tax codes with no provider rate yet (Xero, QuickBooks Online); sync stays off while > 0. */
  unmappedTaxCodeCount?: number;
};

/**
 * The on/off switch for an accounting integration's sync, shown in the
 * integration drawer header. A new connection starts off so accounts can be
 * mapped first; the switch only turns on once every required account and every
 * used tax code is mapped (the action enforces the same rule).
 */
export function AccountingSyncControl({
  enabled,
  unmappedRequiredCount,
  unmappedTaxCodeCount = 0
}: AccountingSyncControlProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const [, setSearchParams] = useSearchParams();

  const isSubmitting = fetcher.state !== "idle";
  const checked = fetcher.formData
    ? fetcher.formData.get("syncEnabled") === "true"
    : enabled;
  const isBlocked =
    !checked && (unmappedRequiredCount > 0 || unmappedTaxCodeCount > 0);

  const openTab = (tab: string) =>
    setSearchParams(
      (params) => {
        params.set("tab", tab);
        return params;
      },
      { replace: true }
    );

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-muted/40 px-3 py-2 max-md:border-0 max-md:p-0 max-md:rounded-none max-md:bg-transparent">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            <Trans>Sync</Trans>
          </span>
          {checked ? (
            <Badge variant="green">
              <Trans>On</Trans>
            </Badge>
          ) : (
            <Badge variant="secondary">
              <Trans>Off</Trans>
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {checked ? (
            <Trans>
              Records and posted journals are being sent to and received from
              this provider.
            </Trans>
          ) : isBlocked ? (
            <>
              <Trans>Nothing is synced until you turn sync on.</Trans>
              {unmappedRequiredCount > 0 && (
                <>
                  {" "}
                  <Plural
                    value={unmappedRequiredCount}
                    one="Map the # remaining required account first."
                    other="Map the # remaining required accounts first."
                  />
                </>
              )}
              {unmappedTaxCodeCount > 0 && (
                <>
                  {" "}
                  <Plural
                    value={unmappedTaxCodeCount}
                    one="Map the # remaining tax code first."
                    other="Map the # remaining tax codes first."
                  />
                </>
              )}
            </>
          ) : (
            <Trans>
              Nothing is synced until you turn sync on. Every required account
              is mapped.
            </Trans>
          )}
        </p>
        {isBlocked && unmappedRequiredCount > 0 && (
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            onClick={() => openTab("account-mapping")}
          >
            <Trans>Open Account Mapping</Trans>
          </Button>
        )}
        {isBlocked && unmappedTaxCodeCount > 0 && (
          <Button
            variant="link"
            size="sm"
            className="self-start px-0"
            onClick={() => openTab("tax-rates")}
          >
            <Trans>Open Tax Rates</Trans>
          </Button>
        )}
      </div>
      <Switch
        checked={checked}
        disabled={
          !permissions.can("update", "settings") || isSubmitting || isBlocked
        }
        aria-label={t`Sync`}
        onCheckedChange={(next) =>
          fetcher.submit(
            { intent: "update-sync-enabled", syncEnabled: String(next) },
            { method: "post" }
          )
        }
      />
    </div>
  );
}
