// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isOwnSignaturePath } from "./signature";

const userId = "5f0c3d2a-1b2c-4d5e-8f90-123456789abc";

describe("isOwnSignaturePath", () => {
  it.each([`${userId}/aB3_x-9.png`, `${userId}/sig.jpg`, `${userId}/sig.jpeg`])(
    "accepts a file in the user's own folder: %s",
    (path) => expect(isOwnSignaturePath(userId, path)).toBe(true)
  );

  it.each([
    null,
    "",
    `${userId}/`,
    `other-user/${userId}.png`,
    `${userId}x/sig.png`,
    `${userId}/../other-user/sig.png`,
    `${userId}/nested/sig.png`,
    `${userId}/sig.svg`,
    `${userId}.png`
  ])("refuses a path outside the user's own folder: %s", (path) =>
    expect(isOwnSignaturePath(userId, path)).toBe(false)
  );

  it("refuses any path when there is no user", () =>
    expect(isOwnSignaturePath(null, `${userId}/sig.png`)).toBe(false));
});
