import { ChangelogEntryEmail } from "@carbon/documents/email";
import { ERP_URL, RESEND_DOMAIN } from "@carbon/env";
import { NotificationTopic } from "@carbon/notifications";
import { render } from "@react-email/components";
import { Resend } from "resend";
import {
  displayDate,
  entryEmailContent,
  parseChangelogFeed,
  planDispatch
} from "../../../changelog/feed";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * Changelog subscription pipeline (.ai/plans/2026-09-05-changelog-subscriptions.md).
 *
 * The docs site's RSS feed is the source of truth for "published": an entry is
 * live once its MDX merges and Vercel deploys. The dispatcher polls that feed,
 * diffs its GUIDs against the `changelogDispatch` ledger, and fans anything new
 * out to confirmed subscribers. The ledger row is what makes the hourly cron,
 * the merge-fired `changelog/entry.merged` event (GitHub workflow), and a
 * manual re-fire safe to overlap.
 */

/** Explicit env wins; the local dev marker (INNGEST_DEV) points at the local
 *  docs server, production at docs.carbon.ms. */
const CHANGELOG_FEED_URL =
  process.env.CHANGELOG_FEED_URL ??
  (process.env.INNGEST_DEV
    ? "http://localhost:3002/changelog/rss.xml"
    : "https://docs.carbon.ms/changelog/rss.xml");

/** A merge-triggered run races the Vercel deploy — the push fired the event,
 *  but the feed only updates when the deploy finishes. So event runs re-check a
 *  few times before giving up (the next cron is the backstop). */
const MERGE_TRIGGER_ATTEMPTS = 5;
const RESEND_BATCH_SIZE = 100;

const fromAddress = () => `Carbon <no-reply@${RESEND_DOMAIN}>`;

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
async function getNewsletterRecipients(): Promise<{ email: string }[]> {
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
    .execute();
  return rows.filter((row) => row.email.length > 0);
}

type DispatchPlan = ReturnType<typeof planDispatch>;

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
  [{ cron: "0 * * * *" }, { event: "changelog/entry.merged" }],
  async ({ event, step, logger }) => {
    const mergeTriggered = event?.name === "changelog/entry.merged";
    const maxAttempts = mergeTriggered ? MERGE_TRIGGER_ATTEMPTS : 1;

    let plan: DispatchPlan = { send: [], bootstrap: [] };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      plan = await step.run(`fetch-feed-${attempt}`, planFromLiveFeed);
      if (
        plan.send.length > 0 ||
        plan.bootstrap.length > 0 ||
        attempt === maxAttempts
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
      logger.info("No undispatched changelog entries", { mergeTriggered });
      return { dispatched: 0 };
    }

    // Feed is newest-first; send oldest-first so a backlog arrives in order.
    let dispatched = 0;
    for (const entry of [...newEntries].reverse()) {
      // One durable step per entry. If a Resend batch fails partway, the retry
      // re-sends the entry's earlier batches — an annoyance, never a data bug;
      // the ledger row still guards against re-dispatching a finished entry.
      const emailsSent = await step.run(`dispatch-${entry.guid}`, async () => {
        const db = getJobDatabaseClient();
        const subscribers = await getNewsletterRecipients();

        let sent = 0;
        if (subscribers.length > 0 && !process.env.DISABLE_RESEND) {
          const resend = new Resend(process.env.RESEND_API_KEY!);
          for (let i = 0; i < subscribers.length; i += RESEND_BATCH_SIZE) {
            // One render per entry — nothing in the email is per-recipient.
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
            const batch = subscribers
              .slice(i, i + RESEND_BATCH_SIZE)
              .map((subscriber) => ({
                from: fromAddress(),
                to: subscriber.email,
                subject,
                html,
                text,
                headers: { "List-Unsubscribe": `<${MANAGE_URL}>` }
              }));
            const response = await resend.batch.send(batch);
            if (response.error) {
              throw new Error(`Resend batch error: ${response.error.message}`);
            }
            sent += batch.length;
          }
        } else if (process.env.DISABLE_RESEND) {
          logger.info("Resend disabled — recording dispatch without sending", {
            guid: entry.guid
          });
        }

        // Conflict-tolerant: a concurrent run that already ledgered this guid
        // (shouldn't happen under concurrency 1, but cheap to be safe).
        await db
          .insertInto("changelogDispatch")
          .values({
            guid: entry.guid,
            title: entry.title,
            description: entry.description,
            emailsSent: sent
          })
          .onConflict((oc) => oc.column("guid").doNothing())
          .execute();

        return sent;
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
