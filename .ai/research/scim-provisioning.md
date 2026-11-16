# SCIM 2.0 Provisioning Research: Best Practices Survey

Date: 2026-10-30. Sibling feature: SAML SSO (`.ai/research/sso.md`,
`.ai/specs/2026-08-21-enterprise-saml-sso.md`).

## Summary

This file describes how Okta and Microsoft Entra ID call a custom SCIM 2.0 app.
It also covers the IdP licences a customer needs and how seven B2B products
design provisioning. The last part maps the findings onto Carbon's code.

The main findings:

1. A Carbon SCIM server must accept PUT and PATCH. Okta's custom (AIW) apps
   send PUT for every update, deactivation included. Entra sends PATCH.
2. Neither IdP deletes a user on first offboarding. Both send `active: false`.
   Entra sends DELETE only 30 days later, on hard delete. Okta never sends
   DELETE for users.
3. Every product surveyed keeps the person's content and turns off access.
   Most products put SCIM on their top plan.
4. Carbon can end a user's sessions with the public GoTrue `/logout` endpoint.
   So SCIM needs no `auth` schema write, and it can run on hosted Supabase.

## Competitors Surveyed

- **SAP S/4HANA Cloud** — the enterprise reference. It takes provisioning
  through SAP Cloud Identity Services, not straight from the customer IdP.
- **Okta** — the most common IdP for B2B SaaS buyers.
- **Microsoft Entra ID** — the second common IdP. It has the most protocol
  quirks.
- **Google Workspace** — checked for custom SCIM support.
- **Linear** — a close match: workspace SCIM, groups map to teams and roles.
- **Slack** — org and workspace scope, the "billable at first sign-in" rule.
- **GitHub Enterprise** — the only product that documents token revocation.
- **Notion** — the simplest model: one token per workspace, a `role` attribute.
- **Atlassian Cloud (Guard)** — groups that hold app access.
- **Salesforce** — profile and permission sets as SCIM entitlements.

## Key Consensus Patterns

### 1. `active: false` turns access off; content stays

- **SAP**: deactivation sets the user disabled or locked, with validity
  dates. Deletes are off unless the admin sets
  `ips.delete.existedbefore.entities`.
- **Okta**: deactivation and unassignment send `active: false`. Okta never
  sends DELETE for users.
- **Entra**: unassign, out of scope, disable and soft delete send
  `active: false`. DELETE comes after the 30-day hard delete.
- **Slack, Notion, Atlassian, Salesforce**: DELETE deactivates too. None of
  them deletes the person's content.
- **GitHub EMU**: the one exception. DELETE is a hard deprovision that deletes
  tokens, keys and repositories.
- **Rationale**: an ERP keeps an audit trail. A person's records must keep
  their author after the person leaves.

### 2. SCIM is a top-plan feature, often tied to SSO or a verified domain

- **SAP**: needs a Cloud Identity Services tenant.
- **Linear**: Enterprise plan, and only with SAML on.
- **Slack**: Business+ and Enterprise.
- **Notion, GitHub**: Enterprise plans.
- **Atlassian**: Guard Standard. Account linking needs a verified domain.
- **Salesforce**: all editions. It is the exception.
- **Rationale**: the buyer of SCIM is an enterprise IT team. It already pays
  for an IdP plan with provisioning.

### 3. Groups decide access; a user in no mapped group gets the lowest normal role

- **SAP**: an IdP group maps to an existing business role. The group name
  equals the business role ID.
- **Linear**: groups map to teams. Three special groups (`linear-owners`,
  `linear-admins`, `linear-guests`) set the role. Everyone else is a Member.
- **Atlassian, Salesforce**: a group or entitlement holds the permissions.
- **GitHub, Notion, Slack**: a `roles` or `role` attribute on the user sets
  the role. Groups map to teams or channels.
- **Rationale**: IT teams already model access as groups. Group push is the
  one mechanism that Okta and Entra both support for this.

### 4. The IdP owns the identity fields; the admin cannot fight it

- **Linear, Atlassian**: admins cannot edit SCIM-managed users. Linear has a
  temporary override to suspend a user.
- **Slack, GitHub**: they lock the synced profile fields, name and email.
- **Notion**: name and email change only for a verified domain.
- **Rationale**: if both sides can write a field, the next push silently
  undoes the admin's change.

### 5. Seats follow active users

- **Linear, Slack**: a SCIM-created user becomes billable at the first sign-in.
- **Notion, GitHub**: a provisioned user is billable at once. A suspended user
  takes no seat.
