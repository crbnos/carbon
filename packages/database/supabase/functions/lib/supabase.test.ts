import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { SignJWT } from "npm:jose@5.9.6";
import { requireCaller, requireServiceRole } from "./supabase.ts";

const SECRET = "test-jwt-secret-at-least-32-characters-long";
const SERVICE_KEY = "service-role-env-key";

Deno.env.set("JWT_SECRET", SECRET);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

const sign = (claims: Record<string, unknown>, secret = SECRET) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));

// What an attacker can make without the secret: any header, any payload.
const unsigned = (claims: Record<string, unknown>) =>
  [
    btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    btoa(JSON.stringify(claims)),
    "forged",
  ].join(".");

const request = (token: string) =>
  new Request("http://localhost/fn", {
    headers: { Authorization: `Bearer ${token}` },
  });

Deno.test("a forged service_role token is refused", async () => {
  await assertRejects(() =>
    requireServiceRole(request(unsigned({ role: "service_role" })))
  );
});

Deno.test("a service_role token signed with another secret is refused", async () => {
  const token = await sign({ role: "service_role" }, "some-other-secret-32-characters!!");
  await assertRejects(() => requireServiceRole(request(token)));
});

Deno.test("a correctly signed service_role token is trusted", async () => {
  const token = await sign({ role: "service_role" });
  assertEquals(await requireServiceRole(request(token)), undefined);
});

Deno.test("the service role env key is trusted as-is", async () => {
  assertEquals(await requireServiceRole(request(SERVICE_KEY)), undefined);
});

Deno.test("a forged authenticated token is refused", async () => {
  await assertRejects(() =>
    requireCaller(request(unsigned({ role: "authenticated", sub: "u1" })))
  );
});

Deno.test("a correctly signed authenticated token is accepted", async () => {
  const token = await sign({ role: "authenticated", sub: "u1" });
  assertEquals(await requireCaller(request(token)), undefined);
});
