// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  FEDERATION_LIMITS,
  FEDERATION_PRESETS,
  type FederationJwksSource,
  type FederationProvider,
  federationJwksSources,
  federationProviders
} from "@carbon/ee/federation";
import {
  Alert,
  AlertDescription,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuChevronDown, LuTriangleAlert } from "react-icons/lu";
import {
  Boolean,
  Hidden,
  InputControlled,
  NumberControlled,
  Select,
  TextArea
} from "~/components/Form";

export type IssuerValues = {
  id?: string;
  name: string;
  provider: FederationProvider;
  issuer: string;
  jwksSource: FederationJwksSource;
  discoveryUrl: string;
  jwksUrl: string;
  jwks: string;
  caCertificate: string;
  requireUniqueJti: boolean;
  maxTokenLifetimeHours: number;
};

/** A new issuer's values for a provider, from its preset. */
export function issuerValuesFor(provider: FederationProvider): IssuerValues {
  const preset = FEDERATION_PRESETS[provider];
  return {
    name: preset.name,
    provider,
    issuer: preset.issuer ?? "",
    jwksSource: "OIDC Discovery",
    discoveryUrl: "",
    jwksUrl: "",
    jwks: "",
    caCertificate: "",
    requireUniqueJti: preset.requireUniqueJti,
    maxTokenLifetimeHours: preset.maxTokenLifetimeHours
  };
}

/**
 * The fields of an issuer, inside a `ValidatedForm` on
 * `federationIssuerValidator`. With `provider` set, the provider is chosen
 * elsewhere (the wizard's tiles) and posted as a hidden field.
 */
export default function IssuerFields({
  initialValues,
  provider: fixedProvider,
  isDisabled
}: {
  initialValues: IssuerValues;
  provider?: FederationProvider;
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const [values, setValues] = useState(initialValues);
  const provider = fixedProvider ?? values.provider;
  const preset = FEDERATION_PRESETS[provider];
  const set = (patch: Partial<IssuerValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  const onProviderChange = (next: FederationProvider) => {
    // Back on the saved provider: restore the saved values, so switching away
    // and back never changes how tokens are checked (which revokes keys).
    set(
      next === initialValues.provider
        ? initialValues
        : {
            ...issuerValuesFor(next),
            // A name the reader typed stays; the previous preset's suggestion does not.
            name:
              values.name && values.name !== FEDERATION_PRESETS[provider].name
                ? values.name
                : issuerValuesFor(next).name
          }
    );
  };

  return (
    <VStack spacing={4}>
      <Alert variant="warning">
        <LuTriangleAlert className="size-4" />
        <AlertDescription>
          <Trans>
            The issuer and its key source decide which tokens Carbon accepts.
            Changing either stops the keys its rules already issued. Changes are
            recorded in the audit log.
          </Trans>
        </AlertDescription>
      </Alert>
      {fixedProvider ? (
        <Hidden name="provider" value={fixedProvider} />
      ) : (
        <Select
          name="provider"
          label={t`Provider`}
          options={federationProviders.map((value) => ({
            value,
            label: value
          }))}
          isReadOnly={isDisabled}
          onChange={(option) => {
            if (option) onProviderChange(option.value as FederationProvider);
          }}
        />
      )}
      <InputControlled
        name="name"
        label={t`Name`}
        value={values.name}
        onChange={(name) => set({ name })}
        helperText={t`Lowercase letters, numbers and hyphens. Shown in rules and the audit log.`}
      />
      <InputControlled
        name="issuer"
        label={t`Issuer URL (iss claim)`}
        value={values.issuer}
        onChange={(issuer) => set({ issuer })}
        placeholder={preset.issuerPlaceholder}
        isReadOnly={preset.issuerLocked}
        helperText={t`Must equal the iss claim of the tokens exactly`}
      />
      <Select
        name="jwksSource"
        label={t`JWKS source`}
        options={federationJwksSources.map((value) => ({
          value,
          label: value
        }))}
        onChange={(option) => {
          if (option) set({ jwksSource: option.value as FederationJwksSource });
        }}
        helperText={t`How Carbon gets the issuer's signing keys`}
      />
      {values.jwksSource === "OIDC Discovery" && (
        <InputControlled
          name="discoveryUrl"
          label={t`Discovery base URL`}
          isOptional
          value={values.discoveryUrl}
          onChange={(discoveryUrl) => set({ discoveryUrl })}
          placeholder={t`Same as the issuer URL`}
          helperText={t`Only when the discovery document is not under the issuer URL`}
        />
      )}
      {values.jwksSource === "JWKS URL" && (
        <InputControlled
          name="jwksUrl"
          label={t`JWKS URL`}
          isRequired
          value={values.jwksUrl}
          onChange={(jwksUrl) => set({ jwksUrl })}
          placeholder="https://issuer.example.com/.well-known/jwks.json"
        />
      )}
      {values.jwksSource === "Inline JWKS" && (
        <VStack spacing={1}>
          <TextArea
            name="jwks"
            label={t`Key set (JWKS)`}
            isRequired
            placeholder='{"keys": [ … ]}'
          />
          <p className="text-xs text-muted-foreground">
            <Trans>
              Public keys only. Carbon never fetches them, so update the set
              when the issuer rotates its keys.
            </Trans>
          </p>
        </VStack>
      )}
      {values.jwksSource !== "Inline JWKS" && (
        <VStack spacing={1}>
          <TextArea
            name="caCertificate"
            label={t`CA certificate`}
            isOptional
            placeholder={
              "-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"
            }
          />
          <p className="text-xs text-muted-foreground">
            <Trans>
              A PEM CA to trust when fetching the discovery document and keys,
              for an issuer with a private CA.
            </Trans>
          </p>
        </VStack>
      )}
      <TokenValidation values={values} onChange={(patch) => set(patch)} />
    </VStack>
  );
}

function TokenValidation({
  values,
  onChange
}: {
  values: IssuerValues;
  onChange: (patch: Partial<IssuerValues>) => void;
}) {
  const { t } = useLingui();
  return (
    <Collapsible className="w-full" defaultOpen>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" rightIcon={<LuChevronDown />} className="px-0">
          <Trans>Token validation</Trans>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <VStack spacing={4} className="pt-2">
          <Boolean
            name="requireUniqueJti"
            label={t`Enforce single-use tokens (jti replay protection)`}
            value={values.requireUniqueJti}
            onChange={(requireUniqueJti) => onChange({ requireUniqueJti })}
            description={t`Each token's jti can be exchanged once. Turn off only for an issuer that does not set jti, such as Google Cloud and Microsoft Entra ID.`}
          />
          <NumberControlled
            name="maxTokenLifetimeHours"
            label={t`Maximum token lifetime (hours)`}
            value={values.maxTokenLifetimeHours}
            onChange={(maxTokenLifetimeHours) =>
              onChange({ maxTokenLifetimeHours })
            }
            minValue={FEDERATION_LIMITS.minTokenAgeHours}
            maxValue={FEDERATION_LIMITS.maxTokenAgeHours}
            helperText={t`Tokens whose exp − iat is longer are refused. Microsoft Entra ID needs 24.`}
          />
        </VStack>
      </CollapsibleContent>
    </Collapsible>
  );
}
