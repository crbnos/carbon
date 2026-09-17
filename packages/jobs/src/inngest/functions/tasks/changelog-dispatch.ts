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
 * Changelog subscription pipeline (.ai/plans/2026-09-05-changelog-subscriptions.md).
 *
 * The docs site's RSS feed is the source of truth for "published": an entry is
 * live once its MDX merges and Vercel deploys. The dispatcher reads that feed,
 * diffs its GUIDs against the `changelogDispatch` ledger, and fans anything new
 * out to confirmed subscribers.
 *
 * It runs ON DEMAND only — send `carbon/changelog-dispatch` (Inngest dashboard
 * or event API) after an entry is published. There is no cron and no
 * merge-triggered workflow. The ledger row is what makes a repeated send safe.
 */

/** Explicit env wins; the local dev marker (INNGEST_DEV) points at the local
 *  docs server, production at docs.carbon.ms. */
const CHANGELOG_FEED_URL =
  process.env.CHANGELOG_FEED_URL ??
  (process.env.INNGEST_DEV
    ? "http://localhost:3002/changelog/rss.xml"
    : "https://docs.carbon.ms/changelog/rss.xml");

/** A run sent right after a merge races the Vercel deploy — the feed only
 *  updates when the deploy finishes. So a run re-checks a few times before
 *  giving up; send the event again once the entry is visible. */
const FEED_ATTEMPTS = 5;

/** Recipients per durable send step. Email goes through the shared SMTP
 *  transport (`@carbon/lib/email.server`), one message per recipient — there
 *  is no batch API — so a big list is split into steps: each is one short
 *  invocation of the Inngest route, and a retry after a failure resumes at
 *  the chunk that failed instead of re-sending the ones that finished. */
const SEND_CHUNK_SIZE = 50;

/** Where a reader turns the newsletter off: Account → Notifications in the ERP
 *  (path.to.notificationSettings — a signed-in page, since only the user may
 *  change their own preference). Same URL for every recipient. */
const MANAGE_URL = `${ERP_URL.replace(/\/$/, "")}/x/account/notifications`;

/**
 * Newsletter recipients: every user with an enabled (topic changelog, channel
 * email) preference. The preference is per company, the newsletter is not —
 * a user in two companies who opted in from either gets ONE email, so the
 * rows are collapsed by user.
 */
type DispatchPlan = ReturnType<typeof planDispatch>;

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

/** Sends one entry to one chunk of recipients; returns how many were sent.
 *  Zero with no error means the transport is not configured (email disabled). */
async function sendEntryToRecipients(
  entry: DispatchPlan["send"][number],
  recipients: string[]
): Promise<number> {
  // One render per chunk — nothing in the email is per-recipient.
  // List-Unsubscribe points at the signed-in settings page; there is
  // deliberately no List-Unsubscribe-Post (one-click needs an
  // unauthenticated endpoint, which this design does not have).
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
  // Sequential on purpose: the relay rate-limits, and a throttled send fails
  // the step, which would re-send the whole chunk on retry.
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
    // data is null when SMTP is not configured — email is disabled.
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
      // First run ever: seed the ledger with the current feed, send nothing.
      await step.run("bootstrap-ledger", async () => {
        const db = getJobDatabaseClient();
        await db
          .insertInto("changelogDispatch")
          .values(
            plan.bootstrap.map((entry) => ({
              guid: entry.guid,
              title: entry.title,
              description: entry.description,
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
      // The recipient list is memoised as a step so every chunk of this entry
      // — and every retry — works from the same list.
      const subscribers = await step.run(
        `recipients-${entry.guid}`,
        getNewsletterRecipients
      );

      // One durable step per chunk: a failed chunk is retried on its own, and
      // the chunks before it are never re-sent. The ledger row (below) still
      // guards against re-dispatching a finished entry.
      let emailsSent = 0;
      for (let i = 0; i < subscribers.length; i += SEND_CHUNK_SIZE) {
        const chunk = subscribers.slice(i, i + SEND_CHUNK_SIZE);
        emailsSent += await step.run(
          `dispatch-${entry.guid}-${i / SEND_CHUNK_SIZE}`,
          () => sendEntryToRecipients(entry, chunk)
        );
      }
      if (subscribers.length > 0 && emailsSent === 0) {
        logger.info("Email disabled — recording dispatch without sending", {
          guid: entry.guid
        });
      }

      await step.run(`ledger-${entry.guid}`, async () => {
        const db = getJobDatabaseClient();
        // Conflict-tolerant: a concurrent run that already ledgered this guid
        // (shouldn't happen under concurrency 1, but cheap to be safe).
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
