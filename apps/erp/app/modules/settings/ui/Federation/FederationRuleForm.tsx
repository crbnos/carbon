// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getBrowserEnv } from "@carbon/auth";
import {
  FEDERATION_LIMITS,
  FEDERATION_PRESETS,
  type FederationProvider,
  federationProviders,
  federationRuleValidator
} from "@carbon/ee/federation";
import { useField, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  CodeBlock,
  Copy,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input as InputBase,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
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
  Submit
} from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import { usePermissions } from "~/hooks";
import {
  fromApiKeyScopes,
  toApiKeyScopes,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import {
  apiKeyOptInPermissionKeys,
  apiKeyPermissionModules
} from "~/modules/settings/settings.models";
import { currentRefusal } from "~/modules/settings/settings.utils";
import type { FederationRuleRow } from "~/modules/settings/types";
import { path } from "~/utils/path";

type ClaimRow = { claim: string; value: string };

type FederationRuleFormProps = {
  initialValues: {
    id?: string;
    name: string;
    provider: FederationProvider;
    issuer: string;
    audience: string;
    subject?: string;
    tokenLifetimeMinutes: number;
  };
  companyId?: string;
  existingScopes?: Record<string, string[]> | null;
  existingClaims?: Record<string, string> | null;
  /** The saved rule, on edit: its last exchange and its usage example. */
  rule?: FederationRuleRow;
  onClose: () => void;
};

function claimRowsFor(
  provider: FederationProvider,
  claims: Record<string, string> | null | undefined
): ClaimRow[] {
  const rows = Object.entries(claims ?? {}).map(([claim, value]) => ({
    claim,
    value
  }));
  for (const claim of FEDERATION_PRESETS[provider].suggestedClaims) {
    if (!rows.some((row) => row.claim === claim)) {
      rows.push({ claim, value: "" });
    }
  }
  return rows;
}

const FederationRuleForm = ({
  initialValues,
  companyId,
  existingScopes,
  existingClaims,
  rule,
  onClose
}: FederationRuleFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useAction();
  const { ERP_URL } = getBrowserEnv();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !permissions.can("update", "users");

  const [provider, setProvider] = useState<FederationProvider>(
    initialValues.provider
  );
  const [issuer, setIssuer] = useState(initialValues.issuer);
  const [audience, setAudience] = useState(initialValues.audience);
  const [claims, setClaims] = useState<ClaimRow[]>(() =>
    claimRowsFor(initialValues.provider, existingClaims)
  );
  const preset = FEDERATION_PRESETS[provider];

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
  // Empty rows are left out: an unfinished row is not a condition.
  const claimsJson = JSON.stringify(
    claims
      .filter((row) => row.claim.trim() || row.value.trim())
      .map((row) => ({ claim: row.claim.trim(), value: row.value.trim() }))
  );

  const onProviderChange = (next: FederationProvider) => {
    const nextPreset = FEDERATION_PRESETS[next];
    setProvider(next);
    setIssuer(nextPreset.issuer ?? "");
    setAudience(nextPreset.audiencePlaceholder ? "" : ERP_URL);
    setClaims((rows) =>
      claimRowsFor(
        next,
        Object.fromEntries(
          rows
            .filter((row) => row.value.trim())
            .map((row) => [row.claim, row.value])
        )
      )
    );
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          validator={federationRuleValidator}
          method="post"
          action={
            isEditing
              ? path.to.federationRule(initialValues.id!)
              : path.to.newFederationRule
          }
          defaultValues={initialValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Edit Federation Rule</Trans>
              ) : (
                <Trans>New Federation Rule</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                A workload that presents a matching token from its identity
                provider gets a short-lived API key with these scopes.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="scopes" value={scopesJson} />
            <Hidden name="claimConditions" value={claimsJson} />
            <VStack spacing={4}>
              <Select
                name="provider"
                label={t`Provider`}
                options={federationProviders.map((value) => ({
                  value,
                  label: value
                }))}
                onChange={(option) => {
                  if (option) {
                    onProviderChange(option.value as FederationProvider);
                  }
                }}
              />
              <Input name="name" label={t`Name`} />
              <InputControlled
                name="issuer"
                label={t`Issuer URL`}
                value={issuer}
                onChange={setIssuer}
                placeholder={preset.issuerPlaceholder}
                isReadOnly={preset.issuerLocked}
                helperText={t`Must equal the iss claim of the token exactly`}
              />
              <InputControlled
                name="audience"
                label={t`Audience`}
                value={audience}
                onChange={setAudience}
                placeholder={preset.audiencePlaceholder ?? ERP_URL}
                helperText={t`The workload requests its token for this audience`}
              />
              <Input
                name="subject"
                label={t`Subject`}
                placeholder={preset.subjectPlaceholder}
                helperText={t`Exact match, or a prefix when it ends in *`}
              />
              <ClaimConditions
                rows={claims}
                onChange={setClaims}
                isDisabled={isDisabled}
              />
              <Number
                name="tokenLifetimeMinutes"
                label={t`Token lifetime (minutes)`}
                minValue={FEDERATION_LIMITS.minTokenLifetimeMinutes}
                maxValue={FEDERATION_LIMITS.maxTokenLifetimeMinutes}
              />
              <PermissionMatrix matrix={matrix} isDisabled={isDisabled} />
              {rule && <RuleStatus rule={rule} erpUrl={ERP_URL} />}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={() => onClose()}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default FederationRuleForm;

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

function usageExample(rule: FederationRuleRow, erpUrl: string): string {
  const exchange = `curl -s -X POST ${erpUrl}/token \\
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \\
  -d client_id=${rule.id} \\
  -d subject_token_type=urn:ietf:params:oauth:token-type:jwt \\
  -d subject_token="$OIDC_TOKEN"`;

  if (rule.provider !== "GitHub Actions") {
    return `# OIDC_TOKEN: a token from ${rule.issuer} for audience ${rule.audience}
${exchange}`;
  }
  return `permissions:
  id-token: write
steps:
  - name: Get a Carbon API key
    run: |
      OIDC_TOKEN=$(curl -s -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
        "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${encodeURIComponent(rule.audience)}" | jq -r .value)
      KEY=$(${exchange.replace(/\n {2}/g, "\n        ")} | jq -r .access_token)
      echo "::add-mask::$KEY"
      echo "CARBON_API_KEY=$KEY" >> "$GITHUB_ENV"`;
}

function RuleStatus({
  rule,
  erpUrl
}: {
  rule: FederationRuleRow;
  erpUrl: string;
}) {
  const example = usageExample(rule, erpUrl);
  const refusal = currentRefusal(rule);
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
      {refusal && (
        <HStack>
          <span className="text-sm text-muted-foreground">
            <Trans>Last refused exchange:</Trans>
          </span>
          <Badge variant="destructive">{refusal}</Badge>
        </HStack>
      )}
    </VStack>
  );
}
