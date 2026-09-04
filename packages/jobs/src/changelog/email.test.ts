import { render } from "@react-email/components";
import { describe, expect, it, vi } from "vitest";

// @carbon/env validates required vars at module scope; the template reaches it
// through Logo's getAppUrl(). vi.mock hoists above the import below.
vi.mock("@carbon/env", () => ({
  getAppUrl: () => "https://app.carbon.ms",
  NODE_ENV: "test",
  VERCEL_ENV: undefined
}));

import { ChangelogEntryEmail } from "@carbon/documents/email";

// Lives in @carbon/jobs rather than @carbon/documents because of that env
// dependency — documents' vitest setup does not provide it.
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
