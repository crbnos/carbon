import type { Database } from "@carbon/database";
import { getAppUrl } from "@carbon/env";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSsoEnabled } from "./gate";
import {
  createGoTrueSsoProvider,
  deleteGoTrueSsoProvider,
  updateGoTrueSsoProvider
} from "./provider.server";
import {
  checkDomainVerification,
  generateVerificationToken
} from "./verification.server";

// --- "ssoConnection" lookups ----------------------------------------------
// The one copy shared by ERP, MES, and jobs — domain and provider routing must
// answer identically at every enforcement point, so none of them keeps its own.
// The lookups self-gate on isSsoEnabled(): outside Enterprise they answer "no
// connection" without a query, so every downstream consumer (login refusals,
// invite links, callbacks) behaves as if SSO does not exist.
//
// Domains live in the "ssoDomain" table with a pending → verified lifecycle
// (DNS TXT ownership challenge — see verification.server.ts). Every lookup
// here attaches a computed `domains: string[]` of VERIFIED domains only, so an
// unverified claim is indistinguishable from an unregistered domain at every
// enforcement point.

const DISABLED_ERROR = "Single sign-on requires Carbon Enterprise edition";

type SsoDomainEmbed = { domain: string; status: string };

/** Flatten the ssoDomain embed into the verified `domains` array consumers read. */
function attachVerifiedDomains<
  T extends { ssoDomain?: SsoDomainEmbed[] | null }
>(row: T): Omit<T, "ssoDomain"> & { domains: string[] } {
  const { ssoDomain, ...rest } = row;
  return {
    ...rest,
    domains: (ssoDomain ?? [])
      .filter((d) => d.status === "verified")
      .map((d) => d.domain)
  };
}

export async function getSsoConnection(
  client: SupabaseClient<Database>,
  companyId: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  const result = await client
    .from("ssoConnection")
    .select("*, ssoDomain(domain, status)")
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  return {
    data: result.data ? attachVerifiedDomains(result.data) : null,
    error: result.error
  };
}

export async function getSsoConnectionByDomain(
  client: SupabaseClient<Database>,
  domain: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  const normalized = domain.toLowerCase();

  // !inner makes the embedded filter restrict the parent rows, so this returns
  // the active connection holding a VERIFIED claim on the domain — or nothing.
  // The attached `domains` is the matched domain only (sufficient for every
  // caller: they read companyId / requireSso, or just presence).
  const result = await client
    .from("ssoConnection")
    .select("*, ssoDomain!inner(domain, status)")
    .eq("ssoDomain.domain", normalized)
    .eq("ssoDomain.status", "verified")
    .eq("active", true)
    .maybeSingle();

  return {
    data: result.data ? attachVerifiedDomains(result.data) : null,
    error: result.error
  };
}

export async function getSsoConnectionByProviderId(
  client: SupabaseClient<Database>,
  providerId: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  const result = await client
    .from("ssoConnection")
    .select("*, ssoDomain(domain, status)")
    .eq("providerId", providerId)
    .eq("active", true)
    .maybeSingle();

  return {
    data: result.data ? attachVerifiedDomains(result.data) : null,
    error: result.error
  };
}

/**
 * Pre-auth enforcement helper: TRUE only when the email's domain is covered by
 * an ACTIVE connection whose "Require SSO" toggle is on. Callers refuse magic
 * link, OAuth, and passkey logins server-side when this returns true. Only a
 * VERIFIED domain can enforce — a pending claim must never lock a domain's
 * users out of their ordinary login methods.
 */
export async function isSsoRequiredForEmail(
  client: SupabaseClient<Database>,
  email: string
) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;

  const connection = await getSsoConnectionByDomain(client, domain);
  return connection.data?.requireSso === true;
}

/**
 * SSO-aware invite link. When the invitee's email domain belongs to the
 * INVITING company's active SSO connection, the invite email points at the
 * login page (prefilled email; the SSO callback consumes the pending invite —
 * the code is not needed in the URL). Otherwise it points at the ordinary
 * code-based invite route. The companyId check matters when another company
 * owns the domain: the callback consumes invites scoped to the connection's
 * own company, so routing this company's invite through that SSO login would
 * strand it — the code link is the one that works.
 */
