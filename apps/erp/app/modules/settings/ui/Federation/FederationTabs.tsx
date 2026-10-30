// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Tabs, TabsList, TabsTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useLocation, useNavigate } from "react-router";
import { path } from "~/utils/path";

const TABS = [
  { value: path.to.federationRules, label: <Trans>Rules</Trans> },
  { value: path.to.federationIssuers, label: <Trans>Issuers</Trans> },
  {
    value: path.to.federationEvents,
    label: <Trans>Authentication events</Trans>
  }
];

/** The three pages of identity federation, one route each. */
export default function FederationTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current =
    TABS.find((tab) => pathname.startsWith(tab.value))?.value ??
    path.to.federationRules;

  return (
    <div className="flex w-full items-center border-b border-border bg-card px-4 py-2">
      <Tabs value={current} onValueChange={(value) => navigate(value)}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
