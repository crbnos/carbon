# Session Management, Revocation & Portable IP/Geolocation Research: Best Practices Survey

## Summary

Surveyed how Telegram, WhatsApp, Signal, Slack, Discord, GitHub, and Google implement
device/session lists, session revocation, and login alerts; how the industry securely derives
client IP behind arbitrary proxies; and how self-hostable open-source products (authentik,
Plausible, Umami, GitLab, Supabase GoTrue) ship IP geolocation that works identically in cloud
and Docker deployments. Key findings: (1) Carbon's existing session-revocation design (GoTrue
`auth.sessions` + revoke-one + sign-out-others) already matches the consensus model; (2) the
branch's IP capture reads the **leftmost** `X-Forwarded-For` entry, which is client-forgeable
in the self-hosted Caddy topology (safe on Vercel only by accident, because Vercel overwrites
XFF) — the industry-standard fix is a rightmost-first walk skipping configured trusted proxies;
(3) the portable geolocation pattern, proven by authentik/Plausible/Umami, is an **offline
mmdb database** resolved **at login time** with graceful degradation — Vercel geo headers are
exactly the GitLab anti-pattern (location on cloud, nothing self-hosted). MaxMind GeoLite2 was
previously declined for this feature (spec changelog 2026-08-26); DB-IP Lite (CC BY 4.0, freely
redistributable, no account) is the licensing-clean alternative Plausible chose for the same
reason, with GeoLite2 as an operator opt-in.

**Domain classification note:** this is an auth/platform-security feature, not a core ERP
domain, so the reference set is the messaging apps the request named plus SaaS leaders with
mature session UIs. SAP is not a useful reference here — enterprise SAP delegates interactive
session management to the customer's IdP (SAML/OIDC) and surfaces logons only through
admin-side audit logs, not a user-facing device list; the consumer/SaaS products below define
the state of the art. Self-hostable OSS products were surveyed as the extra "competitor" set
because the portability constraint is the hard part of this request.

## Competitors Surveyed

- **Telegram** — the most detailed user-facing session model in the industry (per-session IP,
  IP-derived location, device, app version); unique anti-takeover protections (24-hour rule).
- **WhatsApp** — multi-device architecture with the primary phone as root of trust; the
  privacy-lean end of the spectrum (no IP shown).
- **Signal** — the extreme privacy pole: no server-side session metadata at all (subpoena
  responses show the server stores only two timestamps per account).
- **Slack** — B2B SaaS pattern: personal access logs (IP + UA per sign-in), admin access logs,
  "Sign out all other sessions", admin-controlled session duration.
- **Discord** — Devices tab with approximate location + blocking "new login location" email
  verification.
- **GitHub / Google** — the "Sessions" / "Your devices" pattern most SaaS products copy:
  device + approximate IP-derived location + last active + revoke.
- **authentik / Plausible / Umami / GitLab / Supabase GoTrue** — self-hostable products with
  (or conspicuously without) geo-enriched login events; the deployment-portability precedents.

## Key Consensus Patterns

### 1. The session/device entity: device + approximate location + last-active + current marker

- **Telegram** (`account.getAuthorizations` → `authorization`): device model, platform,
  system version, app name/version, created date, last-active date, **last known IP**, and
  `country` + `region` — both "determined from IP" per the API docs. Flags: `current`,
  `official_app`, `password_pending`, `unconfirmed`.
- **Discord**: OS, client type, **approximate location** (IP-derived), last used; current
  device marked and excluded from the kill list.
- **GitHub**: device type, "Seen in <city>" (IP-derived), last active; web sessions and
  mobile sessions listed separately.
- **Google**: device type, browser, approximate location, last communication time; a device
  can hold multiple sessions, listed separately; "Signed out" entries remain visible.
- **WhatsApp/Signal**: device description + last-active only — no IP, no location (privacy
  stance; Signal's server structurally cannot produce a session list).
- **Rationale**: the row answers "is this me?" — device + coarse place + recency is enough;
  raw IP is a detail-view/power-user field (Telegram shows it; GitHub/Google deliberately
  show only the derived location). Carbon's `userLogin` columns (`ipAddress`, `city`,
  `country`, `userAgent`, `createdAt`, `sessionId`) already match this shape.

### 2. Revocation is immediate server-side invalidation; "all others" always protects the current session

