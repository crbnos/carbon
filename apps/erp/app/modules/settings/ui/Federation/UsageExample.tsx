// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { FederationProvider } from "@carbon/ee/federation";
import { Badge, CodeBlock, Copy, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { DateTime } from "~/components";

type UsageTarget = {
  ruleId: string;
  audience: string;
  provider: FederationProvider;
  issuer: string;
};

/** The snippet a workload runs to exchange its token under the rule. */
export function usageExample(target: UsageTarget, erpUrl: string): string {
  const exchange = `curl -s -X POST ${erpUrl}/token \\
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \\
  -d client_id=${target.ruleId} \\
  -d subject_token_type=urn:ietf:params:oauth:token-type:jwt \\
  -d subject_token="$OIDC_TOKEN"`;

  if (target.provider !== "GitHub Actions") {
    return `# OIDC_TOKEN: a token from ${target.issuer} for audience ${target.audience}
${exchange}`;
  }
  return `permissions:
  id-token: write
steps:
  - name: Get a Carbon API key
    run: |
      OIDC_TOKEN=$(curl -s -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
        "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${encodeURIComponent(target.audience)}" | jq -r .value)
      KEY=$(${exchange.replace(/\n {2}/g, "\n        ")} | jq -r .access_token)
      echo "::add-mask::$KEY"
      echo "CARBON_API_KEY=$KEY" >> "$GITHUB_ENV"`;
}

export function UsageExample({
  target,
  erpUrl
}: {
  target: UsageTarget;
  erpUrl: string;
}) {
  const example = usageExample(target, erpUrl);
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <span className="text-sm font-medium">
          <Trans>Usage</Trans>
        </span>
        <Copy text={example} />
      </HStack>
      {/* min-w-0: a long command line scrolls inside the block, not past the modal. */}
      <div className="w-full min-w-0 max-w-full overflow-x-auto text-xs">
        <CodeBlock className="bash">{example}</CodeBlock>
      </div>
    </VStack>
  );
}

export type ExchangeAttempt = {
  id: string;
  outcome: "Succeeded" | "Refused";
  reason: string | null;
  subject: string | null;
  createdAt: string;
};

/** A rule's latest attempts: the refusal reason the caller never sees. */
export function RecentExchanges({
  exchanges
}: {
  exchanges: ExchangeAttempt[];
}) {
  if (exchanges.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>No exchanges yet.</Trans>
      </p>
    );
  }
  return (
    <VStack spacing={1} className="w-full">
      {exchanges.map((exchange) => (
        <HStack key={exchange.id} className="w-full justify-between text-sm">
          <HStack spacing={2} className="min-w-0">
            <Badge
              variant={
                exchange.outcome === "Succeeded" ? "green" : "destructive"
              }
            >
              {exchange.outcome === "Succeeded" ? (
                <Trans>Succeeded</Trans>
              ) : (
                <Trans>Refused</Trans>
              )}
            </Badge>
            {exchange.reason && (
              <span className="font-mono text-xs">{exchange.reason}</span>
            )}
            {exchange.subject && (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {exchange.subject}
              </span>
            )}
          </HStack>
          <DateTime value={exchange.createdAt} />
        </HStack>
      ))}
    </VStack>
  );
}
