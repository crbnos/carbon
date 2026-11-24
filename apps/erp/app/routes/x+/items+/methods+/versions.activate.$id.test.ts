// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { beforeEach, expect, it, vi } from "vitest";
import { action } from "./versions.activate.$id";

vi.mock("@carbon/auth/auth.server", () => ({ authorize: vi.fn() }));
vi.mock("@carbon/auth/session.server", () => ({ flash: async () => ({}) }));

const activateMethodVersion = vi.fn();

beforeEach(() => {
  activateMethodVersion.mockReset();
  vi.mocked(authorize).mockResolvedValue({
    api: { items: { activateMethodVersion } },
    companyId: "company-1",
    userId: "user-1"
  } as unknown as Awaited<ReturnType<typeof authorize>>);
});

const post = () =>
  action({
    request: new Request(
      "http://localhost/x/items/methods/versions/activate/mm-2?methodToReplace=mm-1",
      {
        method: "POST",
        headers: { referer: "http://localhost/x/part/item-1/make/mm-1" }
      }
    ),
    params: { id: "mm-2" },
    context: {}
  } as unknown as Parameters<typeof action>[0]);

// The building block runs as the system and skips the item-type check; the
// service function checks Edit on the page of the method's item type.
it("activates through the service function, which checks the item type's page", async () => {
  activateMethodVersion.mockResolvedValue({ data: {}, error: null });
  const response = (await post()) as Response;
  expect(activateMethodVersion).toHaveBeenCalledWith({ id: "mm-2" });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/x/part/item-1/make/mm-2");
});

it("returns the refusal and does not redirect", async () => {
  activateMethodVersion.mockResolvedValue({
    data: null,
    error: { category: "forbidden", message: "You do not have permission" }
  });
  expect(await post()).toEqual({
    success: false,
    message: "You do not have permission"
  });
});