- **Telegram**: terminating a session invalidates that MTProto authorization key at the
  server the moment the call lands; the revoked client drops to the login screen.
  `auth.resetAuthorizations` = "Terminate All Other Sessions".
- **WhatsApp**: unlinking removes the device's identity key from the server-side device map;
  other clients stop encrypting to it. Only the **primary phone** can link/unlink — a
  hijacked companion cannot evict the phone.
- **Discord**: per-device Log Out + "Log Out All Known Devices" (password + 2FA to confirm);
  revoked device dies on its next server round-trip. Password change invalidates all tokens.
- **Slack**: "Sign out all other sessions"; Enterprise admins get `admin.users.session.reset`.
- **GitHub/Google**: per-session "Revoke"/"Sign out"; password change nukes all sessions;
  Google documents propagation of minutes up to ~1 h.
- **Rationale**: users reach this screen when they suspect compromise — the action must be
  one click, spare the session they're on, and take effect fast. Carbon's design (delete
  `auth.sessions` row → refresh tokens cascade; `signOut(jwt, "others")`; ~60 s bounce via
  the verify cache) sits comfortably inside the Google-documented propagation window. The
  accepted residual (raw JWT valid up to `GOTRUE_JWT_EXP`) is the same trade every
  JWT-based product makes.

### 3. Location shown is explicitly approximate, resolved from IP at event time

- **Telegram**: country + region computed server-side from the stored IP; demonstrably wrong
  at times (wrong-country GitHub issues) and shown anyway.
- **Google/GitHub/Discord**: all use "approximate location" phrasing; city/region/country at
  most, never a precise pin.
- **Accuracy reality**: country ~99%; city-within-50 km only ~65–80 % for free databases
  (GeoLite2), worse on mobile IPs — MaxMind ships an `accuracy_radius` field because a point
  answer is dishonest.
- **Rationale**: coarse location is a recognition aid, not forensics; it also satisfies data
  minimization and the GeoLite2 EULA's ban on household-level identification. Resolving **at
  login time and storing the result** is the dominant architecture (geo data churns; emails
  need location at event time; display-time resolution rewrites history and multiplies
  lookups). Carbon already stores `city`/`country` at insert — correct pattern, wrong source
  (see pattern 6).

### 4. New-login alerts with a "wasn't you?" path

- **Telegram**: service message from account 777000 naming device + IP-derived location, with
  "go to Settings > Devices and terminate that session" instructions; new sessions arrive
  `unconfirmed` and other devices are prompted to confirm or kill them.
- **Discord**: blocking email on new IP/location — login refused until "Verify Login" clicked;
  email shows IP + location.
- **Google**: "New sign-in from…" email + Android push with "Yes, it's me / No, secure
  account"; every legitimate alert also appears in the security-activity log (anti-phishing).