- **Atlassian, Salesforce**: a deactivated user frees the seat.
- **Rationale**: no product caps auto-provisioning. They bill for it, and
  deactivation gives the seat back.

### 6. One token per tenant, shown once, rotated by an owner

- **Notion**: one token per workspace. Only an owner makes it. Notion shows it
  once.
- **Atlassian**: the API key is shown once, expires after 1 year, and
  regenerating it kills the old key.
- **Linear**: a bearer token in settings.
- **GitHub**: a classic PAT with the `scim:enterprise` scope and no expiry.
- **Rationale**: both IdPs store one static bearer token for a custom app.

## Answers to Research Questions

1. **What does Okta send on the first sync?**
   1. `GET /Users?filter=userName eq "x"&startIndex=1&count=100`.
   2. If nothing matches, `POST /Users` with `userName`, `name`, `emails`,
      `displayName`, `externalId`, `active` and a placeholder `password`.
   3. If a user matches, Okta links to it and sends the profile as an update.

   Okta documents only `userName eq` (users) and `displayName eq` (groups).
   Import pages with integer `startIndex` and `count`. The page order must be
   stable.

2. **What does Entra send on the first sync?** `GET /Users?filter=userName eq "x"`.
   The admin can change the matching attribute. The default fields are
   `userName` and `externalId`. Then `POST /Users`. Entra uses only the `eq`
   and `and` operators. **Test Connection** filters on a random GUID and
   expects `200` with an empty `ListResponse`. Incremental cycles run about
   every 40 minutes.

3. **What update shapes does Carbon have to accept?**

   | IdP / app type | Profile update | Deactivate | Group members |
   |---|---|---|---|
   | Okta custom (AIW) app | PUT | PUT, full object, `active: false` | PUT, full `members` list |
   | Okta OIN app | PUT | PATCH `replace`, no `path`, `{"active": false}` | PATCH `add` / `remove` / `replace` |
   | Entra, default | PATCH | PATCH `Replace`, `path: active`, value `"False"` (a string) | PATCH `Add` / `Remove` with a `value` array |
   | Entra, `aadOptscim062020` flag | PATCH, one `replace` with no `path` and dotted keys | PATCH `replace` with boolean `false` | PATCH `remove` with `path: members[value eq "id"]` |

   Carbon must read `op` without case. It must read `"True"` / `"False"`
   strings as booleans. It must accept a value object with dotted keys
   (`name.givenName`) and filtered paths (`emails[type eq "work"].value`).
   Okta sends up to 1000 members in one group request.

4. **Does either IdP DELETE users?** Okta never does. Entra does, 30 days
   after a soft delete, or at once on a permanent delete. After an Entra
   unassign, Entra stops managing the user, so a later delete sends nothing.
   Entra expects `GET /Users/{id}` to return an inactive user. It expects 404
   only after a hard delete.

5. **How does group push work?**
   1. `GET /Groups?filter=displayName eq "name"`. Entra adds
      `excludedAttributes=members`.
   2. On an exact name match, Okta links the groups.
   3. If nothing matches, `POST /Groups` with `displayName` and `members: []`.
   4. Member changes come as PATCH (Entra, Okta OIN) or PUT (Okta AIW).

   Okta sends `DELETE /Groups/{id}` only when the admin unlinks the group and
   picks "Delete the group in the target app".

6. **What responses do the IdPs expect?**
   - `201` and the resource on create.
   - `409` with an `Error` body on a duplicate `userName`.
   - `404` with an `Error` body for an unknown id.
   - `401` with an `Error` body for a bad token.
   - `200` and a `ListResponse` with `totalResults: 0` for a filter with no
     match.
   - `Content-Type: application/scim+json`, HTTPS.

   `userName` compares without case (RFC 7643 §4.1.1). The `id` is
   case-sensitive and read-only. Okta's base URL must not contain `_`.

7. **How do the IdPs retry?** Okta pauses on `429`, waits `Retry-After`
   seconds (5 minutes if the header is missing), doubles the wait, and stops
   after 10 attempts. Okta does not retry other errors. Entra retries a failed
   operation in the next cycle. Credential errors and SCIM compliance errors
   put the Entra job in quarantine. Entra runs about 5–10 requests in
   parallel. Okta sends them one at a time.

