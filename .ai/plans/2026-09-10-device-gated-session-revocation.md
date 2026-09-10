# Device-Gated Session Revocation — implementation plan

**Spec / source:** [.ai/specs/2026-09-10-device-gated-session-revocation.md](../specs/2026-09-10-device-gated-session-revocation.md)
**Branch:** `user-devices-login-history`

The rule this plan implements, in one sentence: **the caller's device must have
been first seen before the session it wants to end.** No re-authentication
challenge exists anywhere in this design.

## Progress
- [x] Task 1: Add `getClientIp` to `@carbon/utils` and its env vars
- [x] Task 2: Point `recordLogin` at `getClientIp`
- [x] Task 3: Migration — `deviceId` column + index
- [x] Task 4: Regenerate database types
- [x] Task 5: `device.server.ts` — signed device cookie
- [x] Task 6: Store `deviceId` on login; report first-sighting
- [x] Task 7: Thread the device cookie through all six login call sites
- [x] Task 8: `getDeviceFirstSeenAt` service function
- [x] Task 9: Enforce the gate in the `security.tsx` action
- [x] Task 10: Surface the gate in the "Your devices" UI
- [x] Task 11: New-device email template + sender
- [x] Task 12: Extract translations
- [x] Task 13: End-to-end verification

## Dependencies
- Task 2 needs Task 1
- Task 4 needs Task 3
- Task 6 needs Tasks 4 and 5
- Task 7 needs Task 6
- Task 8 needs Task 4
- Task 9 needs Task 8
- Task 10 needs Task 9
- Task 11 needs Task 6
- Tasks 1–2 are independent of Tasks 3–5 and may run in parallel
- Task 12 needs Task 10; Task 13 needs everything

---

