# Workload Identity Federation Research: Best Practices Survey

## Summary

This survey asks one question. How do other products let a CI job or a cloud
workload call their API with no stored key? In all of them, the workload gets
a short-lived OIDC JWT from its own identity provider (IdP). The workload sends
the JWT to the product. The product checks the JWT against a trust record that
an admin set up, and returns its own short-lived token. We surveyed 3 groups of
products, listed under Competitors Surveyed: API platforms, package registries,
and cloud IAM with ERPs. The products agree on the core model. They differ on the wire
protocol, on how the product picks the trust record, and on replay protection.
The registries supply the most useful security lessons, because 3 of them had
public incidents.

## Competitors Surveyed

- **SAP Cloud Identity Services (IAS)** — the required enterprise reference. Its
  "Configure Trust by Issuer" is the SAP equivalent.
- **Databricks, Pulumi, Tailscale, Snowflake, Vercel** — other developer APIs
  that accept an external OIDC JWT in place of a key.
- **Anthropic** — the product in the user's screenshot. The most complete
  design, with the deepest documentation.
- **OpenAI** — the second API platform with the same feature, built in parallel.
- **PyPI, npm, crates.io, RubyGems** — "trusted publishing". The oldest public
  precedent, with open source code and public incident reports.
- **Google Cloud, AWS, Microsoft Entra** — the IdPs that Carbon's customers
  will use. Their docs define the token each workload can send.
- **HashiCorp Vault** — the reference for self-hosted and air-gapped setups.
- **NetSuite, Business Central, Oracle Fusion** — ERP peers, for how ERP APIs
  authenticate machine clients today.

## Key Consensus Patterns

### 1. A trust record holds issuer, audience and claim conditions

- **SAP**: a trust holds Issuer, JWKS URI, Subject (exact), optional Audience
  and API permission groups. SAP caps it at 20 trusts per application.
- **Anthropic**: a federation issuer holds the issuer URL and the key source. A
  federation rule holds the match block, the target service account, the scope
  and the token lifetime.
- **OpenAI**: a workload identity provider holds the issuer and the audience. A
  service account mapping holds the claim conditions and the target.
- **Google Cloud, AWS, Entra, Vault**: the same 3 parts, under the names pool
  provider, trust policy, federated identity credential (FIC) and role.
- **Rationale**: the issuer says who signed the JWT. The audience says the JWT
  was made for this product. The claim conditions say which workload sent it.

### 2. Exact match by default, a trailing wildcard at most

- **SAP and Entra**: exact `sub` only. Entra compares case-sensitively.
- **Anthropic**: `subject_prefix` is exact, or a prefix when it ends in `*`.
  Anthropic adds a claims map (exact values) and an optional CEL condition.
- **OpenAI**: exact values, or a trailing `*` after a non-empty prefix.
- **AWS, Vault**: `StringLike` and `glob` are opt-in.
- **Rationale**: a wildcard in the middle of a value is easy to get wrong.
  RubyGems had a regex DoS (GHSA-p37h-pvp2-fh88) and now caps a policy at 5
  statements and 10 conditions.

### 3. A rule must name a workload, not only an issuer

- **Anthropic**: refuses a rule with only an audience. It needs a subject, a
  claims map or a condition.
- **OpenAI**: refuses a bare `*`.
- **AWS**: refuses a trust policy on GitHub, GitLab, Terraform Cloud or Vercel
  without a tenancy claim (`MalformedPolicyDocument`).
- **Google Cloud**: says that a shared issuer "requires an attribute condition
  to prevent token spoofing".
- **Rationale**: GitHub, GitLab.com and `accounts.google.com` sign JWTs for
  every customer. An issuer-only rule accepts every customer's workload.

### 4. Bind to an immutable id, at setup time

- **PyPI**: stores `repository_owner_id` when the user adds the publisher and
  checks it on every exchange. Without it, a renamed GitHub owner could be
  re-registered by an attacker.
- **npm**: stored the id only after the first publish. The "SlugFest" report
  (October 2026) found more than 1,500 exposed packages. npm now expires an
  unused configuration after 48 hours.
- **GitHub**: from 15 July 2026, new repos get an immutable `sub` format
  (`repo:owner@<id>/repo@<id>:…`).
- **Google Cloud**: match the numeric `sub`, never the email.
- **Rationale**: "A name that can be released and reclaimed is not an identity."

### 5. A dedicated audience

- **Anthropic** `https://api.anthropic.com`, **OpenAI** `https://api.openai.com/v1`,
  **PyPI** `pypi`, **npm** `npm:registry.npmjs.org`.
- **Tailscale**: one audience per trust record (`api.tailscale.com/<client id>`).
- **Entra**: the audience is an app registration in the customer's own tenant
  (`api://<APP_ID>`). The receiver must accept that value.
