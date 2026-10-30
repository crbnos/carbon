// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";

/**
 * Workload identity federation: an issuer record says which OIDC issuer
 * Carbon trusts and how it gets its keys; a federation rule names one workload
 * of that issuer; `/token` exchanges such a workload's JWT for a short-lived
 * Carbon API key. Spec: .ai/specs/2026-10-30-workload-identity-federation.md
 */

export const federationProviders = [
  "GitHub Actions",
  "AWS",
  "Google Cloud",
  "Microsoft Entra ID",
  "Kubernetes",
  "Custom OIDC"
] as const satisfies readonly Database["public"]["Enums"]["federationProvider"][];

export type FederationProvider = (typeof federationProviders)[number];

export const federationJwksSources = [
  "OIDC Discovery",
  "JWKS URL",
  "Inline JWKS"
] as const satisfies readonly Database["public"]["Enums"]["federationJwksSource"][];

export type FederationJwksSource = (typeof federationJwksSources)[number];

export const GITHUB_ACTIONS_ISSUER =
  "https://token.actions.githubusercontent.com";
export const GITLAB_ISSUER = "https://gitlab.com";
export const GOOGLE_ISSUER = "https://accounts.google.com";
export const TERRAFORM_ISSUER = "https://app.terraform.io";
export const BUILDKITE_ISSUER = "https://agent.buildkite.com";

export const TOKEN_EXCHANGE_GRANT =
  "urn:ietf:params:oauth:grant-type:token-exchange";
export const SUBJECT_TOKEN_TYPES = [
  "urn:ietf:params:oauth:token-type:jwt",
  "urn:ietf:params:oauth:token-type:id_token"
] as const;
export const ISSUED_TOKEN_TYPE =
  "urn:ietf:params:oauth:token-type:access_token";

export const FEDERATION_LIMITS = {
  maxNameLength: 64,
  maxClaimConditions: 10,
  maxValueLength: 512,
  maxDescriptionLength: 500,
  minTokenLifetimeMinutes: 5,
  maxTokenLifetimeMinutes: 60,
  defaultTokenLifetimeMinutes: 15,
  /** A minted key never lives less than this, however close the token is to expiring. */
  minKeyLifetimeSeconds: 60,
  /** An issuer's `maxTokenLifetimeHours`: Azure managed identity tokens live 24 h. */
  minTokenAgeHours: 1,
  maxTokenAgeHours: 24,
  /** A pasted key set holds at most this many keys. */
  maxInlineKeys: 10,
  clockToleranceSeconds: 30,
  /** Exchanges per rule that passed verification: the workload's own budget. */
  exchangesPerMinute: 30,
  /**
   * Attempts per rule and caller IP, before any verification. The rule id is
   * public (it sits in workflow files), so unverified attempts must not spend
   * the workload's budget.
   */
  attemptsPerCallerPerMinute: 60,
  /** The Test step waits this long for the first exchange (Anthropic: 15 min). */
  testWaitMinutes: 15
} as const;

/** A name is a slug: lowercase letters, digits and single hyphens. */
export const FEDERATION_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
  /** Google and Azure tokens carry no `jti`. */
  requireUniqueJti: boolean;
  /** Azure managed identity tokens live up to 24 h. */
  maxTokenLifetimeHours: number;
  /** A suggested issuer name. */
  name: string;
  /** Where the workload runs, for the provider tile. */
  hint: string;
};

export const FEDERATION_PRESETS: Record<FederationProvider, FederationPreset> =
  {
    "GitHub Actions": {
      issuer: GITHUB_ACTIONS_ISSUER,
      issuerLocked: true,
      issuerPlaceholder: GITHUB_ACTIONS_ISSUER,
      subjectPlaceholder: "repo:acme/plm-sync:ref:refs/heads/main",
      suggestedClaims: ["repository_owner_id"],
      audiencePlaceholder: null,
      requireUniqueJti: true,
      maxTokenLifetimeHours: 1,
      name: "github-actions",
      hint: "CI/CD workflows"
    },
    AWS: {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://<id>.tokens.sts.global.api.aws",
      subjectPlaceholder: "arn:aws:iam::123456789012:role/carbon-sync",
      suggestedClaims: [],
      audiencePlaceholder: null,
      requireUniqueJti: true,
      maxTokenLifetimeHours: 1,
      name: "aws",
      hint: "EC2, Lambda, EKS via STS"
    },
    "Google Cloud": {
      issuer: GOOGLE_ISSUER,
      issuerLocked: true,
      issuerPlaceholder: GOOGLE_ISSUER,
      subjectPlaceholder: "112233445566778899000",
      suggestedClaims: ["email"],
      audiencePlaceholder: null,
      requireUniqueJti: false,
      maxTokenLifetimeHours: 1,
      name: "google-cloud",
      hint: "GKE, Cloud Run, GCE"
    },
    "Microsoft Entra ID": {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://sts.windows.net/<tenant-id>/",
      subjectPlaceholder: "<managed identity object id>",
      suggestedClaims: [],
      audiencePlaceholder: "api://<application-id>",
      requireUniqueJti: false,
      maxTokenLifetimeHours: 24,
      name: "microsoft-entra",
      hint: "Azure, Entra ID"
    },
    Kubernetes: {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://kubernetes.default.svc.cluster.local",
      subjectPlaceholder: "system:serviceaccount:carbon:sync",
      suggestedClaims: [],
      audiencePlaceholder: null,
      requireUniqueJti: true,
      maxTokenLifetimeHours: 1,
      name: "kubernetes",
      hint: "Self-managed clusters"
    },
    "Custom OIDC": {
      issuer: null,
      issuerLocked: false,
      issuerPlaceholder: "https://issuer.example.com",
      subjectPlaceholder: "workload:sync",
      suggestedClaims: [],
      audiencePlaceholder: null,
      requireUniqueJti: true,
      maxTokenLifetimeHours: 1,
      name: "custom-oidc",
      hint: "Bring your own issuer"
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
  [TERRAFORM_ISSUER]: {
    label: "HCP Terraform",
    requiredClaim: "terraform_organization_id"
  },
  // organization_id is optional in a Buildkite token: request it with
  // `buildkite-agent oidc request-token --claims organization_id`.
  [BUILDKITE_ISSUER]: {
    label: "Buildkite",
    requiredClaim: "organization_id"
  },
  [GOOGLE_ISSUER]: { label: "Google Cloud", exactSubject: true }
};