## Task 1: Add `getClientIp` to `@carbon/utils` and its env vars

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/ip.ts` — add `getClientIp`
- Create: `packages/utils/src/ip.test.ts` additions (file exists; append cases)
- Modify: `packages/env/src/index.ts` — add `TRUSTED_PROXY_COUNT`, `TRUSTED_PROXY_IPS`
- Copy from (precedent): `packages/utils/src/ip.ts` (existing `normalizeIp` / `isPrivateIp` style)

**Steps:**

1. In `packages/env/src/index.ts`, next to the other optional vars, add:
   ```ts
   export const TRUSTED_PROXY_COUNT = getEnv("TRUSTED_PROXY_COUNT", {
     isRequired: false,
     isSecret: false
   });
   export const TRUSTED_PROXY_IPS = getEnv("TRUSTED_PROXY_IPS", {
     isRequired: false,
     isSecret: false
   });
   ```

2. In `packages/utils/src/ip.ts`, add below the existing exports. Do NOT import
   `@carbon/env` here — `@carbon/utils` must stay dependency-free; the caller
   passes options in.

   ```ts
   export type ClientIpOptions = {
     /** How many rightmost x-forwarded-for hops are our own proxies. */
     trustedProxyCount?: number;
     /** Explicit proxy addresses to skip, in addition to the count. */
     trustedProxyIps?: string[];
   };

   /**
    * The client address, read RIGHT to LEFT.
    *
    * The leftmost x-forwarded-for hop is whatever the client sent, so it is
    * attacker-controlled on any deployment whose edge appends rather than
    * replaces the header (Carbon's self-hosted Caddy does exactly this —
    * `trusted_proxies static private_ranges`). Walking from the right and
    * skipping the hops we know are ours yields the first address our own
    * infrastructure actually observed.
    *
    * With no trusted-proxy configuration this returns the RIGHTMOST hop, which
    * is the conservative answer: it may be our own proxy, but it is never
    * attacker-supplied.
    */
   export function getClientIp(
     request: Request,
     options: ClientIpOptions = {}
   ): string | null {
     const { trustedProxyCount = 0, trustedProxyIps = [] } = options;

     // A repeated header arrives joined by ", " in the Fetch API, so one read
     // covers both shapes.
     const forwarded = request.headers.get("x-forwarded-for");
     const hops = (forwarded ?? "")
       .split(",")
       .map((hop) => normalizeIp(stripPort(hop)))
       .filter((hop): hop is string => hop !== null);

     if (hops.length === 0) {
       return normalizeIp(stripPort(request.headers.get("x-real-ip")));
     }

     const trusted = new Set(
       trustedProxyIps
         .map((ip) => normalizeIp(ip))
         .filter((ip): ip is string => ip !== null)
     );

     let index = hops.length - 1 - trustedProxyCount;
     while (index >= 0 && trusted.has(hops[index]!)) index--;

     // Everything was trusted: the leftmost hop is the only candidate left, and
     // it is the client's own claim. Prefer it over returning nothing, but it
     // is exactly the value the walk exists to avoid trusting blindly.
     return hops[Math.max(index, 0)] ?? null;
   }

   /**
    * Remove a ":port" suffix (AWS ALB appends one). IPv6 is bracketed when it
    * carries a port, so a bare colon-count check distinguishes the two safely.
    */
   function stripPort(value: string | null | undefined): string | null {
     if (!value) return null;
     const trimmed = value.trim();
     const bracketed = trimmed.match(/^\[(.+)\](?::\d+)?$/);
     if (bracketed) return bracketed[1]!;
     const colons = trimmed.split(":").length - 1;
     if (colons === 1) return trimmed.split(":")[0]!;
     return trimmed;
   }
   ```

3. Append tests to `packages/utils/src/ip.test.ts`:
   ```ts
   describe("getClientIp", () => {
     const req = (headers: Record<string, string>) =>
       new Request("https://erp.example.com/", { headers });

     it("returns the rightmost hop when no proxies are trusted", () => {
       expect(
         getClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))
       ).toBe("10.0.0.1");
     });

     it("skips a trusted proxy count to reach the real client", () => {
       expect(
         getClientIp(req({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.1" }), {
           trustedProxyCount: 1
         })
       ).toBe("1.2.3.4");
     });

     it("ignores a client-seeded leftmost hop", () => {
       expect(
         getClientIp(req({ "x-forwarded-for": "evil, 1.2.3.4" }), {
           trustedProxyCount: 0
         })
       ).toBe("1.2.3.4");
     });

     it("skips explicitly trusted proxy addresses", () => {
       expect(
         getClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), {
           trustedProxyIps: ["10.0.0.1"]
         })
       ).toBe("1.2.3.4");
     });

     it("strips an ALB port suffix", () => {
       expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4:53819" }))).toBe(
         "1.2.3.4"
       );
     });

     it("normalizes IPv4-mapped IPv6", () => {
       expect(
         getClientIp(req({ "x-forwarded-for": "::ffff:127.0.0.1" }))
       ).toBe("127.0.0.1");
     });

     it("falls back to x-real-ip when the chain is absent", () => {
       expect(getClientIp(req({ "x-real-ip": "1.2.3.4" }))).toBe("1.2.3.4");
     });

     it("returns null when no address headers are present", () => {
       expect(getClientIp(req({}))).toBeNull();
     });
   });
   ```
   Add `getClientIp` to the existing import at the top of that file.

**Verify:**
```bash
cd packages/utils && pnpm exec vitest run src/ip.test.ts
# Expected: "Test Files  1 passed", all getClientIp cases passing
```

**Out of scope:** The ~25 other call sites that read `x-forwarded-for` directly
(including rate-limit keying). Do not touch them — the spec scopes this to
`recordLogin` only.

---

## Task 2: Point `recordLogin` at `getClientIp`

**Depends on:** Task 1
**Files:**
- Modify: `packages/auth/src/services/login-history.server.ts` — replace the IP read

**Steps:**

1. Change the `@carbon/utils` import to bring in `getClientIp` alongside
   `normalizeIp`.
2. Add to the `@carbon/auth` env imports:
   `TRUSTED_PROXY_COUNT`, `TRUSTED_PROXY_IPS` (they re-export from `@carbon/env`
   via `../config/env`; follow the existing import style in this file).
3. Replace this block:
   ```ts
   const ipAddress =
     normalizeIp(request.headers.get("x-forwarded-for")?.split(",")[0]) ??
     normalizeIp(request.headers.get("x-real-ip"));
   ```
   with:
   ```ts
   // Right-to-left walk past our own proxies. The leftmost hop is whatever the
   // client sent — see getClientIp.
   const ipAddress = getClientIp(request, {
     trustedProxyCount: TRUSTED_PROXY_COUNT
       ? Number.parseInt(TRUSTED_PROXY_COUNT, 10)
       : 0,
     trustedProxyIps: TRUSTED_PROXY_IPS
       ? TRUSTED_PROXY_IPS.split(",").map((ip) => ip.trim())
       : []
   });
   ```
4. Delete the now-stale comment above it ("First hop of x-forwarded-for is the
   client; the rest are proxies.") — it states the opposite of the new behaviour.
5. Leave the `normalizeIp` import in place only if still used elsewhere in the
   file; remove it from the import if not.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: "Tasks: 1 successful", no TS errors
cd packages/auth && pnpm exec vitest run src/services/login-history.test.ts
# Expected: all existing tests still pass
```

