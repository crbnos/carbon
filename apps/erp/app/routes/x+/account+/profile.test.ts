// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, updateAvatar } from "~/modules/account";
import { action } from "./profile";

// The photo intent saves the new avatar value, then deletes the photo it
// replaced. The order is the point: deleting first and then failing the save
// left avatarUrl pointing at a file that no longer existed.

vi.mock("@lingui/core/macro", () => ({ msg: (value: unknown) => value }));
vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("@carbon/react", () => ({ VStack: () => null }));
vi.mock("~/modules/account/ui/Profile", () => ({ ProfileForm: () => null }));
vi.mock("~/modules/account", () => ({
  accountProfileValidator: {},
  getAccount: vi.fn(),
  getCurrentUser: vi.fn(),
  updateAvatar: vi.fn(),
  updatePublicAccount: vi.fn()
}));

const USER_ID = "5f0c3d2a-1b2c-4d5e-8f90-123456789abc";
const GENERATED = "dicebear:voxel-art:3f2b8c4e-6a1d-4f7e-9b2c:1e3a8a";

const calls: string[] = [];
const remove = vi.fn(async (paths: string[]) => {
  calls.push(`remove:${paths.join(",")}`);
  return { error: null };
});

function postPhoto(path: string) {
  const body = new FormData();
  body.append("intent", "photo");
  body.append("path", path);
  return action({
    request: new Request("https://erp.example.com/x/account/profile", {
      method: "POST",
      body
    }),
    params: {},
    context: {}
  } as never);
}

async function run(path: string) {
  try {
    await postPhoto(path);
  } catch (thrown) {
    // The action ends with a thrown redirect, success or not.
    return thrown;
  }
  throw new Error("expected the action to throw a redirect");
}

describe("profile action, photo intent", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.mocked(requirePermissions).mockResolvedValue({
      userId: USER_ID,
      client: { storage: { from: () => ({ remove }) } }
    } as never);
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
    remove.mockClear();
  });

  it("saves the generated avatar, THEN deletes the photo it replaced", async () => {
    await run(GENERATED);
    expect(calls).toEqual([`update:${GENERATED}`, `remove:${USER_ID}.webp`]);
  });

  it("keeps the photo when the save fails", async () => {
    vi.mocked(updateAvatar).mockResolvedValue({
      error: { message: "boom" }
    } as never);
    await run(GENERATED);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes nothing when the previous avatar was generated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      data: { avatarUrl: "dicebear:croodles-neutral:abc" },
      error: null
    } as never);
    await run(GENERATED);
    expect(calls).toEqual([`update:${GENERATED}`]);
  });

  it("does not delete a photo the new upload overwrote in place", async () => {
    await run(`${USER_ID}.webp`);
    expect(calls).toEqual([`update:${USER_ID}.webp`]);
  });

  it("removes an old upload with a different extension", async () => {
    await run(`${USER_ID}.png`);
    expect(calls).toEqual([`update:${USER_ID}.png`, `remove:${USER_ID}.webp`]);
  });

  it("refuses another user's file and changes nothing", async () => {
    await run("someone-else.webp");
    expect(calls).toEqual([]);
  });
});