- **GitHub**: device-verification code emailed on unrecognized device/IP for non-2FA accounts.
- **Rationale**: the session list only helps users who look at it; the alert brings the
  compromise to them. Carbon's spec already lists the new-device email as future work
  (requires a `carbon-device` cookie + `deviceId` column); this survey confirms the email
  should carry device, approximate location, timestamp, and a link to the security page —
  which requires geolocation to work self-hosted too, or self-hosted alerts arrive blank
  (GitLab's exact failure, issue #482992).

### 5. Automatic session hygiene: inactive sessions expire

- **Telegram**: server auto-terminates sessions inactive past a user-configurable TTL
  (`account.setAuthorizationTTL`, 1 week–1 year ladder, default 6 months).
- **WhatsApp**: companions log out if the primary phone is offline 14 days; a companion
  itself inactive ~30 days is dropped. **Signal**: 45-day linked-device inactivity unlink.
- **Slack**: admin-set session duration per plan, staggered expiry to avoid mass logout.
- **Rationale**: forgotten sessions on lost/old devices are the long tail of account risk;
  expiry bounds it without user action. In Carbon this maps to GoTrue's built-in
  `SESSIONS_TIMEBOX` / `SESSIONS_INACTIVITY_TIMEOUT` settings rather than new code.

### 6. Client IP: rightmost-first XFF walk over configured trusted proxies — never leftmost

- **MDN**: security-related use of XFF "must only use IP addresses added by a trusted proxy";
  the algorithm is to search from the rightmost entry, skipping trusted-proxy addresses, and
  take the first non-matching address. If the server is directly reachable, *no* part of XFF
  is trustworthy.
- **Framework precedent**: Express `trust proxy` (hop count or CIDR list, default trust
  nothing), Rails `ActionDispatch::RemoteIp` (same walk; private/loopback ranges trusted by
  default), nginx `real_ip_recursive on`. The `request-ip`-style leftmost/first-match
  heuristic is documented as unsafe for anything security-relevant.
- **Platform behavior**: Vercel **overwrites** XFF with the single real client IP (spoofing
  impossible, which is why Carbon's current leftmost read is safe *on Vercel only*).
  Cloudflare's `CF-Connecting-IP` is trustworthy only when the peer is verified to be
  Cloudflare. Caddy ≥2.5 with no `trusted_proxies` strips incoming XFF (safe); **with**
  `trusted_proxies` configured — as Carbon's `contrib/deploying/simple-docker-caddy/Caddyfile`
  does (`trusted_proxies static private_ranges`) — Caddy forwards the full incoming chain,
  so the leftmost entry is client-supplied and `split(",")[0]` reads attacker input.
- **Hygiene**: merge multiple XFF header instances before parsing; validate candidates with a
  real IP parser and fail closed on garbage; strip `:port` suffixes (AWS ALB emits them);
  normalize IPv4-mapped IPv6 (`::ffff:1.2.3.4`) before any comparison (CVE-2026-30827 class
  bugs); skip private/reserved ranges when walking.
- **Rationale**: XFF is an unauthenticated header the client seeds; each hop appends to the
  right, so only the rightmost entries — the ones your own proxies wrote — are trustworthy.

### 7. Geolocation that ships everywhere: offline mmdb, resolved locally, degrading gracefully

- **authentik** (closest analog — geo on login events): bundles `GeoLite2-City.mmdb` in the
  image; operators mount a volume + run the `maxmindinc/geoipupdate` sidecar for freshness;
  the file is hot-reloaded on change; a missing file disables geo cleanly.
- **Plausible**: bundles **DB-IP Country Lite** (chosen in PR #906 explicitly because CC BY
  4.0 permits redistribution, unlike post-2019 MaxMind terms); city-level is opt-in via
  `MAXMIND_LICENSE_KEY` env vars with self-managed auto-update.
- **Umami**: fetches GeoLite2-City via a redistribution mirror at build/startup; stores only
  derived country/region/city.
- **GitLab** (anti-pattern): sign-in-email location sourced from Cloudflare edge headers →
  works on GitLab.com, **blank on every self-managed instance** — the exact shape of Carbon's
  current `x-vercel-ip-*` dependency.
- **Supabase GoTrue** (baseline): stores raw IP + UA, does no geo at all — proof that
  "raw IP only" is an acceptable shipped floor.
- **Privacy rationale**: a local lookup means the login IP never leaves the server — no
  third-party processor, no DPA, no cross-border transfer, and it works air-gapped. Free geo
  APIs are disqualified for a self-hosted product: ip-api.com free tier is non-commercial
  only (45 req/min), ipinfo free city tier is 50 k/month, and every one of them turns each
  customer deployment into an unconsented data-sharing arrangement.

## Answers to Research Questions

1. **What entities/lifecycle do these apps use, and what do they show per session?** One row
   per authorized device/session keyed to a server-side credential (Telegram: MTProto auth
   key; WhatsApp/Signal: per-device identity key; SaaS: cookie/refresh-token session).
   Displayed: UA-derived device, approximate IP-derived location (city/region/country),
   created + last-active timestamps, current-session marker; raw IP only in detail views
   (Telegram, Slack access logs). Carbon's GoTrue-session + `userLogin` join matches this.
2. **How does revocation work server-side?** Immediate invalidation of the server-side
   credential (key deleted / session row deleted / tokens revoked); the revoked client dies
   on its next round-trip. Short-lived access tokens mean stateless-verification products
   accept a bounded residual (Carbon: ≤60 s shell bounce, ≤1 h raw-JWT PostgREST residual —
   inside Google's own documented propagation window). "Sign out all others" always excludes
   the current session; password change is a global revoke (Discord, GitHub).
3. **What anti-abuse measures accompany it?** Telegram's 24-hour fresh-session rule (a
   session <24 h old cannot terminate others — `FRESH_RESET_AUTHORISATION_FORBIDDEN`),
   unconfirmed-session confirmation, and inactivity TTLs; WhatsApp's phone-only
   link/unlink authority and 14/30-day auto-expiry; Discord's password+2FA confirmation on
   bulk logout and blocking new-location email verification; GitHub's device verification
   codes; Google's yes/no push prompts. Common core: **alert on new login + expire inactive
   sessions + re-authenticate before bulk destructive session actions**.
4. **How to derive client IP portably and securely?** Walk the merged XFF list from the
   right, skipping trusted proxies (env-configured hop count or CIDR list; private/loopback
   ranges implicitly proxy space), taking the first untrusted address; default to the socket
   peer / rightmost entry when nothing is configured; validate + normalize
   (IPv4-mapped-IPv6, port suffixes) and fail closed. Platform-specific single-value headers
   (`CF-Connecting-IP`, `Fly-Client-IP`) may be used only when that platform is explicitly
   configured, never auto-detected from header presence. On Vercel, XFF is
   platform-overwritten and already safe.
5. **What geolocation works identically self-hosted and cloud?** Offline mmdb lookup at
   login time (authentik/Plausible/Umami precedent): bundle a freely-redistributable
   country-level DB (DB-IP Lite, CC BY 4.0 with attribution; IPLocate CC BY-SA — both
   country-only) for zero-config, offer city-level as operator opt-in (GeoLite2 via
   geoipupdate sidecar + license-key env vars — bundling GeoLite2 itself requires a
   commercial redistribution license and a 30-day-freshness EULA duty, so operator-supplied
   is the clean path). Node readers: `maxmind` npm (fast pure-JS, `watchForUpdates` pairs
   with the sidecar). Degrade: private/LAN IP → skip lookup, show "Local network"; no DB →
   null columns → "Unknown location". Never a third-party API on the login path.
6. **Standard terminology?** Consumer: "Devices" / "Linked Devices" + "Log out"
   (WhatsApp/Discord/Signal); Telegram uniquely says "Terminate". SaaS: "Sessions" /
   "Where you're signed in" + "Revoke"/"Sign out". Carbon's "Your devices" card + sign-out
   actions match the consumer-friendly end; "last active", "current device", and
   "approximate location" are the standard field labels.

## Competitor-Specific Details

### Telegram
Sessions = MTProto authorization keys; `account.getAuthorizations` returns per-session
`ip`, `country`, `region` ("determined from IP"), device/app metadata, `date_created`,
`date_active`. `account.resetAuthorization(hash)` kills one; `auth.resetAuthorizations`
kills all others; `account.setAuthorizationTTL` sets inactivity auto-terminate (default
~6 months). The 24-hour rule (`FRESH_RESET_AUTHORISATION_FORBIDDEN`) stops a fresh
attacker from evicting the owner. Login alert is an in-app service message from user
777000 naming device + location. Per-session toggles: accept calls / secret chats.

### WhatsApp
Primary phone + up to 4 companions, each with its own Signal-protocol identity key;
server keeps the account→devices map but a companion is valid only if signed by the
primary (Account Signature + Device Signature) — "prevents a compromised server from
surreptitiously adding devices". Linking = QR scan + biometric at the phone; unlink is
phone-only. No IP/location in the UI; notification to the phone when a device links.
14-day phone-offline logout; ~30-day companion inactivity logout.

### Signal
No session list exists to render: subpoena responses (signal.org/bigbrother) show the
server holds only account-creation and last-connection timestamps. Up to 5 linked
devices shown with linked/last-active dates only; 45-day inactive unlink; unlinking
drops that device's history. The reference point for the privacy floor, not a UI model
an ERP should copy — Carbon's audit needs are closer to Slack's.

### Slack
No end-user session list; personal access logs (`my.slack.com/account/logs`) show
time, IP, and device per sign-in — the closest analog to Carbon's login-history table.
Admin access logs (paid plans) expose user + IP + UA + session counts
(`team.accessLogs`). Session duration is admin-set with randomly staggered expiry and a
2h15m desktop warning. "Sign out all other sessions" is the only user-side kill switch.

### Discord
Devices tab (OS, client, approximate location, last used; current device protected);
"Log Out All Known Devices" requires password + 2FA. New-IP logins are **blocked**
pending email verification showing IP + location — the strictest "wasn't you" gate
surveyed.

### GitHub / Google
GitHub: Sessions page (web + mobile lists, "Seen in <city>", revoke per session; mobile
revoke also removes the device as a 2FA factor); device-verification emails for non-2FA
sign-ins; user security log. Google: "Your devices" with per-device sessions,
approximate location, sign-out propagation minutes–1 h; security alerts with
Yes/No response flow, mirrored in the account's activity log to defeat phishing.

### Self-hosted precedents (authentik, Plausible, Umami, GitLab, GoTrue)
See consensus pattern 7. The operative spectrum: GoTrue (raw IP, no geo — acceptable
floor) → Plausible (bundled CC-BY country DB + opt-in MaxMind city) → authentik
(bundled city mmdb + sidecar refresh + hot reload). GitLab is the cautionary tale for
edge-header-sourced geo.

## Recommended Approach for Carbon

Grounded against the current branch (`user-devices-login-history`): the session
model, `userLogin` schema, revocation mechanics, and UI already match the industry
consensus — recommendations 1–2 are corrections to the IP/geo sourcing, 3–5 are
follow-ons the survey strengthens.

1. **Replace leftmost-XFF with a single shared `getClientIp` (rightmost-untrusted walk)** —
   the Express/Rails/MDN pattern. One function in `@carbon/utils` (next to the existing
   `normalizeIp`/`isPrivateIp` in `packages/utils/src/ip.ts`): merge all `x-forwarded-for`
   values, walk right→left skipping trusted proxies, return the first valid public address;
   normalize mapped-IPv6 and strip port suffixes; fall back to `x-real-ip`, then null.
   Trust config via env — `TRUSTED_PROXY_COUNT` (self-host behind one Caddy: 1) and/or
   `TRUSTED_PROXY_IPS` CIDRs (CDN-in-front case), with private/loopback ranges always
   treated as proxy space (Rails default) so Docker-internal hops need no enumeration.
   Unconfigured default = rightmost entry only (equivalent to trusting just your own edge,
   never the client's seed). This is portable by construction: on Vercel the platform
   overwrites XFF so the walk finds the same single value today's code finds; behind the
   contrib Caddyfile (`trusted_proxies static private_ranges` forwards the full
   client-seeded chain) it stops reading attacker-controlled input. Then migrate the ~25
   other call sites doing `headers.get("x-forwarded-for") ?? "127.0.0.1"` — several feed
   **rate-limit keying**, where leftmost XFF is a documented bypass (MDN: rate-limiter
   avoidance, memory exhaustion), so this is a security fix beyond login history.
2. **Make geolocation a pluggable login-time resolver: platform headers → optional local
   mmdb → null.** Keep writing `city`/`country` at insert (already the correct
   resolve-at-event-time architecture). Resolver order: (a) `x-vercel-ip-*` when present —
   free and accurate on Vercel Cloud, zero change; (b) a local mmdb file at `GEOIP_DB_PATH`
   read with the `maxmind` npm package (`watchForUpdates: true`), resolving city+country
   (City DB) or country alone (Country DB); (c) neither → nulls, and the existing
   "Local network"/"Unknown location" display fallbacks. For the DB itself, follow
   Plausible, not authentik: the prior decision declining MaxMind (spec changelog
   2026-08-26) stands for *bundling* — GeoLite2 redistribution needs a commercial license
   and imposes a 30-day-freshness duty — but **DB-IP Country Lite is CC BY 4.0 and freely
   redistributable with attribution**, so Carbon can ship country-level geo that works on
   every deployment with zero operator setup, while a self-hoster who wants city-level
   points `GEOIP_DB_PATH` at their own GeoLite2 (documented `maxmindinc/geoipupdate`
   sidecar in `contrib/deploying/`, license key theirs). Never call a geo API on the login
   path: free tiers forbid commercial use or cap hard, and shipping every customer's login
   IPs to a third party creates a GDPR processor relationship no self-hoster agreed to.
3. **Ship the new-login alert email with device + approximate location + security-page
   link** (already spec'd future work — `carbon-device` cookie + `deviceId` column). The
   Discord/Google pattern is the target; recommendation 2 is its prerequisite, or
   self-hosted alerts say "Unknown location" forever (GitLab's exact failure). Start with
   notify-only (Google) rather than blocking verification (Discord) — an ERP login blocked
   on a mis-geolocated VPN hop is a support ticket.
4. **Bound session lifetime with GoTrue's built-in timebox/inactivity settings** rather
   than new code — the Telegram/WhatsApp/Signal consensus that inactive sessions must
   die by themselves. A Carbon-side ladder UI (Telegram's 1 week–6 months) is optional
   polish later.
5. **Skip the 24-hour fresh-session rule for now.** It is Telegram-specific armor for a
   phone-number-recovery auth model; Carbon's magic-link/passkey model plus re-auth-gated
   destructive actions (Discord's password+2FA confirm is the nearest SaaS analog) covers
   the same threat with less friction. Worth revisiting only if Carbon adds
   password-based recovery. Label displayed locations "approximate" (pattern 3), and keep
   the raw IP as a secondary detail — matching GitHub/Google rather than Telegram.

## Sources

### Telegram / WhatsApp
- https://core.telegram.org/constructor/authorization
- https://core.telegram.org/method/account.getAuthorizations
- https://core.telegram.org/method/account.resetAuthorization
- https://core.telegram.org/method/auth.resetAuthorizations
- https://core.telegram.org/method/account.setAuthorizationTTL
- https://core.telegram.org/api/auth
- https://bugs.telegram.org/c/218
- https://telegram.org/blog/sessions-and-2-step-verification
- https://telegram.org/blog/protected-content-delete-by-date-and-more
- https://translations.telegram.org/en/ios/general/Notification.NewAuthDetected
- https://github.com/telegramdesktop/tdesktop/issues/16043
- https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/
- https://faq.whatsapp.com/378279804439436/?cms_platform=android
- https://faq.whatsapp.com/1428782138011916/?cms_platform=web
- https://faq.whatsapp.com/372839278914311

### Signal / Slack / Discord / GitHub / Google
- https://support.signal.org/hc/en-us/articles/360007320551-Linked-Devices
- https://support.signal.org/hc/en-us/articles/360007321111-Unlinking-devices
- https://signal.org/bigbrother/district-of-columbia/
- https://github.com/signalapp/Signal-Android/issues/4614
- https://slack.com/help/articles/214613347-Sign-out-of-Slack
- https://slack.com/help/articles/115005223763-Manage-session-duration
- https://slack.com/help/articles/360002084807-View-Access-Logs-for-your-workspace
- https://docs.slack.dev/reference/methods/admin.users.session.setSettings/
- https://techwiser.com/how-to-check-where-my-discord-account-is-logged-in/
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/viewing-and-managing-your-sessions
- https://github.blog/changelog/2022-11-16-new-session-and-device-management-settings-page/
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/verifying-new-devices-when-signing-in
- https://support.google.com/accounts/answer/3067630
- https://support.google.com/accounts/answer/7305876
- https://guidebooks.google.com/online-security/account-hacked/manage-signed-in-devices

### Client IP extraction
- https://adam-p.ca/blog/2022/03/x-forwarded-for/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
- https://vercel.com/docs/headers/request-headers
- https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/
- https://fly.io/docs/networking/request-headers/
- https://caddyserver.com/docs/caddyfile/options
- https://github.com/caddyserver/caddy/issues/6783
- https://nginx.org/en/docs/http/ngx_http_realip_module.html
- https://expressjs.com/en/guide/behind-proxies.html
- https://api.rubyonrails.org/classes/ActionDispatch/RemoteIp.html
- https://github.com/pbojinov/request-ip
- https://datatracker.ietf.org/doc/html/rfc7239
- https://github.com/express-rate-limit/express-rate-limit/security/advisories/GHSA-46wh-pxpv-q5gq
- https://github.com/fastify/fastify-rate-limit

### Geolocation
- https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/
- https://support.maxmind.com/hc/en-us/articles/4408928143643-Commercial-Redistribution-License-for-GeoLite2
- https://github.com/maxmind/geoipupdate/blob/main/doc/docker.md
- https://www.maxmind.com/en/geoip-accuracy-comparison
- https://www.npmjs.com/package/maxmind
- https://db-ip.com/db/lite.php
- https://ipinfo.io/lite
- https://www.iplocate.io/free-databases
- https://ip-api.com/docs/api:json
- https://docs.goauthentik.io/sys-mgmt/ops/geoip/
- https://version-2025-8.goauthentik.io/releases/2022.12/
- https://github.com/plausible/analytics/pull/906
- https://github.com/plausible/analytics/discussions/4984
- https://deepwiki.com/umami-software/umami/11.4-geo-database-setup
- https://gitlab.com/gitlab-org/gitlab/-/issues/482992
- https://supabase.com/docs/guides/auth/sessions
- https://techgdpr.com/blog/is-an-ip-address-considered-personal-data/
