import { ChangelogEntryEmail } from "@carbon/documents/email";
import { ERP_URL } from "@carbon/env";
import { DEFAULT_FROM, sendEmail } from "@carbon/lib/email.server";
import { NotificationTopic } from "@carbon/notifications";
import { render } from "@react-email/components";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import {
  displayDate,
  entryEmailContent,
  parseChangelogFeed,
  planDispatch
} from "./changelog-dispatch.feed";

/**
 * Emails new changelog entries to newsletter subscribers. Runs when
 * `carbon/changelog-dispatch` is sent after an entry is published; the
 * `changelogDispatch` ledger makes sending it again safe.
 */

const CHANGELOG_FEED_URL =
  process.env.CHANGELOG_FEED_URL ??
  (process.env.INNGEST_DEV
    ? "http://localhost:3002/changelog/rss.xml"
    : "https://docs.carbon.ms/changelog/rss.xml");

// A run sent right after a merge can beat the docs deploy, so the feed is
// re-checked a few times before giving up.
const FEED_ATTEMPTS = 5;

// One durable step per chunk of recipients: a retry resumes at the failed
// chunk instead of re-sending the ones before it.
const SEND_CHUNK_SIZE = 50;

// Account → Notifications, where a reader turns the newsletter off.
const MANAGE_URL = `${ERP_URL.replace(/\/$/, "")}/x/account/notifications`;

type DispatchPlan = ReturnType<typeof planDispatch>;

// The preference is per company but the newsletter is not, so a user opted in
// from two companies still gets one email.
async function getNewsletterRecipients(): Promise<string[]> {
  const db = getJobDatabaseClient();
  const rows = await db
    .selectFrom("notificationPreference")
    .innerJoin("user", "user.id", "notificationPreference.userId")
    .select(["user.email as email"])
    .where("notificationPreference.topic", "=", NotificationTopic.Changelog)
    .where("notificationPreference.channel", "=", "email")
    .where("notificationPreference.enabled", "=", true)
    .where("user.active", "=", true)
    .distinct()
    .orderBy("user.email")
    .execute();
  return rows.map((row) => row.email).filter((email) => email.length > 0);
}

// Returns how many were sent; 0 with no error means email is not configured.
async function sendEntryToRecipients(
  entry: DispatchPlan["send"][number],
  recipients: string[]
): Promise<number> {
  // No List-Unsubscribe-Post: one-click unsubscribe needs an unauthenticated
  // endpoint, and the preference lives behind sign-in.
  const { subject, text } = entryEmailContent(entry, MANAGE_URL);
  const html = await render(
    ChangelogEntryEmail({
      title: entry.title,
      description: entry.description ?? undefined,
      date: displayDate(entry.pubDate),
      readUrl: entry.link,
      manageUrl: MANAGE_URL
    })
  );

  let sent = 0;
  // Sequential: the mail relay rate-limits.
  for (const to of recipients) {
    const response = await sendEmail({
      from: DEFAULT_FROM,
      to,
      subject,
      html,
      text,
      headers: { "List-Unsubscribe": `<${MANAGE_URL}>` }
    });
    if (response.error) {
      throw new Error(`Email error: ${response.error.message}`);
    }
    if (response.data) sent += 1;
  }
  return sent;
}

async function planFromLiveFeed(): Promise<DispatchPlan> {
  const response = await fetch(CHANGELOG_FEED_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch changelog feed: ${response.status} ${response.statusText}`
    );
  }
  const entries = parseChangelogFeed(await response.text());
  if (entries.length === 0) return { send: [], bootstrap: [] };

  const db = getJobDatabaseClient();
  const ledgerCount = await db
    .selectFrom("changelogDispatch")
    .select(db.fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  const ledgerIsEmpty = Number(ledgerCount.count) === 0;

  const seen = ledgerIsEmpty
    ? []
    : await db
        .selectFrom("changelogDispatch")
        .select("guid")
        .where(
          "guid",
          "in",
          entries.map((e) => e.guid)
        )
        .execute();
  return planDispatch(
    entries,
    new Set(seen.map((row) => row.guid)),
    ledgerIsEmpty
  );
}

export const changelogDispatchFunction = inngest.createFunction(
  { id: "changelog-dispatch", retries: 2, concurrency: { limit: 1 } },
  { event: "carbon/changelog-dispatch" },
  async ({ step, logger }) => {
    let plan: DispatchPlan = { send: [], bootstrap: [] };
    for (let attempt = 1; attempt <= FEED_ATTEMPTS; attempt++) {
      plan = await step.run(`fetch-feed-${attempt}`, planFromLiveFeed);
      if (
        plan.send.length > 0 ||
        plan.bootstrap.length > 0 ||
        attempt === FEED_ATTEMPTS
      ) {
        break;
      }
      await step.sleep(`wait-for-deploy-${attempt}`, "2m");
    }

    if (plan.bootstrap.length > 0) {
      // First run: record the current feed without sending, so launch does
      // not mail the whole back-catalogue.
      await step.run("bootstrap-ledger", async () => {
        const db = getJobDatabaseClient();
        await db
          .insertInto("changelogDispatch")
          .values(
            plan.bootstrap.map((entry) => ({
              guid: entry.guid,
              title: entry.title,
              description: entry.description,
              // NOW() would give every row the same time and make the What's new
              // panel's "latest" arbitrary. Postgres parses the RFC 822 date.
              ...(entry.pubDate ? { dispatchedAt: entry.pubDate } : {}),
              emailsSent: 0
            }))
          )
          .onConflict((oc) => oc.column("guid").doNothing())
          .execute();
      });
      logger.info("Bootstrapped changelog dispatch ledger — nothing sent", {
        entries: plan.bootstrap.length
      });
      return { dispatched: 0, bootstrapped: plan.bootstrap.length };
    }

    const newEntries = plan.send;
    if (newEntries.length === 0) {
      logger.info("No undispatched changelog entries");
      return { dispatched: 0 };
    }

    // Feed is newest-first; send oldest-first so a backlog arrives in order.
    let dispatched = 0;
    for (const entry of [...newEntries].reverse()) {
      // A step, so every chunk and retry works from the same list.
      const subscribers = await step.run(
        `recipients-${entry.guid}`,
        getNewsletterRecipients
      );

      let emailsSent = 0;
      for (let i = 0; i < subscribers.length; i += SEND_CHUNK_SIZE) {
        const chunk = subscribers.slice(i, i + SEND_CHUNK_SIZE);
        emailsSent += await step.run(
          `dispatch-${entry.guid}-${i / SEND_CHUNK_SIZE}`,
          () => sendEntryToRecipients(entry, chunk)
        );
      }
      if (subscribers.length > 0 && emailsSent === 0) {
        // Ledgering it now would mark it sent for good, and nobody would get
        // it once mail is configured.
        throw new Error(
          `No changelog email was delivered for ${entry.guid} — mail transport not configured; refusing to ledger the dispatch`
        );
      }

      await step.run(`ledger-${entry.guid}`, async () => {
        const db = getJobDatabaseClient();
        await db
          .insertInto("changelogDispatch")
          .values({
            guid: entry.guid,
            title: entry.title,
            description: entry.description,
            emailsSent
          })
          .onConflict((oc) => oc.column("guid").doNothing())
          .execute();
      });
      dispatched += 1;
      logger.info("Dispatched changelog entry", {
        guid: entry.guid,
        emailsSent
      });
    }

    return { dispatched };
  }
);
