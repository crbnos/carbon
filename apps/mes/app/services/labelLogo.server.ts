import { SUPABASE_INTERNAL_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  type ResolvedLabelLogo,
  resolveLabelLogo as resolve
} from "@carbon/documents/labels";
import type { DocumentTemplate } from "@carbon/documents/template";
import type { LabelSize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

export type { ResolvedLabelLogo };

type CompanyLogoPaths = {
  logoLight: string | null;
  logoLightIcon: string | null;
};

/**
 * Reads the company's logo storage paths fresh (not `getCompany`'s
 * already-public-URL result — that one is shared with browser-facing callers,
 * and cannot be pointed at the internal URL without breaking those) and
 * expands them against the internal URL. Label routes feed this into
 * `resolveLabelLogo` instead of `getCompany`'s `logoLight`/`logoLightIcon`;
 * `getCompany`'s own result stays public and is still safe to use for
 * everything else a label route needs (name, text vars).
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

/**
 * Binds the shared label-logo resolver to this app's Supabase URL. The
 * `logo-resizer` edge function call this feeds is a server-to-server request
 * with no browser consumer, so it uses the internal URL. Pass
 * `getCompanyLogoForLabel`'s result here, not `getCompany`'s.
 */
export function resolveLabelLogo(
  company: CompanyLogoPaths | null,
  template: DocumentTemplate | null,
  labelSize: LabelSize
): Promise<ResolvedLabelLogo | null> {
  return resolve(company, template, labelSize, {
    supabaseUrl: SUPABASE_INTERNAL_URL ?? ""
  });
}
