// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noZeroConcurrency } from "./no-zero-concurrency";

// This exists because `limit: 0` shipped in two handlers and silently parked
// every webhook delivery in QUEUED — invisible until a live end-to-end run,
// since no unit test reaches createFunction's config object.
describe("noZeroConcurrency", () => {
  const scan = (src: string) => noZeroConcurrency.scan("f.ts", src);

  it("flags the real shape the bug shipped in", () => {
    const v = scan(`inngest.createFunction(
  {
    id: "event-handler-webhook",
    concurrency: {
      limit: 0,
      key: "event.data.data.table"
    }
  },
);`);
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(4);
  });

  it("replays f25eba584c: limit 0 in the webhook and schedule-job handlers", () => {
    // packages/jobs/src/inngest/functions/events/webhook.ts before f25eba584c.
    const webhook = `export const webhookFunction = inngest.createFunction(
  {
    id: "event-handler-webhook",
    retries: 3,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 0,
      key: "event.data.data.table + '-' + event.data.data.recordId"
    }
  },
  { event: "carbon/event-webhook" },`;
    // packages/jobs/src/inngest/functions/tasks/reschedule-job.ts before f25eba584c.
    const rescheduleJob = `export const rescheduleJobFunction = inngest.createFunction(
  {
    id: "schedule-job",
    retries: 3,
    concurrency: {
      limit: 0,
      key: "event.data.companyId"
    }
  },
  { event: "carbon/reschedule-job" },`;
    expect(scan(webhook).map((v) => v.line)).toEqual([6]);
    expect(scan(rescheduleJob).map((v) => v.line)).toEqual([5]);
    // The fix: limit 1.
    expect(scan(webhook.replace("limit: 0", "limit: 1"))).toHaveLength(0);
  });

  it("accepts a real limit", () => {
    expect(scan(`concurrency: {\n  limit: 1,\n  key: "x"\n}`)).toHaveLength(0);
    expect(scan(`concurrency: 1,`)).toHaveLength(0);
  });

  it("ignores an unrelated limit: 0 far from any concurrency block", () => {
    expect(scan(`const opts = { limit: 0, offset: 0 };`)).toHaveLength(0);
    expect(
      scan(
        `concurrency: { limit: 5 },\n${"// pad\n".repeat(30)}const q = { limit: 0 };`
      )
    ).toHaveLength(0);
  });

  it("does not match past the closing brace of the concurrency object", () => {
    // A bounded [\s\S] span reached over the `}` and flagged this.
    expect(scan(`concurrency: {}, const query = { limit: 0 };`)).toHaveLength(
      0
    );
    expect(
      scan(`concurrency: { limit: 2 }, const query = { limit: 0 };`)
    ).toHaveLength(0);
    expect(
      scan(`concurrency: {\n  key: "x"\n},\nconst q = { limit: 0 };`)
    ).toHaveLength(0);
  });

  it("catches every occurrence in a file with more than one handler", () => {
    expect(
      scan(`concurrency: {\n  limit: 0\n}\n\nconcurrency: {\n  limit: 0\n}`)
    ).toHaveLength(2);
  });
});