8. **Which IdP plans does a customer need?**

   | IdP | Custom-app provisioning | Group-based provisioning |
   |---|---|---|
   | Okta | Lifecycle Management: an add-on to Starter, included in Essentials and above | Included with Lifecycle Management |
   | Entra ID | Free (direct user assignment, no provisioning logs) | P1 or P2 |
   | Google Workspace | Beta only: "automated user provisioning with custom SCIM profiles", for a limited number of participants, bearer token only | Not documented for the beta |
   | JumpCloud | "Custom SCIM" integration | Yes |
   | OneLogin | "SCIM Provisioner with SAML (SCIM v2 Core)" connector | Yes |

   Okta does not support SCIM on a custom OIDC app. The customer starts from
   a SAML or SWA app.

9. **How do comparable products map groups to roles?** See pattern 3. An
   unmapped user gets the lowest normal role (Linear, Notion: Member).

10. **What can an admin still edit by hand?** See pattern 4. Linear keeps a
    suspend override. The other products lock the synced fields.

11. **How do products treat multi-workspace users?** Slack Enterprise
    deactivates at the org level. Removal from a workspace does not deactivate
    the org account. GitHub org-level SCIM removes org access only and keeps
    the personal account. A Carbon user is like a GitHub personal account, and
    a Carbon company is like a GitHub org.

12. **How do products match existing users on the first sync?** By email.
    Linear, Notion and Atlassian accept it only for a verified domain. Slack
    refuses a duplicate email, even for a deactivated user. GitHub EMU creates
    new accounts, so it never matches.

13. **What happens to API tokens?** Only GitHub documents it. Soft deprovision
    keeps the tokens. Hard deprovision deletes them. The other products do not
    document it.

14. **How do we test?**
    - **Okta SCIM 2.0 Spec Test** (Runscope/BlazeMeter): paged `GET /Users`,
      `GET /Users/{id}`, an unknown filter with 0 results, an unknown id with
      404, a create with 201, a duplicate with 409, a case check, and a bad
      token with 401. At least one user must exist first.
    - **Okta CRUD test**: 13 steps against a real Okta org. Create, assign,
      update, deactivate, reactivate, unassign.
    - **Okta Integrator Free Plan**: a free org that Okta lists for SCIM
      testing.
    - **Microsoft SCIM Validator** (scimvalidator.microsoft.com): create, 409
      on a duplicate, PATCH add and replace, PATCH `active` false, group create
      and member add. No soft-delete tests.
    - **Entra Provision on demand**: one user, or one group with up to 5
      members, in under 30 seconds. It cannot test disable or delete.
    - **Microsoft 365 Developer Program E5 sandbox**: free with Entra P1 and
      P2, but only for qualified members, for up to 90 days.

## Competitor-Specific Details

### SAP S/4HANA Cloud

SAP takes no SCIM from the customer IdP. The IdP feeds SAP Cloud Identity
Services. Its Identity Provisioning service then pushes users to S/4HANA
through the communication scenario `SAP_COM_0193`. A business user can exist
only for an existing worker record. Groups map to business roles by name.

### Okta

Okta stores the SCIM `id` that Carbon returns. Before a PUT, Okta sends
`GET /Users/{id}` and then the whole object. A user that Okta suspends gets no
request. Okta sends `active: false` only when the admin turns on "Deactivate
Users". The four AIW toggles are "Import New Users and Profile Updates",
"Push New Users", "Push Profile Updates" and "Push Groups". Custom attributes
must use the core User or the enterprise extension namespace.

### Microsoft Entra ID

Entra's quirks change with the `aadOptscim062020` flag, which the admin adds
to the Tenant URL. Microsoft says the flag becomes the default "over the next
few months". So Carbon must accept both shapes. The tenant can set
`SkipOutOfScopeDeletions` to stop disabling out-of-scope users. Microsoft
supports a long-lived bearer token ("Secret Token") for non-gallery apps.

### Google Workspace

Workspace provisions users to its pre-integrated app catalog. Custom SCIM apps
are a limited beta. Google's July 2026 inbound SCIM makes Google the SCIM
*server*, so it does not provision to Carbon.

### Linear

A SCIM user becomes billable at the first login. Linear accepts updates only
for domains the workspace claims through a DNS TXT record.

### Slack

Only an Org Owner installs the SCIM app on Enterprise. The token works only
while its holder stays an owner or admin. Deactivation signs the user out on
all devices.

### GitHub Enterprise

Soft deprovision suspends the user and hashes the username. Tokens and SSH
keys come back on reactivation. Org-level SCIM (not EMU) removes org access
only.

### Notion

Only an org owner makes the token. Notion revokes the token when the owner
leaves or changes role. DELETE and `active: false` both remove the user from
the workspace and end all sessions.

