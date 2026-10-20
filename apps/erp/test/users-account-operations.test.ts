// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({ msg: (value: unknown) => value }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("../app/modules/users/users.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deleteUserAttributeValue: vi.fn(),
  getChangelogPanelEntry: vi.fn(),
  getCurrentUser: vi.fn(),
  updateAvatar: vi.fn(),
  upsertUserAttributeValue: vi.fn()
}));

vi.mock("../app/modules/people/people.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAttribute: vi.fn()
}));

import {
  deleteAttributeValue,
  updateOwnAvatar,
  upsertAttributeValue
} from "../app/modules/users/users.server";
import {
  deleteUserAttributeValue,
  getCurrentUser,
  updateAvatar,
  upsertUserAttributeValue
} from "../app/modules/users/users.service";
import { getAttribute } from "../app/modules/people/people.service";
import { createServiceContext } from "@carbon/api/service-fn.server";

// Saving the avatar saves the new value, then deletes the photo it replaced.
// The order is the point: deleting first and then failing the save left
// avatarUrl pointing at a file that no longer existed.

const USER_ID = "5f0c3d2a-1b2c-4d5e-8f90-123456789abc";
const GENERATED = "dicebear:voxel-art:3f2b8c4e-6a1d-4f7e-9b2c:1e3a8a";

const calls: string[] = [];
const remove = vi.fn(async (paths: string[]) => {
  calls.push(`remove:${paths.join(",")}`);
  return { error: null };
});

const unreachable = () => {
  throw new Error("must not be reached");
};

function saveAvatar(path: string) {
  const ctx = createServiceContext({
    // `{}` admits a member of the company: anyone holding a grant there.
    actor: {
      type: "user",
      userId: USER_ID,
      permissions: {
        documents: { view: ["company-1"], create: [], update: [], delete: [] }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: { storage: { from: () => ({ remove }) } } as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
  return updateOwnAvatar(ctx, { path });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateOwnAvatar", () => {
  beforeEach(() => {
    calls.length = 0;
    remove.mockClear();
    vi.mocked(updateAvatar).mockImplementation((async (
      _client: unknown,
      _userId: string,
      value: string | null
    ) => {
      calls.push(`update:${value}`);
      return { error: null };
    }) as never);
    vi.mocked(getCurrentUser).mockResolvedValue({
      data: { avatarUrl: `${USER_ID}.webp` },
      error: null
    } as never);
  });

  it("saves the generated avatar, THEN deletes the photo it replaced", async () => {
    const result = await saveAvatar(GENERATED);
    expect(result.error).toBeNull();
    expect(calls).toEqual([`update:${GENERATED}`, `remove:${USER_ID}.webp`]);
  });

  it("keeps the photo when the save fails", async () => {
    vi.mocked(updateAvatar).mockResolvedValue({
      error: { message: "boom" }
    } as never);
    const result = await saveAvatar(GENERATED);
    expect(result.error?.category).toBe("internal");
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes nothing when the previous avatar was generated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      data: { avatarUrl: "dicebear:croodles-neutral:abc" },
      error: null
    } as never);
    await saveAvatar(GENERATED);
    expect(calls).toEqual([`update:${GENERATED}`]);
  });

  it("does not delete a photo the new upload overwrote in place", async () => {
    await saveAvatar(`${USER_ID}.webp`);
    expect(calls).toEqual([`update:${USER_ID}.webp`]);
  });

  it("removes an old upload with a different extension", async () => {
    await saveAvatar(`${USER_ID}.png`);
    expect(calls).toEqual([`update:${USER_ID}.png`, `remove:${USER_ID}.webp`]);
  });

  it("refuses another user's file and changes nothing", async () => {
    const result = await saveAvatar("someone-else.webp");
    expect(result.error?.category).toBe("validation");
    expect(calls).toEqual([]);
  });
});

// Anyone with resources update may change anyone's attribute values; others
// only their own, of an attribute marked as self-managed.
describe("attribute values", () => {
  const OTHER = "9a8b7c6d-0000-4000-8000-000000000000";
  const value = {
    userAttributeId: "attribute-1",
    type: "text",
    value: "Blue"
  };

  function contextAs(permissions: Record<string, unknown>) {
    return createServiceContext({
      actor: {
        type: "user",
        userId: USER_ID,
        permissions: {
          documents: { view: ["company-1"], create: [], update: [], delete: [] },
          ...permissions
        } as never
      },
      company: { id: "company-1", groupId: "group-1" },
      caller: {} as never,
      system: unreachable as never,
      pg: unreachable as never,
      kv: unreachable as never
    });
  }

  beforeEach(() => {
    vi.mocked(upsertUserAttributeValue).mockResolvedValue({
      data: { id: "value-1" },
      error: null
    } as never);
    vi.mocked(deleteUserAttributeValue).mockResolvedValue({
      error: null
    } as never);
  });

  it("lets resources update change another person's value", async () => {
    const result = await upsertAttributeValue(
      contextAs({ resources: { update: ["company-1"] } }),
      { ...value, userId: OTHER }
    );
    expect(result.data).toEqual({ userAttributeValueId: "value-1" });
  });

  it("refuses another person's value without resources update", async () => {
    const result = await upsertAttributeValue(contextAs({}), {
      ...value,
      userId: OTHER
    });
    expect(result.error?.category).toBe("forbidden");
    expect(upsertUserAttributeValue).not.toHaveBeenCalled();
  });

  it("lets a person set their own self-managed value", async () => {
    vi.mocked(getAttribute).mockResolvedValue({
      data: { canSelfManage: true },
      error: null
    } as never);
    const result = await upsertAttributeValue(contextAs({}), {
      ...value,
      userId: USER_ID
    });
    expect(result.error).toBeNull();
  });

  it("refuses removing their own value of a managed attribute", async () => {
    vi.mocked(getAttribute).mockResolvedValue({
      data: { canSelfManage: false },
      error: null
    } as never);
    const result = await deleteAttributeValue(contextAs({}), {
      userId: USER_ID,
      userAttributeId: "attribute-1",
      userAttributeValueId: "value-1"
    });
    expect(result.error?.category).toBe("forbidden");
    expect(deleteUserAttributeValue).not.toHaveBeenCalled();
  });
});
