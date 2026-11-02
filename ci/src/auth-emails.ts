// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Auth's emails for a hosted Supabase project.
 *
 * Self-hosted Auth downloads its templates from the ERP when it sends
 * (GOTRUE_MAILER_TEMPLATES_*). Hosted Supabase cannot: its emails are
 * project settings, and nothing set them, so Carbon Cloud sent Supabase's
 * stock "Your Magic Link" email, with no sign-in code in it. After each
 * deploy, this copies the templates the deployed ERP serves
 * (routes/templates.$file.ts) into the project, so the emails match the
 * release that reads their codes and links.
 *
 * Not reauthentication: Carbon has no screen for its code, so Auth keeps
 * its own (packages/documents/src/email/auth/index.tsx).
 */
const AUTH_EMAILS = [
  { file: "magic-link.html", name: "magic_link", subject: "Your Carbon sign-in code" },
  { file: "invite.html", name: "invite", subject: "You have been invited to Carbon" },
  { file: "confirmation.html", name: "confirmation", subject: "Confirm your email for Carbon" },
  { file: "recovery.html", name: "recovery", subject: "Reset your Carbon password" },
  { file: "email-change.html", name: "email_change", subject: "Confirm your new email for Carbon" }
] as const;

/** The Management API's settings for every Auth email, read from the ERP. */
export async function authEmailSettings(
  erpUrl: string,
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = 10_000
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    AUTH_EMAILS.map(async ({ file, name, subject }) => {
      const url = `${erpUrl.replace(/\/+$/, "")}/templates/${file}`;
      // A deploy can return before every task of the new release is serving.
      let response: Response | undefined;
      for (let attempt = 1; attempt <= 6; attempt++) {
        response = await fetchImpl(url);
        if (response.ok || attempt === 6) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      if (!response?.ok) {
        throw new Error(`GET ${url} answered ${response?.status}`);
      }
      const html = await response.text();
      // A page that is not a template (an error page, a sign-in redirect)
      // must never become the email.
      if (
        !html.includes("{{ .SiteURL }}") &&
        !html.includes("{{ .ConfirmationURL }}")
      ) {
        throw new Error(`GET ${url} is not an Auth template`);
      }
      return [
        [`mailer_subjects_${name}`, subject],
        [`mailer_templates_${name}_content`, html]
      ] as const;
    })
  );
  return Object.fromEntries(entries.flat());
}

/** Sets a hosted project's Auth emails to the ones its ERP serves. */
export async function pushAuthEmails(
  erpUrl: string,
  projectRef: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const settings = await authEmailSettings(erpUrl, fetchImpl);
  const response = await fetchImpl(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(settings)
    }
  );
  if (!response.ok) {
    throw new Error(
      `PATCH config/auth for ${projectRef} answered ${response.status}: ${await response.text()}`
    );
  }
}
