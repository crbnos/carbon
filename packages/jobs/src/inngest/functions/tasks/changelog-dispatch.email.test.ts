// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { render } from "@react-email/components";
import { describe, expect, it, vi } from "vitest";

// @carbon/env validates required vars at import; the template reaches it via Logo.
vi.mock("@carbon/env", () => ({
  getAppUrl: () => "https://app.carbon.ms",
  NODE_ENV: "test",
  VERCEL_ENV: undefined
}));

import { ChangelogEntryEmail } from "@carbon/documents/email";

// Here rather than in @carbon/documents, whose test setup has no env.
describe("ChangelogEntryEmail", () => {
  it("renders the notification card with escaped title and the unsubscribe link", async () => {
    const html = await render(
      ChangelogEntryEmail({
        title: "Ship <faster> & better",
        description: "A & B",
        date: "04 Sep 2026",
        readUrl: "https://docs.carbon.ms/changelog/x",
        manageUrl: "https://app.carbon.ms/x/account/notifications"
      })
    );
    expect(html).toContain("Ship &lt;faster&gt; &amp; better");
    expect(html).toContain("https://app.carbon.ms/x/account/notifications");
    expect(html).toContain("nf-card");
    expect(html).toContain("Changelog · 04 Sep 2026");
  });
});