**Out of scope:** Changing what is stored (still a plain string in
`userLogin.ipAddress`).

**Deviation (executed):** the plan said to import `TRUSTED_PROXY_*` from
`../config/env`. That import pulls in `@carbon/env`, which validates EVERY
required var at module load, so it broke this file's existing tests on an
unrelated missing var (`INNGEST_SIGNING_KEY`). Read from `process.env` at call
time instead. Also updated one existing test that asserted the old leftmost-hop
IP — it encoded the vulnerability being fixed.

---

## Task 3: Migration — `deviceId` column + index

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_user-login-device-id.sql`

**Steps:**

1. Generate the file:
   ```bash
   pnpm db:migrate:new user-login-device-id
   ```
2. Write exactly this into the generated file:
   ```sql
   -- Device recognition for the revoke gate (spec:
   -- .ai/specs/2026-09-10-device-gated-session-revocation.md). Opaque id from
   -- the signed "carbon-device" cookie. Nullable: rows recorded before this
   -- feature, and logins from a client that refuses cookies, have none and are
   -- treated as unrecognised (which refuses cross-session revoke).
   ALTER TABLE "userLogin" ADD COLUMN "deviceId" TEXT;

   -- The gate asks "when was this (userId, deviceId) pair first seen?" on every
   -- revoke, and "have we seen it at all?" on every login.
   CREATE INDEX "userLogin_userId_deviceId_idx"
     ON "userLogin" ("userId", "deviceId");
   ```
3. Apply it:
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
pnpm db:migrate
# Expected: "migrations applied" with no error
```

**Out of scope:** Do NOT fold this into
`20260910000000_user-devices-login-history.sql`. That migration is committed and
may already be applied elsewhere; this is a separate, additive change.

---

## Task 4: Regenerate database types

**Depends on:** Task 3
**Files:**
- Modify: `packages/database/src/types.ts` (generated)
- Modify: `packages/database/supabase/functions/lib/types.ts` (generated)

**Steps:**

1. Run:
   ```bash
   pnpm run generate:types
   ```
2. Confirm `deviceId` now appears in the `userLogin` block of
   `packages/database/src/types.ts`.
3. **If the diff removes unrelated tables or columns** (e.g. `capacityReservation`
   disappears, or thousands of lines are deleted), the local database is behind
   `origin/main`. STOP, run `pnpm db:migrate` again, and re-run the generator. Do
   not commit a types file that drops unrelated schema.

**Verify:**
```bash
grep -A12 'userLogin: {' packages/database/src/types.ts | grep deviceId
# Expected: "deviceId: string | null"
git diff --stat packages/database/src/types.ts
# Expected: a small diff (tens of lines), not thousands of deletions
```

**Out of scope:** Hand-editing the generated types.

---

## Task 5: `device.server.ts` — signed device cookie

**Depends on:** none
**Files:**
- Create: `packages/auth/src/services/device.server.ts`
- Create: `packages/auth/src/services/device.test.ts`
- Modify: `packages/auth/package.json` — add the export subpath
- Copy from (precedent): `packages/auth/src/services/session.server.ts` (lines
  around `createCookieSessionStorage`, for the cookie config and `SESSION_SECRET`
  usage)

**Steps:**

1. Add to the `"exports"` map in `packages/auth/package.json`, keeping
   alphabetical order relative to its neighbours:
   ```json
   "./device.server": "./src/services/device.server.ts",
   ```