### Atlassian Cloud (Guard)

SCIM cannot manage default groups or built-in admin groups. The directory
syncs to all sites of the organization.

### Salesforce

Each user has one profile and any number of permission sets. Both come
through `/Entitlements`. Deactivation frees the licence.

## Carbon today (code-verified)

| Fact | Where |
|---|---|
| `isSsoEnabled()` gates SAML SSO by edition, not plan: Enterprise edition and `sso` in `AUTH_PROVIDERS`. `FEATURE_PLANS` has no SSO key. | `packages/ee/src/sso/gate.ts`, `packages/ee/src/plan.ts` |
| The SSO admin UI is on Settings → Security. `x+/settings+/sso.tsx` is an action-only route. | `apps/erp/app/routes/x+/settings+/security.tsx` |
| SAML is self-hosted only because linking writes `auth.identities`. | SSO spec, Design Decisions |
| Deactivation is per company. `deactivateEmployee` strips the company from `userPermission`, deletes `userToCompany`, sets `employee.active = false`, deletes group `membership` rows and busts the claims cache. It never sets `user.active`. | `packages/auth/src/services/users.server.ts` |
| No code ends a GoTrue session. A removed member fails at the next request because `requirePermissions` finds no role. The refresh token stays valid. | `packages/auth/src/services/auth.server.ts` |
| An API key authenticates as its `createdBy` user. Nothing checks that the user is still a member. | `packages/auth/src/services/auth.server.ts` (`carbon-key` branch) |
| API keys store `keyHash` (SHA-256 hex) and `keyPreview` (last 5). The raw key is shown once. | migration `20260219162954_api-key-scopes-rate-limits.sql`, `hashApiKey` |
| The invite flow creates the auth user with `auth.admin.createUser`. This already runs on Cloud. | `createEmployeeAccount`, `apps/erp/app/modules/users/users.service.ts` |
| The Stripe seat count is the count of `userToCompany` rows (Cloud, user-based plans). No code caps seats. | `updateSubscriptionQuantityForCompany`, `packages/stripe/src/stripe.server.ts` |
| An audit entry with `actorId: null` shows as "System". `employee` is an audited entity. `user` and `userToCompany` are not. | `packages/ee/src/audit/`, `audit.config.ts` |
| Carbon signs short-lived HS256 tokens for a user with `SUPABASE_JWT_SECRET`. | `getUserScopedClient`, `packages/auth/src/lib/supabase/client.server.ts` |
| GoTrue `/logout` with a token that has no `session_id` claim runs `models.Logout(tx, u.ID)`. This revokes every refresh token of the user. | `supabase/auth` `internal/api/logout.go` |

The last two rows answer the brief's hosted-Supabase question. SCIM needs
`auth.admin.createUser` (already used on Cloud), Carbon tables, and the public
`/logout` endpoint. It needs no GoTrue admin SSO API and no `auth` schema write.
So SCIM can run on Cloud. One condition: the hosted project must still accept
HS256 tokens signed with the legacy JWT secret. Carbon already depends on this
for workflows and the Onshape panel. Nobody has run it against the hosted
project yet. The test phase must check it.

## Recommended Approach for Carbon

1. **Accept every shape both IdPs send.** Accept PUT and PATCH. Read `op`
   without case. Read string booleans. Accept dotted keys, filtered paths and
   no-path value objects. Support `eq` and `and` filters on `userName`,
   `externalId` and `displayName`. (Okta AIW, Entra with and without
   `aadOptscim062020`.)
2. **Make `active: false` and DELETE remove the person from one company only.**
   Use Carbon's existing per-company deactivation. Keep the global user and the
   person's records. (Pattern 1. GitHub org-level SCIM for the multi-company
   case.)
3. **End sessions with GoTrue `/logout`, scoped by company.** If the person has
   no other company, revoke all refresh tokens. If the person has another
   company, the membership delete and the claims cache bust already block this
   company at the next request. (Slack and Notion sign the user out.)
4. **Revoke the person's API keys in the company.** A key authenticates as its
   creator, so a key that outlives the membership keeps the access open.
   (GitHub hard deprovision.)
