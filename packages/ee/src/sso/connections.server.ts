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

// --- "ssoConnection" lookups ----------------------------------------------
// The one copy shared by ERP, MES, and jobs — domain and provider routing must
// answer identically at every enforcement point, so none of them keeps its own.
// The lookups self-gate on isSsoEnabled(): outside Enterprise they answer "no
// connection" without a query, so every downstream consumer (login refusals,
// invite links, callbacks) behaves as if SSO does not exist.

const DISABLED_ERROR = "Single sign-on requires Carbon Enterprise edition";

export async function getSsoConnection(
  client: SupabaseClient<Database>,
  companyId: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  return client
    .from("ssoConnection")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();
}

export async function getSsoConnectionByDomain(
  client: SupabaseClient<Database>,
  domain: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  return client
    .from("ssoConnection")
    .select("*")
    .contains("domains", [domain.toLowerCase()])
    .eq("active", true)
    .maybeSingle();
}

export async function getSsoConnectionByProviderId(
  client: SupabaseClient<Database>,
  providerId: string
) {
  if (!isSsoEnabled()) return { data: null, error: null };

  return client
    .from("ssoConnection")
    .select("*")
    .eq("providerId", providerId)
    .eq("active", true)
    .maybeSingle();
}

/**
 * Pre-auth enforcement helper: TRUE only when the email's domain is covered by
 * an ACTIVE connection whose "Require SSO" toggle is on. Callers refuse magic
 * link, OAuth, and passkey logins server-side when this returns true.
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

// --- Admin mutations -------------------------------------------------------
// Service-role only: the GoTrue provider wrappers carry the service-role key,
// and the route action gates on `update: settings` before calling these.

export async function upsertSsoConnection(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    metadataUrl?: string;
    metadataXml?: string;
    domains: string[];
    userId: string;
  }
) {
  if (!isSsoEnabled()) return { data: null, error: DISABLED_ERROR };

  const { companyId, metadataUrl, metadataXml, domains, userId } = args;

  // A domain can only route to one company's IdP — refuse to steal it.
  const conflicting = await serviceRole
    .from("ssoConnection")
    .select("domains")
    .overlaps("domains", domains)
    .eq("active", true)
    .neq("companyId", companyId);
  if (conflicting.error) {
    return { data: null, error: conflicting.error };
  }
  const takenDomains = (conflicting.data ?? []).flatMap((row) => row.domains);
  const taken = domains.find((domain) => takenDomains.includes(domain));
  if (taken) {
    return {
      data: null,
      error: `Domain ${taken} is already registered to another company`
    };
  }

  const existing = await getSsoConnection(serviceRole, companyId);
  if (existing.error) {
    return { data: null, error: existing.error };
  }

  if (existing.data) {
    const provider = await updateGoTrueSsoProvider(existing.data.providerId, {
      metadataUrl,
      metadataXml,
      domains
    });
    if (provider.error) {
      return { data: null, error: provider.error };
    }

    return serviceRole
      .from("ssoConnection")
      .update({
        domains,
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

  const provider = await createGoTrueSsoProvider({
    metadataUrl,
    metadataXml,
    domains
  });
  if (provider.error !== null) {
    return { data: null, error: provider.error };
  }

  const insert = await serviceRole
    .from("ssoConnection")
    .insert({
      companyId,
      providerId: provider.data.id,
      domains,
      metadataUrl: metadataUrl ?? null,
      metadataXml: metadataXml ?? null,
      createdBy: userId
    })
    .select("*")
    .single();

  if (insert.error) {
    // Compensating action — the GoTrue provider sits outside the DB
    // transaction, so an orphaned provider would squat on the domains.
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
    return { data: null, error: "No active SSO connection found" };
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
    return { data: null, error: "No active SSO connection found" };
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

  const removal = await deleteGoTrueSsoProvider(existing.data.providerId);
  if (removal.error) {
    // Compensate: restore the row so the admin sees "still active, try again"
    // rather than an orphaned GoTrue provider squatting on the domains (GoTrue
    // enforces domain uniqueness, so an orphan blocks re-creating the
    // connection later). If this restore ALSO fails, the leftover state is
    // "row inactive + provider alive" — the safe half: the callback rejects
    // logins against an inactive connection and nobody is locked out.
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
