// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/// <reference types="node" />
import { createHash } from "node:crypto";
import { FlagdCore } from "@openfeature/flagd-core";
import flagdCorePackage from "@openfeature/flagd-core/package.json";
import {
  type Client,
  type EvaluationContext,
  type JsonValue,
  type Logger,
  OpenFeature,
  type Provider,
  type ResolutionDetails
} from "@openfeature/server-sdk";
import {
  BROWSER_FLAG_KEYS,
  type BrowserFlags,
  type FlagKey,
  flagDefault
} from "./flags";
import {
  CARBON_COMMIT_SHA,
  CARBON_FLAGS_ENDPOINT,
  CARBON_FLAGS_HEADERS,
  CarbonEdition,
  SINGLE_TENANT
} from "./index";

// How often a process re-reads the shared copy, and how old the shared copy may
// get before one process fetches the source again. Both get ±20% jitter.
const STORE_SYNC_MS = 10_000;
const SOURCE_REFRESH_MS = 60_000;
const JITTER = 0.2;
const FETCH_TIMEOUT_MS = 5_000;
// A cold start with nothing in the store waits this long for a first document.
const BOOT_WAIT_MS = 2_000;
const BOOT_POLL_MS = 250;
const MAX_BODY_BYTES = 1 << 20;

type WarnFn = (message: string, properties: Record<string, unknown>) => void;

// The default when the app passes no `onWarning`.
const consoleWarn: WarnFn = (message, properties) => {
  // biome-ignore lint/suspicious/noConsole: @carbon/logger depends on this package
  console.warn(`flags: ${message}`, properties);
};

/**
 * `CARBON_FLAGS_HEADERS` in the `OTEL_EXPORTER_OTLP_HEADERS` format: `k=v`
 * pairs separated by commas, keys and values percent-encoded. A malformed pair
 * is skipped, never thrown: flags must not stop the app from starting.
 */
export function parseHeaders(raw = ""): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const i = pair.indexOf("=");
    const key = pair.slice(0, i).trim();
    if (i < 0 || !key) continue;
    try {
      // Header names are case-insensitive: keep one spelling, the last wins.
      const name = decodeURIComponent(key).toLowerCase();
      if (name in headers) {
        consoleWarn("A CARBON_FLAGS_HEADERS name appears twice", { name });
      }
      headers[name] = decodeURIComponent(pair.slice(i + 1).trim());
    } catch {
      consoleWarn("Skipping a malformed CARBON_FLAGS_HEADERS pair", { key });
    }
  }
  return headers;
}

export type StoredFlags = { body: string; etag: string; fetchedAt: number };

export type FlagsStoreLease =
  | { status: "acquired"; release: () => Promise<void> }
  | { status: "held" }
  | { status: "unavailable" };

/**
 * The copy of the flags document that every process of one instance shares.
 * `@carbon/kv` implements it with Redis (`redisFlagsStore`); it cannot live
 * here because `@carbon/kv` depends on this package. Reads answer null on a
 * miss or when the store is down; only `tryLease` tells the two apart.
 */
export type FlagsStore = {
  readMeta(scope: string): Promise<Omit<StoredFlags, "body"> | null>;
  readBody(scope: string): Promise<string | null>;
  write(
    scope: string,
    value: Partial<StoredFlags> & { fetchedAt: number }
  ): Promise<void>;
  tryLease(scope: string): Promise<FlagsStoreLease>;
};

export type CarbonFlagsOptions = {
  endpoint?: string;
  /** Raw `CARBON_FLAGS_HEADERS`. */
  headers?: string;
  /** The build's git commit, sent to the source as `X-Carbon-Commit`. */
  commit?: string;
  store?: FlagsStore;
  /** Keeps a background sync alive after the response is sent (Vercel). */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Receives each warning with structured properties: a failed sync
   * (`lastError`, `confirmedAt`, `ageMs`) and a read of an archived flag
   * (`key`). The apps pass their logger, so Axiom can alert on stale flags.
   */
  onWarning?: WarnFn;
  tenancy?: "single" | "multi";
  edition?: string;
};

type Mode = "none" | "static" | "remote";

const isLocalhost = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
};

const jittered = (ms: number) => ms * (1 - JITTER + 2 * JITTER * Math.random());
const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms).unref?.());

