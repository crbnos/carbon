// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getBrowserEnv } from "@carbon/auth";
import {
  FEDERATION_LIMITS,
  FEDERATION_PRESETS,
  type FederationProvider
} from "@carbon/ee/federation";
import { useField } from "@carbon/form";
import {
  Button,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input as InputBase,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import {
  Hidden,
  Input,
  InputControlled,
  Number,
  Select,
  TextArea
} from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import {
  fromApiKeyScopes,
  toApiKeyScopes,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import {
  apiKeyOptInPermissionKeys,
  apiKeyPermissionModules
} from "~/modules/settings/settings.models";

export type IssuerOption = {
  id: string;
  name: string;
  provider: FederationProvider;
  issuer: string;
};

type ClaimRow = { claim: string; value: string };

export type RuleValues = {
  id?: string;
  name: string;
  description: string;
  issuerId: string;
  audience: string;
  subject: string;
  tokenLifetimeMinutes: number;
};

/** A new rule's values for an issuer: the audience the provider expects. */
export function ruleValuesFor(issuer: IssuerOption | undefined): RuleValues {
  const preset = issuer ? FEDERATION_PRESETS[issuer.provider] : undefined;
  return {
    name: "",
    description: "",
    issuerId: issuer?.id ?? "",
    audience: preset?.audiencePlaceholder ? "" : getBrowserEnv().ERP_URL,
    subject: "",
    tokenLifetimeMinutes: FEDERATION_LIMITS.defaultTokenLifetimeMinutes
  };
}

function claimRowsFor(
  provider: FederationProvider | undefined,
  claims: Record<string, string> | null | undefined
): ClaimRow[] {
  const rows = Object.entries(claims ?? {}).map(([claim, value]) => ({
    claim,
    value
  }));
  for (const claim of provider
    ? FEDERATION_PRESETS[provider].suggestedClaims
    : []) {
    if (!rows.some((row) => row.claim === claim)) {
      rows.push({ claim, value: "" });
    }
  }
  return rows;
}

/**
 * The workload fields of a rule, inside a `ValidatedForm` on
 * `federationRuleValidator`. With `fixedIssuer` the issuer was chosen
 * elsewhere (the wizard's first step) and posts as a hidden field.
 */
export function RuleFields({
  initialValues,
  issuers,
  fixedIssuer,
  existingClaims,
  isDisabled
}: {
  initialValues: RuleValues;
  issuers: IssuerOption[];
  fixedIssuer?: IssuerOption;
  existingClaims?: Record<string, string> | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { ERP_URL } = getBrowserEnv();
  const [issuerId, setIssuerId] = useState(
    fixedIssuer?.id ?? initialValues.issuerId
  );
  const issuer = fixedIssuer ?? issuers.find((row) => row.id === issuerId);
  const preset = issuer ? FEDERATION_PRESETS[issuer.provider] : undefined;
  const [audience, setAudience] = useState(initialValues.audience);
  const [claims, setClaims] = useState<ClaimRow[]>(() =>
    claimRowsFor(issuer?.provider, existingClaims)
  );
  // Empty rows are left out: an unfinished row is not a condition.
  const claimsJson = JSON.stringify(
    claims
      .filter((row) => row.claim.trim() || row.value.trim())
      .map((row) => ({ claim: row.claim.trim(), value: row.value.trim() }))
  );

  const onIssuerChange = (nextId: string) => {
    const next = issuers.find((row) => row.id === nextId);
    setIssuerId(nextId);
    if (nextId === initialValues.issuerId) {
      setAudience(initialValues.audience);
    } else if (next) {
      setAudience(
        FEDERATION_PRESETS[next.provider].audiencePlaceholder ? "" : ERP_URL
      );
    }
    setClaims((rows) =>
      claimRowsFor(
        next?.provider,
        Object.fromEntries(
          rows
            .filter((row) => row.value.trim())
            .map((row) => [row.claim, row.value])
        )
      )
    );
  };

  return (
    <VStack spacing={4}>
      <Hidden name="claimConditions" value={claimsJson} />
      <Hidden name="issuerUrl" value={issuer?.issuer ?? ""} />
      {fixedIssuer ? (
        <Hidden name="issuerId" value={fixedIssuer.id} />
      ) : (
        <Select
          name="issuerId"
          label={t`Issuer`}
          options={issuers.map((row) => ({
            value: row.id,
            label: `${row.name} (${row.issuer})`
          }))}
          isReadOnly={isDisabled}
          onChange={(option) => {
            if (option) onIssuerChange(option.value);
          }}
        />
      )}
      <Input
        name="name"
        label={t`Name`}
        placeholder="plm-sync"
        helperText={t`Lowercase letters, numbers and hyphens`}
      />
      <TextArea name="description" label={t`Description`} isOptional />
      <InputControlled
        name="audience"
        label={t`Audience`}
        value={audience}
        onChange={setAudience}
        placeholder={preset?.audiencePlaceholder ?? ERP_URL}
        helperText={t`The workload requests its token for this audience`}
      />
      <Input
        name="subject"
        label={t`Subject`}
        placeholder={preset?.subjectPlaceholder}
        helperText={t`Exact match, or a prefix when it ends in :* or /*`}
      />
      <ClaimConditions
        rows={claims}
        onChange={setClaims}
        isDisabled={isDisabled}
      />
      <Number
        name="tokenLifetimeMinutes"
        label={t`API key lifetime (minutes)`}
        minValue={FEDERATION_LIMITS.minTokenLifetimeMinutes}
        maxValue={FEDERATION_LIMITS.maxTokenLifetimeMinutes}
        helperText={t`Never longer than the workload's own token has left`}
      />
    </VStack>
  );
}

/** The scopes a rule's keys get, posted as the hidden `scopes` field. */
export function RulePermissions({
  companyId,
  existingScopes,
  isDisabled
}: {
  companyId?: string;
  existingScopes?: Record<string, string[]> | null;
  isDisabled: boolean;
}) {
  const initialScopeState = useMemo(
    () => fromApiKeyScopes(existingScopes ?? null, apiKeyPermissionModules),
    [existingScopes]
  );
  const matrix = usePermissionMatrix({
    modules: apiKeyPermissionModules,
    initialState: initialScopeState,
    bulkExcludedKeys: apiKeyOptInPermissionKeys
  });
  const scopesJson = companyId
    ? JSON.stringify(toApiKeyScopes(matrix.permissions, companyId))
    : "{}";

  return (
    <>
      <Hidden name="scopes" value={scopesJson} />
      <PermissionMatrix matrix={matrix} isDisabled={isDisabled} />
    </>
  );
}

function ClaimConditions({
  rows,
  onChange,
  isDisabled
}: {
  rows: ClaimRow[];
  onChange: (rows: ClaimRow[]) => void;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { error } = useField("claimConditions");
  const update = (index: number, patch: Partial<ClaimRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel>
        <Trans>Claim conditions</Trans>
      </FormLabel>
      <VStack spacing={2}>
        {rows.map((row, index) => (
          <HStack key={index} className="w-full">
            <InputBase
              aria-label={t`Claim`}
              placeholder={t`Claim`}
              value={row.claim}
              isDisabled={isDisabled}
              onChange={(e) => update(index, { claim: e.target.value })}
            />
            <InputBase
              aria-label={t`Value`}
              placeholder={t`Value`}
              value={row.value}
              isDisabled={isDisabled}
              onChange={(e) => update(index, { value: e.target.value })}
            />
            <IconButton
              aria-label={t`Remove claim condition`}
              icon={<LuTrash />}
              variant="ghost"
              isDisabled={isDisabled}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            />
          </HStack>
        ))}
        {rows.length < FEDERATION_LIMITS.maxClaimConditions && (
          <Button
            leftIcon={<LuPlus />}
            variant="secondary"
            isDisabled={isDisabled}
            onClick={() => onChange([...rows, { claim: "", value: "" }])}
          >
            <Trans>Add condition</Trans>
          </Button>
        )}
      </VStack>
      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        <FormHelperText>
          <Trans>
            Each condition must equal a claim of the token exactly. For GitHub,
            find repository_owner_id with gh api users/OWNER --jq .id
          </Trans>
        </FormHelperText>
      )}
    </FormControl>
  );
}
