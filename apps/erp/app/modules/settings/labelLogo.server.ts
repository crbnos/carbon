// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_INTERNAL_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export {
  type ResolvedLabelLogo,
  resolveLabelLogo
} from "@carbon/documents/labels";

type CompanyLogoPaths = {
  logoLight: string | null;
  logoLightIcon: string | null;
};

/**
 * Reads the company's logo storage paths fresh (not `getCompany`'s
 * already-public-URL result — that one is shared with browser-facing callers
 * like the company picker and settings page, and cannot be pointed at the
 * internal URL without breaking those) and expands them against the internal
 * URL. Label routes feed this into `resolveLabelLogo` instead of `getCompany`'s
 * `logoLight`/`logoLightIcon`; `getCompany`'s own result stays public and is
 * still safe to use for everything else a label route needs (name, text vars).
 */
export async function getCompanyLogoForLabel(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<CompanyLogoPaths | null> {
  const { data } = await client
    .from("company")
    .select("logoLight, logoLightIcon")
    .eq("id", companyId)
    .maybeSingle();

  if (!data) return null;

  const expand = (path: string | null) =>
    path
      ? `${SUPABASE_INTERNAL_URL}/storage/v1/object/public/public/${path}`
      : null;

  return {
    logoLight: expand(data.logoLight),
    logoLightIcon: expand(data.logoLightIcon)
  };
}