- **Rationale**: an audience check stops a JWT made for another service from
  working here. Snowflake warns that its shared default audience lets one
  account's JWT reach another account.

### 6. Exchange for the product's own short-lived token

- Every product returns its own token. None accepts the IdP's JWT as the API
  credential.
- Lifetimes: PyPI 15 min, RubyGems 15 min, crates.io 30 min, OpenAI 1 h at
  most, SAP and Entra 1 h, Anthropic 1 h by default (60 s to 24 h).
- No product returns a refresh token. The workload exchanges a fresh JWT.
- **Rationale**: the product controls the scope and the lifetime of what it
  accepts. A stolen token is useless after minutes.

### 7. Discovery, a cached key set, and strict JWT checks

- Every product reads `{iss}/.well-known/openid-configuration`, then `jwks_uri`.
- PyPI and crates.io cache the key set and refresh on an unknown `kid`, with a
  60 s cooldown and a 5 s timeout. RubyGems refuses a `jwks_uri` on a host
  other than the issuer's host.
- Anthropic, Google Cloud and crates.io require `kid`. Anthropic refuses `HS*`
  and `none`. Leeway is 30 s (Anthropic, PyPI) or 60 s (crates.io).
- Anthropic refuses a JWT whose `exp − iat` passes a limit per issuer (1 h by
  default). Azure managed identity tokens can live 24 h, so an Azure issuer
  needs a higher limit.
- **Rationale**: a fixed algorithm list and a required `kid` close known JWT
  attacks. The cache keeps the product fast and keeps the IdP load low.

### 8. Single-use JWTs

- PyPI, crates.io and RubyGems record each `jti` until `exp` + leeway. A second
  use fails.
- Anthropic checks `jti` by default. OpenAI makes it an admin toggle.
- crates.io calls the record lifetime "a security invariant". If the record
  expires before the leeway ends, an attacker can replay the JWT.

### 9. Private and air-gapped issuers

- **Anthropic**: an issuer or JWKS URL must be https on port 443 with a public
  DNS name. It refuses IP literals. An `inline` key set or an explicit JWKS URL
  is the exception for private clusters.
- **Google Cloud, Vault, OCI**: accept a pasted key set.
- **AWS, Entra, SAP**: accept only a reachable URI.
- **Rationale**: the product fetches a URL the customer typed, so that fetch is
  an SSRF risk. No vendor except Anthropic documents the guard.

## Answers to Research Questions

1. **What is the configuration entity, and what fields does it hold?** — An
   issuer URL, an audience, claim conditions, a target identity, a scope and a
   token lifetime (Anthropic, OpenAI, SAP, Google Cloud). Anthropic splits the
   issuer into its own record. OpenAI and RubyGems keep one record per rule.
2. **How does the client exchange the JWT?** — A POST to a token endpoint.
   OpenAI, Google Cloud, Databricks, Pulumi, Vercel and SAP use RFC 8693 token
   exchange. Anthropic uses the RFC 7523 `jwt-bearer` grant. PyPI, crates.io,
   RubyGems and Tailscale use a custom JSON body.
3. **How does the product find the right trust record?** — Anthropic and
   Tailscale make the client name it (`federation_rule_id`, `client_id`).
   OpenAI and Vercel search every rule and fail when more than 1 matches. When
   the issuer is shared by many customers, the product cannot find the tenant
   without a name from the client.
4. **What does the exchanged token act as?** — A non-human principal in every
   API platform: a service account (Anthropic, OpenAI, Google Cloud), a service
   principal (Databricks, Entra), a role (AWS) or a service user (Snowflake).
   The registries mint a token for the user who owns the binding (RubyGems
   roles) or for the project (PyPI).
5. **How does each workload get its JWT?** — GitHub Actions: `id-token: write`
   and `ACTIONS_ID_TOKEN_REQUEST_URL`. Google Cloud: the metadata server
   identity endpoint. Azure: IMDS with `resource=<App ID URI>`. AWS:
   `sts:GetWebIdentityToken`, available since November 2025 after an admin turns
   on outbound identity federation. Each AWS account has its own issuer URL.
6. **How do the products show what happened?** — Anthropic keeps an
   authentication history with the real deny reason and returns an opaque
   `401` to the caller. PyPI records each mint on the project's security
   history page. RubyGems stores every JWT's claims and emails the user.
   crates.io emails every owner when someone adds or removes a binding.

## Competitor-Specific Details

### SAP Cloud Identity Services

"Configure Trust by Issuer" sits under Trust → Application APIs → Client
Authentication → JSON Web Tokens. The external JWT is the `client_assertion` on
`/oauth2/token`. SAP accepts it with `client_credentials`, `jwt-bearer` and RFC
8693 token exchange. The token lasts 3600 s. SAP has no pasted key set and no
documented wildcards. SAP S/4HANA itself authenticates machine clients through
communication users (password, X.509 or OAuth). SAP does not use the term
"workload identity federation".

