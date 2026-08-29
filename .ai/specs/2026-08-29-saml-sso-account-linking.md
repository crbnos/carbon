# SAML SSO Account Linking

> Status: proposed
> Author: Claude (with Brad Barbin)
> Date: 2026-08-29

## TLDR

SAML SSO cannot sign in any user who already exists. GoTrue places SSO identities in their own
account-linking domain and **never** links them to `email` / `google` / `azure` identities, so every
SSO sign-in resolves to *create a new user* — which `GOTRUE_DISABLE_SIGNUP=true` rejects with
`422: Signups not allowed for this instance`. Because Carbon provisions users by invite (the app
creates `auth.users` rows via the admin API), **every** invited employee hits this, forever.

The fix is to treat SSO as *another identity on the existing person* rather than a separate user:
pre-seed the `sso:<provider_id>` identity row so GoTrue's linking returns `AccountExists`. That part
is ~80 lines of SQL. The part that must ship first is an **activation gate**: GoTrue scopes SSO by
email domain *globally*, Carbon scopes by `companyId`, and in production those don't align —
`acme.com` users are employees of all 8 companies. Without domain-ownership verification, "activate
SSO" is an account-takeover primitive.

**Ship order is load-bearing: §5 (gate) before §6 (linking).** §6 alone converts a currently-inert
misconfiguration into a live takeover path.

---

## 0. Design revision (v2, 2026-08-29) — grounded against shipped code

The sections below were written before auditing PR #1455, which already shipped much of §5, and
before verifying GoTrue v2.177.0's linking internals across IdPs. The **implemented** design (see
`.ai/plans/2026-08-29-saml-sso-account-linking.md`) corrects three things. Where §5/§6 below conflict
with this section, **this section wins**.

1. **Reuse #1455's tables, don't create `ssoDomainClaim`.** `ssoConnection` + `ssoDomain` (with a
   `pending → verified` DNS-TXT lifecycle in `packages/ee/src/sso/verification.server.ts`,
   `_carbon-challenge.<domain>` / `carbon-domain-verification=<token>`) already are the claim table.
   The reserved-domain list already exists as `PUBLIC_EMAIL_DOMAINS` in `settings.models.ts`.

2. **Key linking on the `auth.identities.email` column, not `provider_id` — this is the
   provider-agnostic fix.** GoTrue v2.177.0 marks every SAML assertion email `Verified` (hardcoded)
   and hard-rejects (400) an assertion with no extractable email, so its email-column fallback in
   `DetermineAccountLinking` fires on *every* successful SAML sign-in, for *any* IdP (Okta, Entra,
   OneLogin, Ping, Google, JumpCloud, ADFS). Pre-seeding a row with `provider = 'sso:<providerId>'`
   and `identity_data.email = lower(email)` (so the generated `email` column = `lower(email)`) makes
   GoTrue `LinkAccount` to the existing user regardless of the NameID's shape. It then self-heals: the
   next login's `provider_id == NameID` lookup hits the row GoTrue created. The spec's original
   `provider_id = email` keying only worked because Okta's NameID *is* the email; Entra's default is an
   opaque persistent pairwise id, which that key misses. `provider_id` is now just a human-readable
   placeholder; the email column carries the match.

3. **§5.5 changes from "require email-format NameID" to a live-assertion email check.** Requiring
   `NameID Format = emailAddress` wrongly rejects Entra and is neither necessary nor sufficient. The
   real guarantees (operational, validated from a captured test assertion at activation — not a config
   string): (a) GoTrue extracts a non-empty email (guards ADFS/no-email-claim and Entra null-`user.mail`
   — these fail *loud* with a 400, not silently), and (b) that email equals the seeded `lower(email)`
   (guards Entra B2B guests whose email resolves to the mangled `user_..#EXT#@tenant.onmicrosoft.com`
   UPN, and secondary-address mismatches). Under `DISABLE_SIGNUP=true`, a mismatch is a visible 422, not
   a silent duplicate user.

**Mechanism, implementation, and prerequisites of v2:**

- **Architecture: pre-seed under `DISABLE_SIGNUP=true`.** #1455 was built for the *opposite* config —
  it lets GoTrue JIT-create a user, then repairs it in `callback.tsx` (`linkSsoIdentityToUser`). That
  repair needs `DISABLE_SIGNUP=false`; production runs `true`, so GoTrue 422s at step one and the whole
  repair path is dead code in production. Pre-seeding makes GoTrue take the `LinkAccount`/`AccountExists`
  branch, which needs no signup — so `DISABLE_SIGNUP=true` stays, and the email self-registration hole
  never reopens.
