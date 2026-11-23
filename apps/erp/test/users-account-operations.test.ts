// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  deleteAttributeValue,
  updateOwnAvatar,
  upsertAttributeValue
} from "../app/modules/users/users.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

const USER_ID = "5f0c3d2a-1b2c-4d5e-8f90-123456789abc";
const OTHER = "9a8b7c6d-0000-4000-8000-000000000000";
const GENERATED = "dicebear:voxel-art:3f2b8c4e-6a1d-4f7e-9b2c:1e3a8a";

/**
 * The user's client: each table's one row for a read; each write, and each
 * avatar photo removed, is logged to `calls`. `failing` names the tables
 * whose writes fail.
 */
function clientWith(rows: Record<string, unknown>, failing: string[] = []) {
  const calls: string[] = [];
  const from = (table: string) => {
    let written = false;
    const write = (entry: string) => {
      calls.push(entry);
      written = true;
      return chain;
    };
    const answer = () =>
      failing.includes(table)
        ? { data: null, error: { message: "boom" } }
        : { data: written ? { id: "value-1" } : (rows[table] ?? null), error: null };
    const chain: Record<string, any> = {
      select: () => chain,
      eq: () => chain,
      update: (values: { avatarUrl?: string }) =>
        write(table === "user" ? `update:${values.avatarUrl}` : `update ${table}`),
      insert: () => write(`insert ${table}`),
      delete: () => write(`delete ${table}`),
      single: async () => answer(),
      then: (resolve: (value: unknown) => unknown) => resolve(answer())
    };
    return chain;
  };
  const storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        calls.push(`remove:${paths.join(",")}`);
        return { error: null };
      }
    })
  };
  return { client: { from, storage } as never, calls };
}

const unreachable = () => {
  throw new Error("must not be reached");
};

function contextAs(caller: never, permissions: Record<string, unknown> = {}) {
  return createServiceContext({
    // `{}` admits a member of the company: anyone holding a grant there.
    actor: {
      type: "user",
      userId: USER_ID,
      permissions: {
        documents: { view: ["company-1"], create: [], update: [], delete: [] },
        ...permissions
      } as never
    },
    company: { id: "company-1", groupId: "group-1" },
    caller,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
}

// Saving the avatar saves the new value, then deletes the photo it replaced:
// deleting first and then failing the save left avatarUrl pointing at a file
// that no longer existed.
describe("updateOwnAvatar", () => {
  async function saveAvatar(
    path: string,
    { previous = `${USER_ID}.webp`, failing = [] as string[] } = {}
  ) {
    const { client, calls } = clientWith({ user: { avatarUrl: previous } }, failing);
    const result = await updateOwnAvatar(contextAs(client), { path });
    return { result, calls };
  }

  it("saves the generated avatar, THEN deletes the photo it replaced", async () => {
    const { result, calls } = await saveAvatar(GENERATED);
    expect(result.error).toBeNull();
    expect(calls).toEqual([`update:${GENERATED}`, `remove:${USER_ID}.webp`]);
  });

  it("keeps the photo when the save fails", async () => {
    const { result, calls } = await saveAvatar(GENERATED, { failing: ["user"] });
    expect(result.error?.category).toBe("internal");
    expect(calls).toEqual([`update:${GENERATED}`]);
  });

  it("deletes nothing when the previous avatar was generated", async () => {
    const { calls } = await saveAvatar(GENERATED, {
      previous: "dicebear:croodles-neutral:abc"
    });
    expect(calls).toEqual([`update:${GENERATED}`]);
  });

  it("does not delete a photo the new upload overwrote in place", async () => {
    const { calls } = await saveAvatar(`${USER_ID}.webp`);
    expect(calls).toEqual([`update:${USER_ID}.webp`]);
  });

  it("removes an old upload with a different extension", async () => {
    const { calls } = await saveAvatar(`${USER_ID}.png`);
    expect(calls).toEqual([`update:${USER_ID}.png`, `remove:${USER_ID}.webp`]);
  });

  it("refuses another user's file and changes nothing", async () => {
    const { result, calls } = await saveAvatar("someone-else.webp");
    expect(result.error?.category).toBe("validation");
    expect(calls).toEqual([]);
  });
});

// Anyone with resources update may change anyone's attribute values; others
// only their own, of an attribute marked as self-managed.
describe("attribute values", () => {
  const value = { userAttributeId: "attribute-1", type: "text", value: "Blue" };
  const attribute = (canSelfManage: boolean) =>
    clientWith({ userAttribute: { canSelfManage } });

  it("lets resources update change another person's value", async () => {
    const { client } = attribute(false);
    const result = await upsertAttributeValue(
      contextAs(client, { resources: { update: ["company-1"] } }),
      { ...value, userId: OTHER }
    );
    expect(result.data).toEqual({ userAttributeValueId: "value-1" });
  });

  it("refuses another person's value without resources update", async () => {
    const { client, calls } = attribute(true);
    const result = await upsertAttributeValue(contextAs(client), {
      ...value,
      userId: OTHER
    });
    expect(result.error?.category).toBe("forbidden");
    expect(calls).toEqual([]);
  });

  it("lets a person set their own self-managed value", async () => {
    const { client, calls } = attribute(true);
    const result = await upsertAttributeValue(contextAs(client), {
      ...value,
      userId: USER_ID
    });
    expect(result.error).toBeNull();
    expect(calls).toEqual(["insert userAttributeValue"]);
  });

  it("refuses removing their own value of a managed attribute", async () => {
    const { client, calls } = attribute(false);
    const result = await deleteAttributeValue(contextAs(client), {
      userId: USER_ID,
      userAttributeId: "attribute-1",
      userAttributeValueId: "value-1"
    });
    expect(result.error?.category).toBe("forbidden");
    expect(calls).toEqual([]);
  });
});