2. Create `packages/auth/src/services/device.server.ts`:
   ```ts
   import { createCookieSessionStorage } from "react-router";
   import { CarbonEdition, DOMAIN, SESSION_SECRET } from "../config/env";
   import { getCookieDomain } from "../utils/cookie";
   import { Edition } from "@carbon/utils";

   const isTestEdition = CarbonEdition === Edition.Test;
   const cookieDomain = isTestEdition ? undefined : getCookieDomain(DOMAIN);

   /**
    * One year. This cookie's whole purpose is to outlive the 7-day session —
    * a device that is forgotten every week can never be older than an
    * attacker's fresh one.
    */
   const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

   const DEVICE_KEY = "deviceId";

   // Separate cookie from "carbon": it must survive logout, which clears that
   // one. Signed with the same secret so a forged deviceId fails validation —
   // an unsigned cookie would let anyone claim an established device.
   const deviceStorage = createCookieSessionStorage({
     cookie: {
       name: "carbon-device",
       httpOnly: true,
       path: "/",
       sameSite: isTestEdition ? "none" : "lax",
       secrets: [SESSION_SECRET!],
       secure: !!cookieDomain,
       domain: cookieDomain
     }
   });

   export async function getDeviceId(request: Request): Promise<string | null> {
     try {
       const session = await deviceStorage.getSession(
         request.headers.get("Cookie")
       );
       const deviceId = session.get(DEVICE_KEY);
       return typeof deviceId === "string" && deviceId.length > 0
         ? deviceId
         : null;
     } catch {
       // Tampered or undecryptable cookie — treat as a device we have never
       // seen, never as a valid id.
       return null;
     }
   }

   /**
    * The device id for this request, minting one when absent. Returns the
    * `Set-Cookie` value ONLY when a new id was issued, so callers can append it
    * to the response they were already sending.
    *
    * Never throws: a client that refuses cookies still logs in, and is simply
    * treated as an unrecognised device on every request.
    */
   export async function ensureDeviceId(
     request: Request
   ): Promise<{ deviceId: string; setCookie?: string }> {
     const existing = await getDeviceId(request);
     if (existing) return { deviceId: existing };

     const deviceId = crypto.randomUUID();
     const session = await deviceStorage.getSession();
     session.set(DEVICE_KEY, deviceId);
     const setCookie = await deviceStorage.commitSession(session, {
       maxAge: DEVICE_COOKIE_MAX_AGE
     });
     return { deviceId, setCookie };
   }
   ```

3. Create `packages/auth/src/services/device.test.ts`. Mock the env module the
   same way `destroy-session.test.ts` does (read that file first and mirror its
   `vi.mock` of `../config/env`), then:
   ```ts
   describe("device cookie", () => {
     it("mints a device id and returns a Set-Cookie when absent", async () => {
       const { deviceId, setCookie } = await ensureDeviceId(
         new Request("https://erp.example.com/callback")
       );
       expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
       expect(setCookie).toContain("carbon-device=");
     });

     it("reuses an existing device id and issues no new cookie", async () => {
       const first = await ensureDeviceId(
         new Request("https://erp.example.com/callback")
       );
       const second = await ensureDeviceId(
         new Request("https://erp.example.com/callback", {
           headers: { Cookie: first.setCookie!.split(";")[0]! }
         })
       );
       expect(second.deviceId).toBe(first.deviceId);
       expect(second.setCookie).toBeUndefined();
     });

     it("treats a tampered cookie as no device", async () => {
       expect(
         await getDeviceId(
           new Request("https://erp.example.com/callback", {
             headers: { Cookie: "carbon-device=garbage.notasignature" }
           })
         )
       ).toBeNull();
     });

     it("returns null when the cookie is absent", async () => {
       expect(
         await getDeviceId(new Request("https://erp.example.com/callback"))
       ).toBeNull();
     });
   });
   ```

**Verify:**
```bash
cd packages/auth && pnpm exec vitest run src/services/device.test.ts
# Expected: "Test Files  1 passed", 4 tests passing
```

**Out of scope:** Device naming, listing, or a "forget this device" control.

---

## Task 6: Store `deviceId` on login; report first-sighting

**Depends on:** Tasks 4, 5
**Files:**
- Modify: `packages/auth/src/services/login-history.server.ts`

**Steps:**