export async function getSsoAwareInviteLink(
  client: SupabaseClient<Database>,
  email: string,
  code: string,
  companyId: string
): Promise<string> {
  const domain = email.split("@")[1];
  if (domain) {
    const ssoConnection = await getSsoConnectionByDomain(client, domain);
    if (ssoConnection.data && ssoConnection.data.companyId === companyId) {
      return `${getAppUrl()}/login?email=${encodeURIComponent(email)}`;
    }
  }
  return `${getAppUrl()}/invite/${code}`;
}

// --- "ssoDomain" management ------------------------------------------------

/** Every domain row for the company, pending and verified, for the admin UI. */
export async function getSsoDomains(
  client: SupabaseClient<Database>,
  companyId: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  return client
    .from("ssoDomain")
    .select("*")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

async function getVerifiedDomains(
  serviceRole: SupabaseClient<Database>,
  connectionId: string,
  companyId: string
): Promise<{ data: string[] | null; error: unknown }> {
  const result = await serviceRole
    .from("ssoDomain")
    .select("domain")
    .eq("connectionId", connectionId)
    .eq("companyId", companyId)
    .eq("status", "verified");
  return {
    data: result.data ? result.data.map((d) => d.domain) : null,
    error: result.error
  };
}

/**
 * Push the connection's current VERIFIED domain set to its GoTrue provider —
 * GoTrue's auth.sso_domains is what routes signInWithSSO({ domain }), so it
 * must never contain an unverified claim.
 */
async function syncGoTrueDomains(
  serviceRole: SupabaseClient<Database>,
  connection: {
    id: string;
    companyId: string;
    providerId: string;
    metadataUrl: string | null;
    metadataXml: string | null;
  }
): Promise<{ error: string | null }> {
  const verified = await getVerifiedDomains(
    serviceRole,
    connection.id,
    connection.companyId
  );
  if (verified.data === null) {
    return { error: "Failed to read verified domains" };
  }
  const provider = await updateGoTrueSsoProvider(connection.providerId, {
    metadataUrl: connection.metadataUrl ?? undefined,
    metadataXml: connection.metadataXml ?? undefined,
    domains: verified.data
  });
  return { error: provider.error };
}

const DOMAIN_ALREADY_ADDED_ERROR =
  "This domain has already been added — check its status in the Email Domains list";
// Generic on purpose — a distinct message would let any tenant probe whether
// a domain is verified elsewhere.
const DOMAIN_VERIFY_CONFLICT_ERROR = "Failed to verify domain";

export async function addSsoDomain(
  serviceRole: SupabaseClient<Database>,
  args: { companyId: string; domain: string; userId: string }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const connection = await getSsoConnection(serviceRole, args.companyId);
  if (connection.error) {
    return { data: null, error: connection.error.message };
  }
  if (!connection.data) {
    return { data: null, error: "No active SAML SSO connection found" };
  }

  const normalized = args.domain.trim().toLowerCase();

  // Claims are per-company; the unique constraint is the race-safe backstop.
  const existing = await serviceRole
    .from("ssoDomain")
    .select("id")
    .eq("companyId", args.companyId)
    .eq("domain", normalized)
    .maybeSingle();
  if (existing.error) {
    return { data: null, error: existing.error.message };
  }
  if (existing.data) {
    return { data: null, error: DOMAIN_ALREADY_ADDED_ERROR };
  }

  const insert = await serviceRole
    .from("ssoDomain")
    .insert({
      companyId: args.companyId,
      connectionId: connection.data.id,
      domain: normalized,
      verificationToken: generateVerificationToken(),
      createdBy: args.userId
    })
    .select("*")
    .single();
  if (insert.error) {
    return { data: null, error: insert.error.message };
  }
  return { data: insert.data, error: null };
}

/**
 * Run the DNS TXT check for a pending domain. On success the row flips to
 * verified and the GoTrue provider's domain list is updated. GoTrue is synced
 * BEFORE the row flips: if the row update then fails, GoTrue routes the domain
 * but the callback's verified-domain check still rejects it (safe); the
 * reverse order could mark a domain enforcing requireSso while signInWithSSO
 * cannot route it — a lockout.
 */
export async function verifySsoDomain(
  serviceRole: SupabaseClient<Database>,
  args: { companyId: string; domainId: string; userId: string }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const row = await serviceRole
    .from("ssoDomain")
    .select("*")
    .eq("id", args.domainId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (row.error) {
    return { data: null, error: row.error.message };
  }
  if (!row.data) {
    return { data: null, error: "Domain not found" };
  }
  if (row.data.status === "verified") {
    return { data: { verified: true as const }, error: null };
  }

  const connection = await getSsoConnection(serviceRole, args.companyId);
  if (connection.error || !connection.data) {
    return {
      data: null,
      error: connection.error?.message ?? "No active SAML SSO connection found"
    };
  }
  if (connection.data.id !== row.data.connectionId) {
    // The row belongs to a deactivated connection — it cannot route logins.
    return { data: null, error: "Domain is not part of the active connection" };
  }

  // Another company already verified this domain — refuse before the DNS check.
  const conflict = await serviceRole
    .from("ssoDomain")
    .select("companyId")
    .eq("domain", row.data.domain)
    .eq("status", "verified")
    .neq("companyId", args.companyId)
    .maybeSingle();
  if (conflict.error) {
    return { data: null, error: conflict.error.message };
  }
  if (conflict.data) {
    return { data: null, error: DOMAIN_VERIFY_CONFLICT_ERROR };
  }

  const check = await checkDomainVerification(
    row.data.domain,
    row.data.verificationToken
  );
  if (!check.verified) {
    return { data: check, error: null };
  }

  const provider = await updateGoTrueSsoProvider(connection.data.providerId, {
    metadataUrl: connection.data.metadataUrl ?? undefined,
    metadataXml: connection.data.metadataXml ?? undefined,
    domains: [...connection.data.domains, row.data.domain]
  });
  if (provider.error) {
    return { data: null, error: provider.error };
  }

  const update = await serviceRole
    .from("ssoDomain")
    .update({
      status: "verified",
      verifiedAt: datetime.timestamp(),
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.domainId)
    .eq("companyId", args.companyId)
    .select("*")
    .single();
  if (update.error) {
    // Compensate: pull the domain back out of GoTrue so routing and the
    // app-side verified set cannot disagree.
    await syncGoTrueDomains(serviceRole, connection.data);
    return { data: null, error: update.error.message };
  }

  return { data: { verified: true as const }, error: null };
}

export async function removeSsoDomain(
  serviceRole: SupabaseClient<Database>,
  args: { companyId: string; domainId: string }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const row = await serviceRole
    .from("ssoDomain")
    .select("*")
    .eq("id", args.domainId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (row.error) {
    return { data: null, error: row.error.message };
  }
  if (!row.data) {
    return { data: null, error: "Domain not found" };
  }

  const wasVerified = row.data.status === "verified";

  const removal = await serviceRole
    .from("ssoDomain")
    .delete()
    .eq("id", args.domainId)
    .eq("companyId", args.companyId);
  if (removal.error) {
    return { data: null, error: removal.error };
  }

  // Row first, GoTrue second: if the sync fails, GoTrue still routes the
  // domain but the callback's verified-domain check rejects it (safe), and the
  // next verify/remove re-syncs. The reverse order's failure mode is a domain
  // the app treats as covered that signInWithSSO cannot route.
  if (wasVerified) {
    const connection = await getSsoConnection(serviceRole, args.companyId);
    if (connection.data && connection.data.id === row.data.connectionId) {
      const sync = await syncGoTrueDomains(serviceRole, connection.data);
      if (sync.error) {
        return { data: null, error: sync.error };
      }
    }
  }

  return { data: row.data, error: null };
}

// --- Admin mutations -------------------------------------------------------
// Service-role only: the GoTrue provider wrappers carry the service-role key,
// and the route action gates on `update: settings` before calling these.

export async function upsertSsoConnection(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    metadataUrl?: string;
    metadataXml?: string;
    userId: string;
  }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const { companyId, metadataUrl, metadataXml, userId } = args;

  const existing = await getSsoConnection(serviceRole, companyId);
  if (existing.error) {
    return { data: null, error: existing.error };
  }

  if (existing.data) {
    const provider = await updateGoTrueSsoProvider(existing.data.providerId, {
      metadataUrl,
      metadataXml,
      domains: existing.data.domains
    });
    if (provider.error) {
      return { data: null, error: provider.error };
    }

    return serviceRole
      .from("ssoConnection")
      .update({
        metadataUrl: metadataUrl ?? null,
        metadataXml: metadataXml ?? null,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", existing.data.id)
      .eq("companyId", companyId)
      .select("*")
      .single();
  }

  // A new connection starts with no domains — they are claimed and DNS-verified
  // individually afterwards, and only verified domains ever reach GoTrue.
  const provider = await createGoTrueSsoProvider({
    metadataUrl,
    metadataXml,
    domains: []
  });
  if (provider.error !== null) {
    return { data: null, error: provider.error };
  }

  const insert = await serviceRole
    .from("ssoConnection")
    .insert({
      companyId,
      providerId: provider.data.id,
      metadataUrl: metadataUrl ?? null,
      metadataXml: metadataXml ?? null,
      createdBy: userId
    })
    .select("*")
    .single();

  if (insert.error) {
    // Compensating action — the GoTrue provider sits outside the DB
    // transaction, so an orphaned provider would linger unreferenced.
    await deleteGoTrueSsoProvider(provider.data.id);
  }

  return insert;
}

export async function updateSsoRequireSso(
  serviceRole: SupabaseClient<Database>,
  args: { companyId: string; requireSso: boolean; userId: string }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const existing = await getSsoConnection(serviceRole, args.companyId);
  if (existing.error) {
    return { data: null, error: existing.error };
  }
  if (!existing.data) {
    return { data: null, error: "No active SAML SSO connection found" };
  }

  return serviceRole
    .from("ssoConnection")
    .update({
      requireSso: args.requireSso,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", existing.data.id)
    .eq("companyId", args.companyId)
    .select("*")
    .single();
}

export async function deactivateSsoConnection(
  serviceRole: SupabaseClient<Database>,
  args: { companyId: string; userId: string }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const existing = await getSsoConnection(serviceRole, args.companyId);
  if (existing.error) {
    return { data: null, error: existing.error };
  }
  if (!existing.data) {
    return { data: null, error: "No active SAML SSO connection found" };
  }

  // Flip the row inactive BEFORE deleting the GoTrue provider. The reverse
  // order has a lockout failure mode: provider deleted, row update fails →
  // SAML is dead while the still-active row keeps enforcing Require SSO, and
  // only manual SQL recovers. This order's failure modes are both safe — a
  // failed row update touches nothing in GoTrue, and a failed provider delete
  // is compensated below.
  const update = await serviceRole
    .from("ssoConnection")
    .update({
      active: false,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", existing.data.id)
    .eq("companyId", args.companyId)
    .select("*")
    .single();
  if (update.error) {
    return update;
  }

  // Release the domain claims: the inactive row survives for audit, but its
  // domains must not stay claimed under a dead connection — the global
  // UNIQUE("domain") would otherwise block this company (or the domain's real
  // owner) from ever registering them again. A re-created connection starts
  // with no domains and re-verifies, matching the modal's "cannot be undone".
  const domainRemoval = await serviceRole
    .from("ssoDomain")
    .delete()
    .eq("connectionId", existing.data.id)
    .eq("companyId", args.companyId);
  if (domainRemoval.error) {
    await serviceRole
      .from("ssoConnection")
      .update({
        active: true,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", existing.data.id)
      .eq("companyId", args.companyId);
    return { data: null, error: domainRemoval.error };
  }

  const removal = await deleteGoTrueSsoProvider(existing.data.providerId);
  if (removal.error) {
    // Compensate: restore the row so the admin sees "still active, try again"
    // rather than an orphaned GoTrue provider squatting on the domains (GoTrue
    // enforces domain uniqueness, so an orphan blocks re-creating the
    // connection later). The domain rows are already deleted — after a retry
    // the admin re-adds and re-verifies them, which is safe; the opposite
    // leftover (claimed domains under a dead connection) is not. If this
    // restore ALSO fails, the leftover state is "row inactive + provider
    // alive" — the safe half: the callback rejects logins against an inactive
    // connection and nobody is locked out.
    await serviceRole
      .from("ssoConnection")
      .update({
        active: true,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", existing.data.id)
      .eq("companyId", args.companyId);
    return { data: null, error: removal.error };
  }

  return update;
}