5. **Map IdP groups to employee types.** A user in no mapped group gets a
   default employee type that the admin picks. (Pattern 3. SAP business roles,
   Linear's default Member.)
6. **Let the IdP own name, email and active state.** The next push overwrites
   a hand edit. (Pattern 4.)
7. **Do not cap seats.** Sync the Stripe quantity after each change. Show the
   provisioned count to the admin. (Pattern 5.)
8. **Use one hashed bearer token per company, shown once, with regenerate.**
   Copy the API-key `keyHash` pattern. (Pattern 6.)
9. **Match existing users by email on the first sync.** Keep the SSO invite
   rule: refuse an email outside the verified SSO domains when the company has
   SSO. (Linear, Notion, Atlassian.)
10. **Gate it by plan, not by edition.** SCIM needs no self-hosted primitive.
    Use a `SCIM` key in `FEATURE_PLANS` and `requireEntitlement`. (Pattern 2.)

## Sources

- https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/
- https://developer.okta.com/docs/guides/scim-provisioning-integration-prepare/main/
- https://developer.okta.com/docs/guides/scim-provisioning-integration-test/main/
- https://developer.okta.com/docs/guides/scim-provisioning-integration-overview/main/
- https://developer.okta.com/docs/concepts/scim/
- https://developer.okta.com/standards/SCIM/SCIMFiles/Okta-SCIM-20-SPEC-Test.json
- https://developer.okta.com/docs/guides/submit-oin-app/scim/main
- https://help.okta.com/en-us/Content/Topics/Apps/Apps_App_Integration_Wizard_SCIM.htm
- https://support.okta.com/help/s/article/how-group-linking-works-for-scim-integrations
- https://support.okta.com/help/s/article/Receiving-Invalid-externalNamespace-task-error-when-assigning-a-user-to-a-SCIMenabled-application
- https://support.okta.com/help/s/article/SCIM-Provisioning-Enabled-in-Custom-App
- https://devforum.okta.com/t/scim-deprovisioning-not-sent-to-integration/22691
- https://devforum.okta.com/t/oin-scim-app-max-memberships-in-group-patch-api/34187
- https://devforum.okta.com/t/per-client-outbound-scim-request-rate-and-rate-limits-okta-sends-to-a-target-endpoint/35354
- https://devforum.okta.com/t/okta-scim-integration-retries-on-failures/34186
- https://www.okta.com/pricing/
- https://www.rfc-editor.org/rfc/rfc7643#section-4.1.1
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/application-provisioning-config-problem-scim-compatibility
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/how-provisioning-works
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/skip-out-of-scope-deletions
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/application-provisioning-quarantine-status
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/plan-auto-user-provisioning
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/scim-validator-tutorial
- https://learn.microsoft.com/en-us/entra/identity/app-provisioning/provision-on-demand
- https://learn.microsoft.com/en-us/entra/fundamentals/licensing
- https://learn.microsoft.com/en-us/answers/questions/2284725/understanding-scim-client-request-behavior-and-exp
- https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq
- https://knowledge.workspace.google.com/admin/users/advanced/about-automated-user-provisioning?hl=en
- https://knowledge.workspace.google.com/admin/users/advanced/automated-user-provisioning-with-custom-scim-profiles?hl=en
- https://workspaceupdates.googleblog.com/2026/07/streamline-identity-lifecycle-management-in-Google-Workspace-with-new-inbound-SCIM-support.html
- https://jumpcloud.com/support/provision-and-manage-users-and-groups-in-apps-using-custom-scim-identity-management-integration
- https://techdocs.akamai.com/eaa/docs/generic-scim-provisioning-with-onelogin
- https://linear.app/docs/scim
- https://linear.app/docs/saml-and-access-control
- https://linear.app/docs/billing-and-plans
- https://slack.com/help/articles/212572638-Manage-members-with-SCIM-provisioning
- https://docs.slack.dev/reference/scim-api/
- https://docs.slack.dev/admins/scim-api
- https://slack.com/help/articles/204475027
- https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/provisioning-user-accounts-with-scim/deprovisioning-and-reinstating-users
- https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/scim
- https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-saml-single-sign-on-for-your-organization/about-scim-for-organizations
- https://www.notion.com/help/provision-users-and-groups-with-scim
- https://support.atlassian.com/provisioning-users/docs/understand-user-provisioning/
- https://support.atlassian.com/provisioning-users/docs/manage-scim-api-key-expiration/
- https://help.salesforce.com/s/articleView?id=xcloud.identity_scim_implementation.htm&language=en_US&type=5
- https://developers.sap.com/tutorials/abap-environment-ips.html
- https://learning.sap.com/courses/introducing-sap-cloud-identity-services/managing-entities_de4b1a50-bec9-45d5-a8d6-4c0a2ef1f3fb
- https://raw.githubusercontent.com/supabase/auth/master/internal/api/logout.go