- **Implemented app-layer, matching #1455 (no DB triggers T1–T4).** Pre-seeding lives in
  `packages/ee/src/sso/provisioning.server.ts` and is wired at two points and torn down at a third:
  `verifySsoDomain` backfills every existing on-domain user when a domain is verified (§6's T3);
  the three account-creation flows (`createEmployeeAccount` / `createCustomerAccount` /
  `createSupplierAccount`) seed a newly-invited user whose domain already has a verified connection
  (T1); `removeSsoDomain` deletes that domain's seeded identities, keyed on the `email` column so it
  also catches GoTrue's self-healed opaque-NameID rows (T2/T4). The rogue-IdP defense stays where
  #1455 put it — the callback's domain check before any identity write.
- **§5.4 in-DB guard kept as defense-in-depth**, adapted to the shipped verify ordering: a
  `BEFORE INSERT` trigger on `auth.sso_domains` raises unless a `ssoDomain` claim row exists for the
  domain (the shipped flow syncs GoTrue while the row is still `pending`, by a deliberate
  lockout-avoidance ordering — a "verified-only" guard would break it, so the guard requires a *claim*,
  which still blocks injecting an unclaimed domain from Studio/a migration). Reserved domains are
  blocked in-DB too via a seeded `ssoReservedDomain` table (kept in sync with `PUBLIC_EMAIL_DOMAINS`).
  A session-local `app.sso_domain_override` GUC lets staff scripts bypass for Carbon-own domains.
- **OQ4 audit:** `verifySsoDomain` writes a best-effort audit-log entry recording the backfill
  (domain, provider, linked-user count) — a privilege-granting event.
- **Deployment prerequisites (NOT in this repo — the `crbnos/supabase` fork):** keep
  `GOTRUE_DISABLE_SIGNUP=true`; the Kong SAML route + `GOTRUE_URI_ALLOW_LIST` fixes from §10. The
  repo-side code is inert without them, so the PR ships as a draft flagged **e2e-unverified — needs a
  SAML env** (Okta/Entra IdP + DNS). In-repo verification is unit tests + a rolled-back-transaction
  migration check on the guard trigger.

---

## 1. Observed failure

```json
{"error":"422: Signups not allowed for this instance",
 "path":"/sso/saml/acs","status":303,"time":"2026-08-29T04:53:13Z"}
```

GoTrue validates the assertion correctly, then fails at user resolution. The 303 sends the browser
back to `SITE_URL` with an error fragment, which the app renders as a bounce to the login page — so
the surface symptom ("SSO redirects me to login") points nowhere near the actual cause.

## 2. How GoTrue account linking actually works

Verified against `supabase/auth` v2.177.0, the version we run.

| Component | Behavior |
|---|---|
| `internal/models/linking.go` | `GetAccountLinkingDomain` returns `"default"` for email/google/azure, but `"sso:<provider_id>"` for SSO providers |
| `DetermineAccountLinking` | filters candidate identities to those *in the same linking domain*; `len(linkingIdentities) == 0` → `CreateAccount` |
| `internal/api/samlacs.go` | identity provider string is `"sso:" + ssoProvider.ID.String()`; subject is `assertion.UserID()` (the SAML NameID) |
| `internal/api/external.go` | `CreateAccount` + `DisableSignup` → `ErrorCodeSignupDisabled`. The `AccountExists` branch does **not** require `is_sso_user = true` |

The isolation is deliberate — it prevents an IdP from silently seizing accounts it never
authenticated. We are not working around a bug; we are choosing to grant that linkage explicitly,
which is exactly why §5 exists.

Two schema facts that follow from it:

- `auth.users` — `users_email_partial_key UNIQUE (email) WHERE is_sso_user = false`. A duplicate
  email **is** permitted for an SSO user, so GoTrue happily mints a second row for the same human.
- `auth.identities` — `UNIQUE (provider_id, provider)`, no FK to `auth.sso_providers`. Identity rows
  are orphaned, not cascaded, when a provider is deleted.

## 3. Why this is structural for Carbon

1. **UUID immutability.** `public.user.id === auth.users.id`, and that id is referenced by
   `employee`, `userPermission`, `membership`, and every `createdBy` / `updatedBy` audit column in
   the ERP. A person's UUID can never change.
2. **`DISABLE_SIGNUP` is global.** No per-provider toggle exists in v2.177.0. Set to `true`, SAML can
   never provision; set to `false`, email self-registration reopens instance-wide.
3. **Invite-based provisioning.** `createEmailAuthAccount` and `resolveAuthUserId`
   (`packages/auth/src/services/auth.server.ts`, `apps/erp/app/modules/users/users.server.ts`) create
   **non-SSO** users. Every invited employee is therefore unlinkable by construction.
4. **The existing trigger refuses duplicates.** `create_public_user` bails when the email already
   belongs to a different id:
   ```sql
   IF email_owner IS NOT NULL AND email_owner <> NEW.id::text THEN RETURN NEW; END IF;
   ```
   So even with signups enabled, a JIT-provisioned SSO user gets **no** `user` row and **no**
   `userPermission` row — authenticated by the IdP, invisible to the app, bounced to login.

Conclusion: Supabase's intended model (an SSO user is a distinct user) is incompatible with Carbon's
data model. **One person = one UUID; SSO is one more identity on that person.**

## 4. The multi-tenancy hazard

GoTrue scopes SSO by **email domain**, instance-wide — `sso_domains_domain_idx UNIQUE (lower(domain))`.
Carbon scopes by **`companyId`**. Production data as of 2026-08-29:

| companyId | employees | domains |
|---|---|---|
| `COMPANY_1` | 16 | northwind.com, acme.com |
| `COMPANY_2` | 8 | acme.com, internal.example, globex.com |
| `COMPANY_3` | 6 | acme.com, initech.com |
| `COMPANY_4` | 5 | umbrella.com, acme.com, stark-industries.com |
| `COMPANY_5` | 2 | acme.com, globex.com |
| 3 others | 1 each | acme.com |

Three consequences:

- **`acme.com` is an employee of all 8 companies.** If any tenant could register `acme.com`, their
  IdP would authenticate as Carbon staff in every tenant. Registering a domain *is* the takeover.
- **`globex.com` spans two companies.** Activating SSO "for their org" necessarily reaches users in
  the other company. Scoping the backfill by company doesn't help — GoTrue keys linking on domain and
  knows nothing about companies, so the unscoped users just fail with the same 422.
- **A domain can be claimed exactly once, instance-wide.** First tenant to activate wins; a second
  tenant with users on that domain has them authenticated by a foreign IdP.

**Adopted policy: the verified domain owner controls identity for that domain, instance-wide.** It
matches GoTrue's unique index, matches how Okta and Google Workspace already reason about domains,
and is the only policy expressible without patching GoTrue.

## 5. Phase 1 — activation gate (ships first)

### 5.1 Domain claim table

Migration in `packages/database/supabase/migrations/`:

```sql
CREATE TABLE "ssoDomainClaim" (
  "id"                TEXT PRIMARY KEY,
  "companyId"         TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "domain"            TEXT NOT NULL,
  "verificationToken" TEXT NOT NULL,
  "verifiedAt"        TIMESTAMPTZ,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"         TEXT NOT NULL REFERENCES "user"("id")
);
CREATE UNIQUE INDEX "ssoDomainClaim_domain_idx" ON "ssoDomainClaim" (lower("domain"));
```

RLS scoped to `companyId` per `.claude/rules/conventions-database.md`. One claim per domain
instance-wide, mirroring GoTrue's own uniqueness so the two can never disagree.

### 5.2 Verification

DNS TXT at `_carbon.<domain>` containing `carbon-verification=<verificationToken>`. Only on success
is `verifiedAt` set. Re-verify on a schedule; a domain that stops resolving gets flagged, not
silently trusted forever.

### 5.3 Reserved domains

A domain on the reserved list can never be claimed — **consumer mailbox providers only**:
`gmail.com`, `outlook.com`, `hotmail.com`, `yahoo.com`, `icloud.com`, `proton.me`, … A shared
domain is used by unrelated people, so a DNS challenge cannot prove single ownership; it must
never be claimable.

The vendor's own domains are **not** reserved. A domain a company actually controls can be proven
through the same DNS-TXT challenge and set up for SSO like any other — a blanket reservation only
added friction (and the DNS challenge, not a hardcoded list, is the real ownership gate). The
reserved list is seeded in the `ssoReservedDomain` table (§5.4), mirroring `PUBLIC_EMAIL_DOMAINS`.

### 5.4 Defense in depth

App-level gating is not enough on its own, since `auth.sso_domains` can also be written from Studio
or a migration. A `BEFORE INSERT` trigger on `auth.sso_domains` (`enforce_sso_domain_claim`) raises
unless a non-reserved `ssoDomain` claim exists for the domain **AND that claim belongs to the
connection behind `NEW."sso_provider_id"`** — or an explicit staff override flag
(`app.sso_domain_override`) is set. The gate then holds regardless of which path writes the row.

As shipped it requires a claim of **any** status, not `verified`: `verifySsoDomain` calls GoTrue
(which writes `auth.sso_domains`) while the `ssoDomain` row is still `pending`, by a deliberate
lockout-avoidance ordering, so a verified-only guard would refuse the happy path. The
provider-binding join (`ssoDomain` → `ssoConnection` on `connectionId`/`companyId`, then
`ssoConnection."providerId" = NEW."sso_provider_id"`) is what prevents a claimed domain from being
routed to an unrelated company's IdP (CWE-863) — `companyId` on the claim alone can't prove the
provider belongs to the company that passed DNS verification.

### 5.5 IdP NameID requirement

Everything in §6 assumes **SAML NameID == the user's email**. Okta's default (`user.userName`)
satisfies this; an IdP configured for opaque/persistent NameIDs does not, and pre-seeding cannot
work for it. Validate the NameID format at activation and refuse anything other than
`EmailAddress` / `unspecified`-mapped-to-email, with a clear error. Record the decision on the claim
row so a later IdP reconfiguration is detectable.

## 6. Phase 2 — identity linking

### 6.1 Helpers

```sql
CREATE OR REPLACE FUNCTION public.sso_provider_for_email(p_email TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d."sso_provider_id" FROM auth.sso_domains d
   WHERE lower(d."domain") = lower(split_part(p_email, '@', 2))
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.link_sso_identity(p_user_id UUID, p_email TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_provider UUID;
BEGIN
  IF p_email IS NULL THEN RETURN; END IF;
  v_provider := public.sso_provider_for_email(p_email);
  IF v_provider IS NULL THEN RETURN; END IF;

  INSERT INTO auth.identities
    ("provider_id","user_id","identity_data","provider","created_at","updated_at")
  VALUES
    (lower(p_email), p_user_id,
     jsonb_build_object('sub', lower(p_email), 'email', lower(p_email)),
     'sso:' || v_provider::text, now(), now())
  ON CONFLICT ("provider_id","provider") DO NOTHING;
END $$;
```

`identity_data.sub` must equal `provider_id`; GoTrue matches on the column, and the JSON is what it
reads back into the session.

### 6.2 Triggers

| # | Trigger | Fires | Purpose |
|---|---|---|---|
| T1 | `AFTER INSERT ON auth.users` | new user created | link if their domain already has SSO |
| T2 | `AFTER UPDATE OF email ON auth.users` | email changed | unlink old domain, link new |
| T3 | `AFTER INSERT ON auth.sso_domains` | **SSO activated** | backfill every existing user in the domain |
| T4 | `AFTER DELETE ON auth.sso_domains` | SSO removed | drop that domain's SSO identities |

T3 is the one that answers "what about the users who already exist" — activation, not user creation,
is when the bulk linkage happens:

```sql
CREATE OR REPLACE FUNCTION public.backfill_sso_identities()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO auth.identities
    ("provider_id","user_id","identity_data","provider","created_at","updated_at")
  SELECT lower(u."email"), u."id",
         jsonb_build_object('sub', lower(u."email"), 'email', lower(u."email")),
         'sso:' || NEW."sso_provider_id"::text, now(), now()
    FROM auth.users u
   WHERE u."email" IS NOT NULL
     AND u."is_sso_user" = false
     AND lower(split_part(u."email", '@', 2)) = lower(NEW."domain")
  ON CONFLICT ("provider_id","provider") DO NOTHING;
  RETURN NEW;
END $$;
```

T4 must scope by domain, not just provider, since one provider may own several domains. `provider_id`
is the email, which makes that exact:

```sql
DELETE FROM auth.identities
 WHERE "provider" = 'sso:' || OLD."sso_provider_id"::text
   AND lower(split_part("provider_id", '@', 2)) = lower(OLD."domain");
```

Cascaded deletes from `auth.sso_providers` fire T4 per row, so provider deletion cleans up too.

### 6.3 What stays unchanged

- `GOTRUE_DISABLE_SIGNUP=true`. With linking automated, JIT is unnecessary; access remains granted by
  invite in the ERP, with the IdP only authenticating.
- `is_sso_user` stays `false`. Users keep their existing password / magic-link / Google / Azure
  logins. **Forcing SSO-only for a domain is a separate, app-level concern** — GoTrue has no
  per-domain enforcement — and is out of scope here.

## 7. Security considerations

| Risk | Mitigation |
|---|---|
| Tenant claims a domain they don't own → takeover of every user on it | §5.2 DNS verification, enforced in-DB by §5.4 |
| Tenant claims `acme.com` (vendor domain) → takeover of staff across all 8 tenants | §5.2 DNS verification — a tenant cannot publish the `_carbon-challenge` TXT record on a domain it does not control, so it can never verify (or register in GoTrue) a domain it doesn't own |
| Tenant claims a consumer domain → links unrelated strangers | §5.3 reserved list (consumer providers only — a DNS challenge can't prove single ownership of a shared domain) |
| IdP asserts an email outside its verified domain | GoTrue matches on `(provider_id, provider)`; an unlinked email yields `CreateAccount` → refused by `DISABLE_SIGNUP` |
| Domain ownership lapses / company offboards | Scheduled re-verification; T4 on domain removal |
| Deactivated employee retains IdP access | App already enforces `employee.active`; unchanged by this spec |

The trust granted is precisely "a verified domain owner may authenticate humans at that domain" —
the same trust Okta and Google Workspace already assume. The spec makes it explicit and verified
rather than implicit and unchecked.

## 8. Rollout

1. **Phase 1** — claim table, DNS verification, reserved list, `auth.sso_domains` guard trigger.
   No linking behavior yet; SSO remains broken. Safe to ship alone.
2. **Phase 2** — helpers + T1/T2/T3/T4. On deploy, T3 does **not** fire for `acme.com`, which is
   already registered; run the backfill once manually for existing domains.
3. **Verify** on `acme.com` (2 users, Carbon staff, lowest blast radius) before offering activation
   to any tenant.

### Acceptance criteria

- An existing invited user signs in via SAML and lands on their **existing** UUID — same
  `public.user` row, same permissions, same audit history.
- That user can still sign in by magic link and Google afterward.
- A newly invited user in an SSO domain can sign in via SAML with no manual step.
- Activating SSO for a domain links all pre-existing users in it, in one transaction.
- Removing the domain removes exactly that domain's SSO identities and no others.
- An unverified domain claim cannot produce an `auth.sso_domains` row by any path, including Studio.
- A reserved domain cannot be claimed by a tenant.
- `auth.users` gains **no** duplicate rows through any of the above.

## 9. Open questions

All resolved 2026-08-29 (Brad):

1. **Self-serve vs staff-operated activation → staff-operated for v1.** Claims are created and
   verified by internal staff only; there is no tenant-facing UI. §5 is therefore defense in depth
   rather than a self-serve gate — but it still ships first, and the in-DB guard on
   `auth.sso_domains` (§5.4) is the real enforcement point regardless of who writes the claim.
2. **Per-domain SSO enforcement (disable password login) → out of scope.** GoTrue has no per-domain
   enforcement; if we build it later it lives in Carbon's login route, not here.
3. **Non-routable domains (e.g. `internal.example`) → ineligible.** They can never pass DNS
   verification, so they simply never become verified claims; no special-casing beyond that. Treat
   the underlying accounts as service/test accounts.
4. **Audit record on backfill → yes.** A backfill that links N accounts is a privilege-granting
   event and writes an audit-log entry.

## 10. Prior context

- Kong had no route for GoTrue's un-prefixed SAML endpoints; fixed in the upstream Supabase fork.
  GoTrue derives its entityID and ACS URL from `API_EXTERNAL_URL` and validates each assertion's
  `Destination` against that exact URL, so `/sso/saml/acs` must route and must skip `key-auth` —
  the IdP posts assertions directly and cannot attach an apikey.
- `GOTRUE_URI_ALLOW_LIST` referenced undefined `${ERP_URL}` / `${MES_URL}` and resolved to the
  literal `,/callback,,/callback`, rejecting every redirect target except `SITE_URL`. Corrected
  upstream to `${ADDITIONAL_REDIRECT_URLS}`.
- Both are deployment-side (the Supabase fork) and are prerequisites for testing anything here.
