// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Switch, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";

type RequireContactEmailSwitchProps = {
  /** The supplier's or customer's require-email route. */
  action: string;
  checked: boolean;
  isDisabled?: boolean;
};

/** "Require email on contacts" for one supplier or customer; saves on toggle. */
const RequireContactEmailSwitch = ({
  action,
  checked,
  isDisabled
}: RequireContactEmailSwitchProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) toast.error(fetcher.data.error.message);
  }, [fetcher.data]);
  const pending = fetcher.formData?.get("requireContactEmail");
  const value =
    pending === undefined || pending === null ? checked : pending === "true";

  return (
    <Switch
      variant="small"
      checked={value}
      disabled={isDisabled || fetcher.state !== "idle"}
      onCheckedChange={(next) =>
        fetcher.submit(
          { requireContactEmail: String(next) },
          { method: "post", action }
        )
      }
      label={t`Require email on contacts`}
    />
  );
};

export default RequireContactEmailSwitch;
