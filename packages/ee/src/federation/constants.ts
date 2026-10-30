// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";

/**
 * Workload identity federation: a federation rule trusts the OIDC JWTs one
 * issuer signs for one workload, and `/token` exchanges such a JWT for a
 * short-lived Carbon API key. Spec: .ai/specs/2026-10-30-workload-identity-federation.md
 */

export const federationProviders = [
  "GitHub Actions",
  "AWS",
  "Google Cloud",
  "Microsoft Entra ID",
  "Custom OIDC"
] as const satisfies readonly Database["public"]["Enums"]["federationProvider"][];

export type FederationProvider = (typeof federationProviders)[number];

export const GITHUB_ACTIONS_ISSUER =
  "https://token.actions.githubusercontent.com";
export const GITLAB_ISSUER = "https://gitlab.com";
export const GOOGLE_ISSUER = "https://accounts.google.com";

export const TOKEN_EXCHANGE_GRANT =
  "urn:ietf:params:oauth:grant-type:token-exchange";
export const SUBJECT_TOKEN_TYPES = [
  "urn:ietf:params:oauth:token-type:jwt",
  "urn:ietf:params:oauth:token-type:id_token"
] as const;
export const ISSUED_TOKEN_TYPE =
  "urn:ietf:params:oauth:token-type:access_token";

export const FEDERATION_LIMITS = {
  maxClaimConditions: 10,
  maxValueLength: 512,
  minTokenLifetimeMinutes: 5,
  maxTokenLifetimeMinutes: 60,
  defaultTokenLifetimeMinutes: 15,
  /** The longest `exp − iat` an incoming JWT may claim: Azure managed identity tokens live 24 h. */
  maxJwtLifetimeSeconds: 24 * 60 * 60,
  clockToleranceSeconds: 30,
  exchangesPerMinute: 30
} as const;

export type FederationPreset = {
  /** Filled into the form; null when each customer has their own issuer. */
  issuer: string | null;
  /** The issuer is the same for every customer, so the form does not let it change. */
  issuerLocked: boolean;
  issuerPlaceholder: string;
  subjectPlaceholder: string;
  /** Claim conditions the form adds as empty rows for the admin to fill. */
  suggestedClaims: string[];
  /** The audience is a value the customer owns (Entra), not Carbon's URL. */
  audiencePlaceholder: string | null;
};

export const FEDERATION_PRESETS: Record<FederationProvider, FederationPreset> =
  {
    "GitHub Actions": {
      issuer: GITHUB_ACTIONS_ISSUER,
      issuerLocked: true,
      issuerPlaceholder: GITHUB_ACTIONS_ISSUER,
      subjectPlaceholder: "repo:acme/plm-sync:ref:refs/heads/main",
      suggestedClaims: ["repository_owner_id"],
      audiencePlaceholder: null
    },
    AWS: {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://<id>.tokens.sts.global.api.aws",
      subjectPlaceholder: "arn:aws:iam::123456789012:role/carbon-sync",
      suggestedClaims: [],
      audiencePlaceholder: null
    },
    "Google Cloud": {
      issuer: GOOGLE_ISSUER,
      issuerLocked: true,
      issuerPlaceholder: GOOGLE_ISSUER,
      subjectPlaceholder: "112233445566778899000",
      suggestedClaims: ["email"],
      audiencePlaceholder: null
    },
    "Microsoft Entra ID": {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://login.microsoftonline.com/<tenant-id>/v2.0",
      subjectPlaceholder: "<managed identity object id>",
      suggestedClaims: [],
      audiencePlaceholder: "api://<application-id>"
    },
    "Custom OIDC": {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://issuer.example.com",
      subjectPlaceholder: "system:serviceaccount:carbon:sync",
      suggestedClaims: [],
      audiencePlaceholder: null
    }
  };

/**
 * Issuers that sign tokens for every customer. A rule on one must name a
 * workload by a claim that never changes when a name does: a renamed GitHub
 * owner can be re-registered by someone else (PyPI, npm "SlugFest"), and
 * Google's `email` can be reused, so Google needs the numeric `sub` exactly.
 */
export const SHARED_ISSUER_REQUIREMENTS: Record<
  string,
  { label: string; requiredClaim?: string; exactSubject?: boolean }
> = {
  [GITHUB_ACTIONS_ISSUER]: {
    label: "GitHub Actions",
    requiredClaim: "repository_owner_id"
  },
  [GITLAB_ISSUER]: { label: "GitLab.com", requiredClaim: "namespace_id" },
  [GOOGLE_ISSUER]: { label: "Google Cloud", exactSubject: true }
};