async function readCapped(res: Response): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    throw new Error("the flags document is larger than 1 MB");
  }
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("the flags document is larger than 1 MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * An OpenFeature provider over a flagd JSON document, in three layers: the
 * document parsed in process memory (every evaluation, no I/O), the copy in
 * the store (re-read every 10 s), and the source (fetched under a lease when
 * the store's copy is older than 60 s). A `data:` endpoint is
 * loaded once and never touches the store.
 */
export class CarbonFlagsProvider implements Provider {
  readonly metadata = { name: "carbon-flags" };
  readonly runsOn = "server" as const;

  /** Last time the source confirmed the document (a 200 or a 304). */
  confirmedAt?: number;
  lastError?: string;

  private readonly core = new FlagdCore();
  private readonly mode: Mode;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly scope: string;
  private readonly store?: FlagsStore;
  private readonly waitUntil?: (promise: Promise<unknown>) => void;
  private readonly onWarning: WarnFn;
  private readonly context: { tenancy: string; edition: string };
  private loadedEtag?: string;
  private storeUnavailable = false;
  private nextSyncAt = 0;
  private inFlight?: Promise<void>;
  private readonly warnedArchived = new Set<string>();

  constructor(options: CarbonFlagsOptions) {
    this.endpoint = options.endpoint ?? "";
    // https: polls, data: loads once, and http: polls only on localhost (a
    // local source in dev): the request carries the token. Anything else,
    // file: included, is refused here rather than failing in fetch().
    const scheme = /^[a-z][a-z0-9+.-]*:/i
      .exec(this.endpoint)?.[0]
      .toLowerCase();
    this.mode = !this.endpoint
      ? "none"
      : scheme === "https:" ||
          (scheme === "http:" && isLocalhost(this.endpoint))
        ? "remote"
        : scheme === "data:"
          ? "static"
          : "none";
    // The source sees which build each instance runs. Configured headers win.
    this.headers = {
      // 12 characters on every platform, the length BYOC's release
      // versions carry, so the source can compare them.
      ...(options.commit
        ? { "x-carbon-commit": options.commit.slice(0, 12) }
        : {}),
      ...parseHeaders(options.headers)
    };
    // Keyed by the flagd-core version too: processes on two versions that
    // parse a document differently each keep their own shared copy.
    this.scope = createHash("sha256")
      .update(
        `${this.endpoint}\n${options.headers ?? ""}\n${flagdCorePackage.version}`
      )
      .digest("hex")
      .slice(0, 16);
    this.store = options.store;
    this.waitUntil = options.waitUntil;
    this.onWarning = options.onWarning ?? consoleWarn;
    if (this.endpoint && this.mode === "none") {
      this.onWarning(
        "CARBON_FLAGS_ENDPOINT must be an https: or data: URL (http: only on localhost); using the code defaults",
        { scheme: scheme ?? null }
      );
    }
    this.context = {
      tenancy: options.tenancy ?? "multi",
      edition: options.edition ?? "community"
    };
  }

  async initialize() {
    if (this.mode === "none") return;
    if (this.mode === "static") {
      try {
        // Node's fetch reads data: URLs.
        this.apply(await readCapped(await fetch(this.endpoint)), "static");
        this.confirmedAt = Date.now();
      } catch (error) {
        this.fail(error);
      }
      return;
    }

    // Start on the shared copy and refresh in the background.
    if (this.store && (await this.loadFromStore())) {
      this.maybeSync();
      return;
    }

    // Nothing shared yet: wait a little for this process's own sync, or for
    // the process that holds the lease to write the first copy.
    const deadline = Date.now() + BOOT_WAIT_MS;
    const boot = this.sync();
    this.waitUntil?.(boot);
    await Promise.race([boot, sleep(BOOT_WAIT_MS)]);
    while (
      !this.loadedEtag &&
      this.store &&
      !this.storeUnavailable &&
      Date.now() < deadline
    ) {
      await sleep(BOOT_POLL_MS);
      await this.loadFromStore();
    }
  }

  /** Runs a sync now. Used by tests. */
  refresh(): Promise<void> {
    this.nextSyncAt = 0;
    return this.sync();
  }

  private apply(body: string, etag: string) {
    this.core.setConfigurations(body);
    this.loadedEtag = etag;
  }

  private fail(error: unknown) {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.onWarning("Feature flags kept after a failed sync", {
      lastError: this.lastError,
      confirmedAt: this.confirmedAt ?? null,
      ageMs: this.confirmedAt ? Date.now() - this.confirmedAt : null
    });
  }

  private async loadFromStore(): Promise<boolean> {
    if (!this.store) return false;
    try {
      const [meta, body] = await Promise.all([
        this.store.readMeta(this.scope),
        this.store.readBody(this.scope)
      ]);
      if (!meta || !body) return false;
      if (meta.etag !== this.loadedEtag) this.apply(body, meta.etag);
      this.confirmedAt = meta.fetchedAt;
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private async fetchSource(
    etag: string | undefined
  ): Promise<{ status: 200; body: string; etag: string } | { status: 304 }> {
    const res = await fetch(this.endpoint, {
      headers: { ...this.headers, ...(etag && { "If-None-Match": etag }) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (res.status === 304) return { status: 304 };
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new Error(`the flags source answered ${res.status}`);
    }
    const body = await readCapped(res);
    // Callers apply() the body before they write it to the store. apply()
    // throws on an invalid document, so a bad one never spreads.
    const responseEtag =
      res.headers.get("etag") ??
      `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
    return { status: 200, body, etag: responseEtag };
  }

  private sync(): Promise<void> {
    this.inFlight ??= this.runSync().finally(() => {
      const interval =
        this.store && !this.storeUnavailable
          ? STORE_SYNC_MS
          : SOURCE_REFRESH_MS;
      this.nextSyncAt = Date.now() + jittered(interval);
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runSync() {
    try {
      if (!this.store) {
        await this.syncFromSource();
        return;
      }

      const meta = await this.store.readMeta(this.scope);
      // A copy this process cannot load (corrupt, or written by a bug) must
      // not block the source: fetch a full document and replace it.
      let storeRejected = false;
      if (meta && meta.etag !== this.loadedEtag) {
        const body = await this.store.readBody(this.scope);
        try {
          if (body) this.apply(body, meta.etag);
        } catch (error) {
          storeRejected = true;
          this.fail(error);
        }
      }
      if (
        meta &&
        !storeRejected &&
        Date.now() - meta.fetchedAt < SOURCE_REFRESH_MS
      ) {
        this.storeUnavailable = false;
        this.confirmedAt = meta.fetchedAt;
        this.lastError = undefined;
        return;
      }

      const lease = await this.store.tryLease(this.scope);
      if (lease.status === "held") return;
      if (lease.status === "unavailable") {
        this.storeUnavailable = true;
        await this.syncFromSource();
        return;
      }
      this.storeUnavailable = false;
      // With an empty store, or a copy this process rejected, ask for the
      // full document. On a failure the lease is kept until it expires (10 s),
      // so a down source gets one attempt per lease period from the whole
      // fleet, not one per process.
      const result = await this.fetchSource(
        storeRejected ? undefined : meta?.etag
      );
      const fetchedAt = Date.now();
      if (result.status === 200) {
        this.apply(result.body, result.etag);
        // The scope includes the flagd-core version, so every process on this
        // key parses alike: a copy this process rejected is bad for all of
        // them, and the fresh document replaces it.
        await this.store.write(this.scope, {
          body: result.body,
          etag: result.etag,
          fetchedAt
        });
      } else {
        await this.store.write(this.scope, { fetchedAt });
      }
      this.confirmedAt = fetchedAt;
      this.lastError = undefined;
      await lease.release().catch(() => undefined);
    } catch (error) {
      this.fail(error);
    }
  }

  private async syncFromSource() {
    const result = await this.fetchSource(this.loadedEtag);
    if (result.status === 200) this.apply(result.body, result.etag);
    this.confirmedAt = Date.now();
    this.lastError = undefined;
  }

  // Sync on read, not on a timer: Vercel pauses the process between requests.
  private maybeSync() {
    if (this.mode !== "remote" || this.inFlight) return;
    if (Date.now() < this.nextSyncAt) return;
    const promise = this.sync();
    this.waitUntil?.(promise);
  }

  private evaluate<T>(
    key: string,
    result: ResolutionDetails<T> & { flagMetadata?: Record<string, unknown> }
  ): ResolutionDetails<T> {
    if (
      result.flagMetadata?.archived === true &&
      !this.warnedArchived.has(key)
    ) {
      this.warnedArchived.add(key);
      this.onWarning("Code read an archived feature flag", { key });
    }
    return result;
  }

  private withContext(context: EvaluationContext): EvaluationContext {
    return { ...context, ...this.context };
  }

  async resolveBooleanEvaluation(
    key: string,
    defaultValue: boolean,
    context: EvaluationContext,
    logger: Logger
  ) {
    this.maybeSync();
    return this.evaluate(
      key,
      this.core.resolveBooleanEvaluation(
        key,
        defaultValue,
        this.withContext(context),
        logger
      )
    );
  }

  async resolveStringEvaluation(
    key: string,
    defaultValue: string,
    context: EvaluationContext,
    logger: Logger
  ) {
    this.maybeSync();
    return this.evaluate(
      key,
      this.core.resolveStringEvaluation(
        key,
        defaultValue,
        this.withContext(context),
        logger
      )
    );
  }

  async resolveNumberEvaluation(
    key: string,
    defaultValue: number,
    context: EvaluationContext,
    logger: Logger
  ) {
    this.maybeSync();
    return this.evaluate(
      key,
      this.core.resolveNumberEvaluation(
        key,
        defaultValue,
        this.withContext(context),
        logger
      )
    );
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    key: string,
    defaultValue: T,
    context: EvaluationContext,
    logger: Logger
  ) {
    this.maybeSync();
    return this.evaluate(
      key,
      this.core.resolveObjectEvaluation(
        key,
        defaultValue,
        this.withContext(context),
        logger
      )
    );
  }
}

declare global {
  var __carbonFlags: CarbonFlagsProvider | undefined;
}

/**
 * Sets the provider from `CARBON_FLAGS_ENDPOINT` and `CARBON_FLAGS_HEADERS`.
 * Each app calls it once in `app/entry.server.tsx`; a second call (HMR, a warm
 * lambda) does nothing. Until it resolves, every flag answers its default.
 */
export async function initFlags(
  options: Pick<CarbonFlagsOptions, "store" | "waitUntil" | "onWarning"> = {}
): Promise<void> {
  if (globalThis.__carbonFlags) return;
  const provider = new CarbonFlagsProvider({
    endpoint: CARBON_FLAGS_ENDPOINT,
    headers: CARBON_FLAGS_HEADERS,
    commit: CARBON_COMMIT_SHA,
    store: options.store,
    waitUntil: options.waitUntil,
    onWarning: options.onWarning,
    tenancy: SINGLE_TENANT ? "single" : "multi",
    edition: CarbonEdition
  });
  globalThis.__carbonFlags = provider;
  await OpenFeature.setProviderAndWait(provider);
}

/**
 * `companyId` is required: a call without it would match no company rule and
 * answer the default without telling anyone. Pass `email` for a flag whose
 * rules name users: staff write rules by email, since a BYOC console cannot
 * see a customer's user ids. Rules match it in lower case.
 */
export type FlagContext = { companyId: string; email?: string };

let client: Client | undefined;
const getClient = () => {
  client ??= OpenFeature.getClient();
  return client;
};

const toContext = ({ companyId, email }: FlagContext): EvaluationContext => {
  const normalized = email?.trim().toLowerCase();
  return {
    targetingKey: normalized || companyId,
    companyId,
    ...(normalized ? { email: normalized } : {})
  };
};

/**
 * The only way code reads a flag. The default comes from the registry
 * (`FLAGS`), so two call sites cannot disagree on it. Never throws.
 */
export const flags = {
  bool: (key: FlagKey, context: FlagContext): Promise<boolean> =>
    getClient().getBooleanValue(key, flagDefault(key), toContext(context))
};

/** The value of every flag with `browser: true`, for the layout loaders. */
export async function evaluateBrowserFlags(
  context: FlagContext
): Promise<BrowserFlags> {
  return Object.fromEntries(
    await Promise.all(
      BROWSER_FLAG_KEYS.map(async (key) => [
        key,
        await flags.bool(key, context)
      ])
    )
  );
}
