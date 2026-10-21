// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

/**
 * Every ported posting's declared permission, pinned: each `*Permission`
 * export of a module service, and the permission each posting `@carbon/jobs`
 * and `@carbon/ee` call checks a caller's client against. A change here is a
 * change to who may run the posting: review the diff, then update the
 * snapshot with `vitest -u`.
 */
describe("posting permissions", () => {
  const described = (rule: unknown) =>
    typeof rule === "function" ? rule.toString() : rule;

  it("match the reviewed manifest", async () => {
    const modules = import.meta.glob<Record<string, unknown>>(
      "../app/modules/*/*.service.ts"
    );
    const manifest: Record<string, unknown> = {};
    for (const [path, load] of Object.entries(modules).sort()) {
      const file = path.split("/").pop()!.replace(/\.service\.ts$/, "");
      for (const [name, rule] of Object.entries(await load())) {
        if (name.endsWith("Permission")) {
          manifest[`${file}.${name}`] = described(rule);
        }
      }
    }
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    expect(manifest).toMatchSnapshot();

    const { postingPermissions } = await import(
      "../app/modules/postings.server"
    );
    expect(
      Object.fromEntries(
        Object.entries(postingPermissions).map(([name, rule]) => [
          name,
          described(rule)
        ])
      )
    ).toMatchSnapshot();
  }, 120_000);
});
