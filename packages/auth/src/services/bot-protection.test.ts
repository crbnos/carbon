import { afterEach, describe, expect, it, vi } from "vitest";

// botProtection is decided at import time from env, so each case sets the env
// stub, resets the module registry and imports the module fresh.
const env = vi.hoisted(() => ({
  CarbonEdition: "community",
  IS_VERCEL: false,
  BOT_PROTECTION: undefined as string | undefined,
  CLOUDFLARE_TURNSTILE_SITE_KEY: undefined as string | undefined,
  CLOUDFLARE_TURNSTILE_SECRET_KEY: undefined as string | undefined
}));
vi.mock("../config/env", () => env);

const checkBotId = vi.hoisted(() => vi.fn());
vi.mock("botid/server", () => ({ checkBotId }));
vi.mock("./auth-events.server", () => ({ logAuthEvent: vi.fn() }));

async function load(overrides: Partial<typeof env>) {
  Object.assign(env, {
    CarbonEdition: "community",
    IS_VERCEL: false,
    BOT_PROTECTION: undefined,
    CLOUDFLARE_TURNSTILE_SITE_KEY: undefined,
    CLOUDFLARE_TURNSTILE_SECRET_KEY: undefined,
    ...overrides
  });
  vi.resetModules();
  return import("./bot-protection.server");
}

const turnstileKeys = {
  CLOUDFLARE_TURNSTILE_SITE_KEY: "site",
  CLOUDFLARE_TURNSTILE_SECRET_KEY: "secret"
};

afterEach(() => {
  vi.unstubAllGlobals();
  checkBotId.mockReset();
});

describe("botProtection", () => {
  it("defaults to BotID for Cloud on Vercel, even with Turnstile keys set", async () => {
    const auth = await load({
      CarbonEdition: "cloud",
      IS_VERCEL: true,
      ...turnstileKeys
    });
    expect(auth.botProtection).toEqual({ provider: "botid" });
  });

  it("defaults to Turnstile off Vercel when both keys are set", async () => {
    const auth = await load({ CarbonEdition: "cloud", ...turnstileKeys });
    expect(auth.botProtection).toEqual({
      provider: "turnstile",
      siteKey: "site"
    });
  });

  it("defaults to no check with only a site key", async () => {
    const auth = await load({ CLOUDFLARE_TURNSTILE_SITE_KEY: "site" });
    expect(auth.botProtection).toBeNull();
  });

  it("uses BotID when chosen, though Turnstile keys are set for GoTrue", async () => {
    const auth = await load({
      IS_VERCEL: true,
      BOT_PROTECTION: "botid",
      ...turnstileKeys
    });
    expect(auth.botProtection).toEqual({ provider: "botid" });
  });

  it("uses Turnstile when chosen on Vercel Cloud", async () => {
    const auth = await load({
      CarbonEdition: "cloud",
      IS_VERCEL: true,
      BOT_PROTECTION: "turnstile",
      ...turnstileKeys
    });
    expect(auth.botProtection).toEqual({
      provider: "turnstile",
      siteKey: "site"
    });
  });

  it.each([
    ["botid off Vercel", { BOT_PROTECTION: "botid" }],
    ["turnstile without keys", { BOT_PROTECTION: "turnstile" }],
    ["an unknown value", { BOT_PROTECTION: "hcaptcha" }]
  ])("refuses to boot with %s", async (_, overrides) => {
    await expect(load(overrides)).rejects.toThrow(/BOT_PROTECTION/);
  });
});

describe("verifyBotProtection", () => {
  it("blocks a Turnstile login that posted no token", async () => {
    const auth = await load(turnstileKeys);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await auth.verifyBotProtection({ ip: "1.2.3.4" })).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes a token siteverify accepts", async () => {
    const auth = await load(turnstileKeys);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: true }) })
    );
    expect(
      await auth.verifyBotProtection({ token: "t", ip: "1.2.3.4" })
    ).toBeNull();
  });

  it("fails closed when siteverify is unreachable", async () => {
    const auth = await load(turnstileKeys);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(
      await auth.verifyBotProtection({ token: "t", ip: "1.2.3.4" })
    ).not.toBeNull();
  });

  it("fails open when BotID itself throws", async () => {
    const auth = await load({ CarbonEdition: "cloud", IS_VERCEL: true });
    checkBotId.mockRejectedValue(new Error("no OIDC token"));
    expect(await auth.verifyBotProtection({ ip: "1.2.3.4" })).toBeNull();
  });

  it("blocks what BotID calls a bot", async () => {
    const auth = await load({ CarbonEdition: "cloud", IS_VERCEL: true });
    checkBotId.mockResolvedValue({ isBot: true });
    expect(await auth.verifyBotProtection({ ip: "1.2.3.4" })).not.toBeNull();
  });
});
