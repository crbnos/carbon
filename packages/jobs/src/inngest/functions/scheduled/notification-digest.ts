import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getNotificationTopicPhrase,
  NotificationEvent,
  type NotificationTopic
} from "@carbon/notifications";
import { inngest } from "../../client";

// Roll up unread, undigested notifications older than DIGEST_MIN_AGE_MIN that
// share (userId, companyId, topic) when the group has DIGEST_THRESHOLD+ rows.
// One digest row replaces them in the topbar (the hook filters out rows
// where digestedInto is set), and child rows are kept for audit/recovery
// until the purge cron drops them.
//
// Re-runs absorb new children into an existing unread digest for the same
// group instead of creating a new digest each pass — that keeps the topbar
// to one entry per topic regardless of how often the cron fires.
const DIGEST_THRESHOLD = 5;
// Minutes. Set to 0 for instant testing; production target is ~60 so users
// get a chance to see live notifications before they roll up.
const DIGEST_MIN_AGE_MIN = 60;
const DIGEST_MAX_CANDIDATES = 5000;

type Candidate = {
  id: string;
  userId: string;
  companyId: string;
  topic: NotificationTopic;
  createdAt: string;
};

type ExistingDigest = Candidate;

function bucketKey(userId: string, companyId: string, topic: string): string {
  return `${userId}::${companyId}::${topic}`;
}

export const notificationDigestFunction = inngest.createFunction(
  { id: "notification-digest", retries: 2 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const client = getCarbonServiceRole();

    const work = await step.run("collect-work", async () => {
      const cutoff = new Date(
        Date.now() - DIGEST_MIN_AGE_MIN * 60 * 1000
      ).toISOString();

      const [
        { data: candidateRows, error: candidateErr },
        { data: digestRows, error: digestErr }
      ] = await Promise.all([
        client
          .from("notification")
          .select("id, userId, companyId, topic, createdAt")
          .is("readAt", null)
          .is("digestedInto", null)
          .neq("event", NotificationEvent.Digest)
          .lt("createdAt", cutoff)
          .order("createdAt", { ascending: true })
          .limit(DIGEST_MAX_CANDIDATES),
        client
          .from("notification")
          .select("id, userId, companyId, topic, createdAt")
          .is("readAt", null)
          .is("digestedInto", null)
          .eq("event", NotificationEvent.Digest)
          .order("createdAt", { ascending: true })
          .limit(DIGEST_MAX_CANDIDATES)
      ]);

      if (candidateErr) {
        console.error("Failed to load digest candidates", candidateErr);
        throw candidateErr;
      }
      if (digestErr) {
        console.error("Failed to load existing digests", digestErr);
        throw digestErr;
      }

      const candidates = new Map<string, Candidate[]>();
      for (const row of (candidateRows ?? []) as Candidate[]) {
        const key = bucketKey(row.userId, row.companyId, row.topic);
        const existing = candidates.get(key);
        if (existing) {
          existing.push(row);
        } else {
          candidates.set(key, [row]);
        }
      }

      const digests = new Map<string, ExistingDigest[]>();
      for (const row of (digestRows ?? []) as ExistingDigest[]) {
        const key = bucketKey(row.userId, row.companyId, row.topic);
        const existing = digests.get(key);
        if (existing) {
          existing.push(row);
        } else {
          digests.set(key, [row]);
        }
      }

      // Build the union of bucket keys — we want to consolidate stacked
      // digests even when no new children are pending.
      const keys = new Set<string>([...candidates.keys(), ...digests.keys()]);

      return Array.from(keys).map((key) => ({
        candidates: candidates.get(key) ?? [],
        digests: digests.get(key) ?? [],
        key
      }));
    });

    if (work.length === 0) {
      return { absorbed: 0, created: 0, groups: 0, merged: 0 };
    }

    const summary = await step.run("apply-digests", async () => {
      let created = 0;
      let merged = 0;
      let absorbed = 0;

      for (const group of work) {
        const newChildren = group.candidates;
        const existingDigests = group.digests;

        // Case A: no existing digest. Only act if new children meet the
        // threshold; otherwise leave them alone (they may digest next pass).
        if (existingDigests.length === 0) {
          if (newChildren.length < DIGEST_THRESHOLD) continue;

          const head = newChildren[0]!;
          const description = getNotificationTopicPhrase(
            head.topic,
            newChildren.length
          );

          const { data: createdRow, error: insertError } = await client
            .from("notification")
            .insert({
              companyId: head.companyId,
              event: NotificationEvent.Digest,
              payload: {
                count: newChildren.length,
                description,
                event: NotificationEvent.Digest,
                topic: head.topic
              },
              title: description,
              topic: head.topic,
              userId: head.userId
            })
            .select("id")
            .single();

          if (insertError || !createdRow?.id) {
            console.error("Failed to insert digest row", insertError);
            continue;
          }

          const { error: updateError } = await client
            .from("notification")
            .update({ digestedInto: createdRow.id })
            .in(
              "id",
              newChildren.map((r) => r.id)
            );

          if (updateError) {
            console.error("Failed to attach children to digest", updateError);
            continue;
          }

          created += 1;
          absorbed += newChildren.length;
          continue;
        }

        // Case B: at least one existing unread digest. Pick the oldest as the
        // keeper, repoint everything else into it, delete the other digest
        // rows, and refresh the keeper's title/count.
        const keeper = existingDigests[0]!;
        const others = existingDigests.slice(1);

        if (others.length > 0) {
          const { error: repointErr } = await client
            .from("notification")
            .update({ digestedInto: keeper.id })
            .in(
              "digestedInto",
              others.map((d) => d.id)
            );
          if (repointErr) {
            console.error(
              "Failed to repoint stacked digest children",
              repointErr
            );
            continue;
          }

          const { error: deleteErr } = await client
            .from("notification")
            .delete()
            .in(
              "id",
              others.map((d) => d.id)
            );
          if (deleteErr) {
            console.error("Failed to delete stacked digest rows", deleteErr);
            continue;
          }
          merged += others.length;
        }

        if (newChildren.length > 0) {
          const { error: absorbErr } = await client
            .from("notification")
            .update({ digestedInto: keeper.id })
            .in(
              "id",
              newChildren.map((r) => r.id)
            );
          if (absorbErr) {
            console.error("Failed to absorb children into digest", absorbErr);
            continue;
          }
          absorbed += newChildren.length;
        }

        // Refresh title/count from the authoritative child count.
        const { count: childCount, error: countErr } = await client
          .from("notification")
          .select("id", { count: "exact", head: true })
          .eq("digestedInto", keeper.id);

        if (countErr) {
          console.error("Failed to count digest children", countErr);
          continue;
        }

        const total = childCount ?? 0;
        const description = getNotificationTopicPhrase(keeper.topic, total);
        const { error: titleErr } = await client
          .from("notification")
          .update({
            payload: {
              count: total,
              description,
              event: NotificationEvent.Digest,
              topic: keeper.topic
            },
            title: description
          })
          .eq("id", keeper.id);
        if (titleErr) {
          console.error("Failed to refresh digest title", titleErr);
        }
      }

      return { absorbed, created, groups: work.length, merged };
    });

    return summary;
  }
);