### Anthropic

Settings → Workload identity → **Connect workload**. Provider tiles fill in the
fields: GitHub Actions, AWS, Google Cloud, Microsoft Entra ID, Kubernetes and
Custom OIDC. "Verify issuer" does a dry-run fetch of the key set. After setup
the wizard waits up to 15 minutes for the first successful exchange. The SDK
exchanges and refreshes on its own, at expiry − 120 s and at expiry − 30 s.

### OpenAI

The endpoint is `POST https://auth.openai.com/oauth/token` with
`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`. The request
names `identity_provider_id` and `service_account_id`. OpenAI caps 50 providers
per organization and 50 mappings per provider. The token cannot call the Admin
API.

### PyPI

The endpoint `POST /_/oidc/mint-token` returns a 900 s macaroon. PyPI refuses
JWTs from the `pull_request_target` and `issue_comment` triggers. In December
2024 the Ultralytics attack published through a legitimate trusted publisher
after cache poisoning. A second round of releases used a leftover API token.
PyPI's advice: revoke old tokens once federation works.

### npm

npm accepts only GitHub-hosted runners, GitLab.com shared runners and CircleCI
cloud. Every field must match exactly, case-sensitive. A package can have 10
trusted publishers. A "stage-only" publisher needs a human 2FA approval.

### crates.io

The minted token has the prefix `cio_tp_`. crates.io stores only its SHA-256.
The token lives 30 minutes, and a workflow can revoke it with `DELETE`. The
`trustpub_used_jtis` table holds each `jti` until `exp` + 60 s.

### RubyGems "OIDC API key roles"

This is the closest match to Carbon. It is a general feature, not only for
publishing. A user owns a role. The role holds a provider, an allow/deny policy
over claims, the API key scopes and `valid_for` (5 minutes to 1 day, default 30
minutes). An admin-only table holds the allowed issuers. The exchange mints an
ordinary RubyGems API key for the role's owner. The key carries the role's
scopes and lifetime.

### Google Cloud

The provider holds `issuerUri`, up to 10 `allowedAudiences` and an optional
`jwksJson`. The attribute condition is one CEL expression of up to 4,096
characters. Google refuses an `iat` older than 24 hours. The metadata server
signs identity tokens with `iss=https://accounts.google.com` for every Google
customer, so the receiver must bind on the numeric `sub`.

### AWS

`sts:GetWebIdentityToken` takes 1 to 10 audiences, `RS256` or `ES384`, and a
lifetime of 60 to 3600 s (default 300). The JWT `sub` is the role ARN. The
namespace `https://sts.amazonaws.com/` holds `aws_account`, `org_id` and
`principal_tags`. The API is not on the STS global endpoint.

### Microsoft Entra

A FIC holds `issuer`, `subject` (exact) and exactly 1 audience. An app or a
managed identity holds up to 20 FICs. A workload on an Azure VM gets a token
for Carbon only when the customer's tenant has an app registration for that
audience.

### HashiCorp Vault

A role needs at least 1 bound value. `bound_claims_type` is `string` or `glob`.
`jwt_validation_pubkeys` holds pasted keys for an issuer that Vault cannot
reach. Default leeways are 60 s for clock skew and 150 s for `exp` and `nbf`.

### NetSuite, Business Central, Oracle Fusion

None documents OIDC federation for its API. NetSuite uses OAuth 2.0 client
credentials with an uploaded certificate. Its tokens last 60 minutes.
Business Central uses Entra client credentials, so an Entra FIC probably works
there. That is an inference, not a documented fact. Oracle's OCI IAM has an
"Identity Propagation Trust" (RFC 8693) with a pasted-certificate option.

## Recommended Approach for Carbon

1. **Mint an ordinary Carbon API key that expires in minutes.** RubyGems does
   this. The Carbon database already resolves the `carbon-key` header through
   `apiKey.keyHash`. Rate limits, scopes, expiry and `lastUsedAt` all key on
   an `apiKey` row. A short-lived `apiKey` row works on v1, MCP and PostgREST
   with no new token format.
2. **Make the client name the rule.** Anthropic and Tailscale do this. GitHub
   and Google sign JWTs for every customer, so Carbon cannot find the company
   from the JWT alone.
3. **Use RFC 8693 token exchange on the existing `/token` endpoint.** OpenAI,
   Google Cloud, Databricks, Pulumi and SAP use it. Standard OAuth libraries
   send it. Carbon's `/token` already dispatches on `grant_type` and is already
   exempt from the CSRF check.