1. Import `getDeviceId` from `./device.server`.
2. Add `deviceId?: string | null` to `recordLogin`'s params object and destructure
   it. Callers that omit it fall back to reading the cookie themselves:
   ```ts
   const resolvedDeviceId = deviceId ?? (await getDeviceId(request));
   ```
3. Add `deviceId: resolvedDeviceId` to the `insert({ ... })` object.
4. Change the return type from `Promise<void>` to
   `Promise<{ isNewDevice: boolean }>`. Determine it BEFORE the insert, so the
   row this call writes does not count as a prior sighting:
   ```ts
   // Checked before the insert: this login's own row must not count as a
   // previous sighting of the device.
   let isNewDevice = false;
   if (resolvedDeviceId) {
     const { count } = await serviceRole
       .from("userLogin")
       .select("id", { count: "exact", head: true })
       .eq("userId", userId)
       .eq("deviceId", resolvedDeviceId);
     isNewDevice = (count ?? 0) === 0;
   }
   ```
5. Return `{ isNewDevice }` on the success path AND from the `catch` block —
   the function's never-throws contract is unchanged, and a failure to determine
   novelty must report `false` rather than firing a spurious alert:
   ```ts
   } catch (error) {
     log.warn("Failed to record login history", { error, userId, app });
     return { isNewDevice: false };
   }
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: "Tasks: 1 successful"
cd packages/auth && pnpm exec vitest run src/services/login-history.test.ts
# Expected: existing tests pass; update any that assert a void return
```

**Out of scope:** Sending the email (Task 11).

---

## Task 7: Thread the device cookie through all six login call sites

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/routes/_public+/callback.tsx` — SSO branch and main branch
- Modify: `apps/erp/app/routes/_public+/login.tsx` — dev bypass
- Modify: `apps/erp/app/routes/_public+/verify.tsx` — signup
- Modify: `apps/erp/app/routes/api+/passkey.authenticate.verify.ts`
- Modify: `apps/mes/app/routes/_public+/callback.tsx` — SSO branch and main branch
- Modify: `apps/mes/app/routes/api+/passkey.authenticate.verify.ts`

**Steps:**

For each `recordLogin(...)` call site (there are 8 calls across 6 files — both
callbacks have an SSO call and a main call):

1. Import `ensureDeviceId` from `@carbon/auth/device.server`.
2. Before the `recordLogin` call, add:
   ```ts
   const { deviceId, setCookie: deviceCookie } = await ensureDeviceId(request);
   ```
3. Pass `deviceId` into the `recordLogin` params.
4. Append the cookie to the response headers **only when present**. The headers
   are already `["Set-Cookie", value]` pair arrays, so:
   ```ts
   const headers: [string, string][] = [["Set-Cookie", sessionCookie]];
   if (deviceCookie) headers.push(["Set-Cookie", deviceCookie]);
   ```
   Follow whatever local variable the route already uses for its headers array —
   in `apps/erp/app/routes/_public+/callback.tsx` the SSO branch builds the array
   inline inside `redirect(...)`; convert it to a local first.

5. For `passkey.authenticate.verify.ts` in both apps, the route returns JSON
   rather than a redirect. Add the cookie via the response's `headers` init; read
   the file first and follow its existing return shape.

**If a call site returns a bare `redirect()` with no headers option, STOP and
report** rather than restructuring the route — that indicates a shape this plan
did not anticipate.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: "Tasks: 2 successful"
grep -c "ensureDeviceId" apps/erp/app/routes/_public+/callback.tsx apps/mes/app/routes/_public+/callback.tsx
# Expected: 1 import per file (the two calls in each share it)
```

**Out of scope:** `unlock.tsx`, `refresh-session.tsx`, `/mfa` — they are not
logins and must not record or mint anything.

---

## Task 8: `getDeviceFirstSeenAt` service function

**Depends on:** Task 4
**Files:**
- Modify: `apps/erp/app/modules/account/account.service.ts`
- Copy from (precedent): the existing `getLoginHistory` in the same file

**Steps:**

