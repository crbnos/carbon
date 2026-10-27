// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { render } from "react-email";
import { describe, expect, it } from "vitest";
import { authEmails } from ".";

// What Auth fills in, by email. A placeholder React split with a comment
// marker, or escaped, would reach the recipient as the raw braces.
const placeholders: Record<keyof typeof authEmails, string[]> = {
  "magic-link.html": [
    "{{ .Token }}",
    'href="{{ .SiteURL }}/magic-link?token={{ .TokenHash }}&amp;redirect_to={{ .RedirectTo }}"'
  ],
  "invite.html": [
    'href="{{ .SiteURL }}/confirm-invite?token={{ .TokenHash }}"'
  ],
  "confirmation.html": ["{{ .Token }}", 'href="{{ .ConfirmationURL }}"'],
  "recovery.html": ['href="{{ .ConfirmationURL }}"'],
  "email-change.html": [
    "{{ .Email }} to {{ .NewEmail }}",
    'href="{{ .ConfirmationURL }}"'
  ]
};

// A code is offered only where a Carbon screen takes it.
const withCode = new Set(["magic-link.html", "confirmation.html"]);

describe("auth emails", () => {
  for (const [file, Email] of Object.entries(authEmails)) {
    it(`${file} carries Auth's placeholders intact`, async () => {
      const html = await render(<Email />);
      for (const expected of placeholders[file as keyof typeof authEmails]) {
        expect(html).toContain(expected);
      }
      expect(html).not.toMatch(/\{\{[^}]*<!--/);
      expect(html.includes("{{ .Token }}")).toBe(withCode.has(file));
      // The card's dark-mode classes.
      expect(html).toContain("nf-card");
    });
  }
});