4. **Match the subject exactly, or by prefix with a trailing `*`, plus exact
   claim conditions.** Anthropic and OpenAI do this. Refuse a rule with no
   subject and no claim condition. Leave CEL out.
5. **Require an immutable id for shared issuers.** The GitHub preset requires
   `repository_owner_id` (PyPI, AWS). The Google preset requires an exact
   numeric `sub` and refuses a prefix (Google Cloud, Anthropic).
6. **Accept any https issuer, with Anthropic's SSRF guard.** AWS gives each
   account its own issuer and Entra gives each tenant its own, so a fixed list
   cannot work. Presets in the UI fill in the known issuers.
7. **Check the JWT strictly.** Require `kid`, `iss`, `aud`, `sub`, `iat`, `exp`.
   Refuse `HS*` and `none`. Use 30 s leeway. Record each `jti` until `exp` + leeway.
8. **Return an opaque error and record the reason on the rule.** Anthropic
   does this. The admin sees the last failure reason. The caller learns
   nothing about the rule.
9. **Default the token lifetime to 15 minutes, with a 1 hour maximum.** PyPI,
   RubyGems and OpenAI fall in this range.
10. **Leave out pasted key sets for v1.** Only air-gapped installs need them.
    The run record decided Cloud first.

## Sources

- https://platform.claude.com/docs/en/manage-claude/workload-identity-federation
- https://platform.claude.com/docs/en/manage-claude/wif-reference
- https://platform.claude.com/docs/en/manage-claude/wif-providers/aws
- https://platform.claude.com/docs/en/manage-claude/wif-providers/github-actions
- https://platform.claude.com/docs/en/manage-claude/wif-providers/gcp
- https://platform.claude.com/docs/en/manage-claude/wif-providers/azure
- https://developers.openai.com/api/docs/guides/workload-identity-federation
- https://developers.openai.com/api/reference/workload-identity-federation
- https://developers.openai.com/api/docs/guides/workload-identity-federation/federation-rules
- https://docs.snowflake.com/en/user-guide/workload-identity-federation
- https://vercel.com/docs/oidc
- https://docs.databricks.com/aws/en/dev-tools/auth/oauth-federation-policy
- https://docs.databricks.com/aws/en/dev-tools/auth/oauth-federation-exchange
- https://www.pulumi.com/docs/administration/access-identity/oidc-client/
- https://tailscale.com/kb/1581/workload-identity-federation
- https://docs.pypi.org/trusted-publishers/internals/
- https://docs.pypi.org/trusted-publishers/security-model/
- https://github.com/pypi/warehouse/blob/main/warehouse/oidc/services.py
- https://github.com/pypi/warehouse/blob/main/warehouse/oidc/models/github.py
- https://blog.trailofbits.com/2023/05/23/trusted-publishing-a-new-benchmark-for-packaging-security/
- https://blog.pypi.org/posts/2024-12-11-ultralytics-attack-analysis/
- https://repos.openssf.org/trusted-publishers-for-all-package-repositories
- https://docs.npmjs.com/trusted-publishers
- https://github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire
- https://startwithidentity.com/blog/2026-10-13-npm-trusted-publishing-slugfest-let-reclaimed-repo-names-publish-packages.md
- https://github.com/rust-lang/crates.io/blob/main/src/controllers/trustpub/tokens/exchange/mod.rs
- https://github.com/rust-lang/crates.io/blob/main/crates/crates_io_trustpub/src/lib.rs
- https://github.com/rubygems/rubygems.org/blob/master/app/models/oidc/api_key_role.rb
- https://github.com/rubygems/rubygems.org/blob/master/app/models/oidc/access_policy.rb
- https://github.com/rubygems/rubygems.org/security/advisories/GHSA-p37h-pvp2-fh88
- https://github.com/rubygems/rubygems.org/security/advisories/GHSA-48p7-6mjr-3jjj
- https://github.com/SAP-docs/btp-cloud-identity-services/blob/main/docs/Operation-Guide/configure-jwt-for-oauth-client-authentication-db97a69.md
- https://github.com/SAP-docs/btp-cloud-identity-services/blob/main/docs/Operation-Guide/configure-the-client-to-call-identity-authentication-token-exchange-632df37.md
- https://docs.cloud.google.com/iam/docs/workload-identity-federation
- https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation
- https://docs.cloud.google.com/compute/docs/instances/verifying-instance-identity
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc_secure-by-default.html
- https://docs.aws.amazon.com/STS/latest/APIReference/API_GetWebIdentityToken.html
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_outbound_token_claims.html
- https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-considerations
- https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/how-to-use-vm-token
- https://developer.hashicorp.com/vault/api-docs/auth/jwt
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162755359851.html
- https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication
- https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/json_web_token_exchange.htm
- https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/