1. Add below `getLoginHistory`:
   ```ts
   /**
    * When this device was FIRST seen for this user, or null if never.
    *
    * This is the device's age, and the whole basis of the revoke gate: a device
    * may only end sessions that began after it first appeared. Null means
    * unrecognised — no cookie, a tampered one, or a genuinely new browser —
    * which can revoke nothing but itself.
    */
   export async function getDeviceFirstSeenAt(
     client: SupabaseClient<Database>,
     userId: string,
     deviceId: string | null
   ): Promise<string | null> {
     if (!deviceId) return null;
     const { data } = await client
       .from("userLogin")
       .select("createdAt")
       .eq("userId", userId)
       .eq("deviceId", deviceId)
       .order("createdAt", { ascending: true })
       .limit(1)
       .maybeSingle();
     return data?.createdAt ?? null;
   }
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful"
```

**Out of scope:** Caching. One indexed lookup per page load is fine.

---

## Task 9: Enforce the gate in the `security.tsx` action

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/routes/x+/account+/security.tsx` — `action` only

**Steps:**

1. Import `getDeviceId` from `@carbon/auth/device.server` and
   `getDeviceFirstSeenAt` from `~/modules/account`.

2. In the `revokeSession` branch, after the existing self-revocation guard and
   before calling `revokeSession`, add:
   ```ts
   // The caller's device must predate the session it is ending. An attacker's
   // freshly-minted browser is always newer than the owner's established one,
   // and cannot become older by waiting.
   const deviceFirstSeenAt = await getDeviceFirstSeenAt(
     client,
     sessionUserId,
     await getDeviceId(request)
   );
   const target = devices.find((d) => d.sessionId === sessionId);
   if (
     !deviceFirstSeenAt ||
     !target ||
     Date.parse(deviceFirstSeenAt) >= Date.parse(target.startedAt)
   ) {
     return data(
       error(null, "Sign out from a device you've used for longer"),
       { status: 403 }
     );
   }
   ```
   The action needs `client` from `requirePermissions` — it currently destructures
   only `sessionUserId`; add `client`.

   It also needs each live session's start time. Add a helper alongside
   `getActiveSessions` usage: re-read the caller's live sessions and their login
   rows in the action exactly as the loader does, or extract the loader's
   device-building block into a shared function in the same file and call it from
   both. **Prefer the extraction** — two copies of the join would drift.

3. In the `revokeOtherSessions` branch, apply the same rule against **every**
   other session, refusing the whole action if any one of them predates the
   device:
   ```ts
   const blocked = otherDevices.some(
     (d) => Date.parse(deviceFirstSeenAt) >= Date.parse(d.startedAt)
   );
   if (!deviceFirstSeenAt || blocked) {
     return data(
       error(null, "Sign out from a device you've used for longer"),
       { status: 403 }
     );
   }
   ```

4. `startedAt` per device comes from its login row's `createdAt` where one
   exists, else the GoTrue session's `createdAt`. Add it to the device objects
   built in the loader (Task 10 consumes it too).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful"
```

**Out of scope:** Self-termination — it must remain reachable in every branch.
Do not add a device check to it.

---

## Task 10: Surface the gate in the "Your devices" UI

**Depends on:** Task 9
**Files:**
- Modify: `apps/erp/app/routes/x+/account+/security.tsx` — loader + component
- Copy from (precedent): the existing `canRevoke` flag already returned by this
  loader and consumed in the devices card

**Steps:**

1. In the loader, compute per-device rather than page-wide. Replace the existing
   page-level `canRevoke` with a per-row field on each device object:
   ```ts
   // A device may only end sessions that began after it first appeared.
   canRevoke:
     deviceFirstSeenAt !== null &&
     Date.parse(deviceFirstSeenAt) < Date.parse(startedAt),
   ```
   and keep a page-level `canRevokeAll` = every non-current device is revocable
   AND `deviceFirstSeenAt !== null`.

2. In the component, replace the current `canRevoke && (...)` wrapper around the
   per-row `IconButton` with `device.canRevoke && (...)`, and render a disabled
   state with an explanation when false:
   ```tsx
   ) : device.canRevoke ? (
     <IconButton … />
   ) : (
     <span className="text-xs text-muted-foreground">
       <Trans>Newer device</Trans>
     </span>
   )}
   ```

3. Drive the "Sign out other devices" button's `isDisabled` from `canRevokeAll`
   instead of the old `hasOtherDevices` expression, and add a `Tooltip` (already
   imported in `@carbon/react`; check the file's existing imports) reading
   *"Sign out from a device you've used for longer"* when disabled.

4. Every new string goes through `<Trans>` or `` t`…` `` — no bare English.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful"
pnpm exec biome check apps/erp/app/routes/x+/account+/security.tsx
# Expected: "No fixes applied" or a clean check
```

**Out of scope:** Redesigning the devices card. Only the revoke affordances change.

---

## Task 11: New-device email template + sender

**Depends on:** Task 6
**Files:**
- Create: `packages/documents/src/email/NewDeviceEmail.tsx`
- Modify: `packages/documents/src/email/index.ts` — export it
- Modify: `apps/erp/app/services/mfa-email.server.ts` — add `sendNewDeviceEmail`
- Modify: the two ERP callback call sites + ERP passkey verify to call it
- Copy from (precedent): `packages/documents/src/email/MfaEnabledEmail.tsx` and
  `sendMfaEnabledEmail` in `apps/erp/app/services/mfa-email.server.ts`

**Steps:**

1. Create `NewDeviceEmail.tsx` by copying `MfaEnabledEmail.tsx` and changing the
   copy. Props: `recipientName?: string`, `deviceLabel: string`,
   `signedInAt: string`, `securityUrl: string`. Body text: a new device signed
   in, naming the device and time, and telling them to review their devices if it
   was not them.
   **Include NO IP address and NO location** — the spec forbids both.

2. Export it from `packages/documents/src/email/index.ts` following the existing
   import-then-list pattern.

3. Add `sendNewDeviceEmail` to `apps/erp/app/services/mfa-email.server.ts`,
   copying `sendMfaEnabledEmail`'s shape exactly — same `getUser` lookup, same
   `trigger("send-email", …)`, same try/catch that logs and never throws.
   Signature:
   ```ts
   export async function sendNewDeviceEmail(
     serviceRole: SupabaseClient<Database>,
     companyId: string,
     userId: string,
     deviceLabel: string
   )
   ```

4. At each ERP login call site, when `recordLogin` returns `isNewDevice: true`
   and a `companyId` is resolvable, call it. Build `deviceLabel` with
   `parseUserAgent(request.headers.get("user-agent"))` → `"Chrome on macOS"`,
   falling back to `"Unknown device"`.

5. When no `companyId` is resolvable (pre-company-selection), skip the email
   silently — the spec accepts this.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents
# Expected: "Tasks: 2 successful"
grep -iE "ipAddress|location|city|country" packages/documents/src/email/NewDeviceEmail.tsx
# Expected: NO output — the template must not reference any of these
```

**Out of scope:** MES alerts (no MES account UI to link to), and the
account-lockout alert email.

---

## Task 12: Extract translations

**Depends on:** Task 10
**Files:**
- Modify: `packages/locale/locales/*/erp.po` (generated)

**Steps:**
1. Run:
   ```bash
   pnpm lingui:extract
   ```
2. Confirm the new strings appear in `packages/locale/locales/en/erp.po`.

**Verify:**
```bash
grep -c "Newer device" packages/locale/locales/en/erp.po
# Expected: at least 1
```

**Out of scope:** Translating into the other 12 locales — that is `/translate`,
run separately by the user.

---

## Task 13: End-to-end verification

**Depends on:** all previous tasks
**Files:** none (verification only)

**Steps:**

1. Full scoped typecheck:
   ```bash
   pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=mes --filter=@carbon/documents --filter=@carbon/utils
   ```
2. Unit tests:
   ```bash
   cd packages/auth && pnpm exec vitest run
   cd ../utils && pnpm exec vitest run
   ```
3. Lint the touched files:
   ```bash
   pnpm exec biome check $(git diff --name-only | grep -E '\.(ts|tsx)$')
   ```
4. Confirm the migration is applied and the dataset gate passes:
   ```bash
   pnpm db:check:datasets
   ```
5. Manually confirm the SQL-level rule with a query against the local DB —
   a device's first sighting must be `MIN(createdAt)` for its pair:
   ```sql
   SELECT "deviceId", MIN("createdAt") FROM "userLogin"
   WHERE "userId" = '<some user>' GROUP BY "deviceId";
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/auth --filter=erp --filter=mes --filter=@carbon/documents --filter=@carbon/utils
# Expected: "Tasks: 5 successful" (or 6 with a cached entry), zero TS errors
```

**Out of scope:** Browser testing — requires a running stack and is the user's call.
