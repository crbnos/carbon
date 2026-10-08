// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  avatarSrc,
  formatGeneratedAvatar,
  GENERATED_AVATAR_STYLES,
  isAllowedAvatarValue,
  isGeneratedAvatar,
  isOwnAvatarUpload,
  newGeneratedAvatar,
  normalizeAvatarBackground,
  parseGeneratedAvatar
} from "./avatar";

describe("generated avatars", () => {
  it("parses a generated value into its style and seed", () => {
    expect(
      parseGeneratedAvatar("dicebear:croodles-neutral:0b6f2c1e-9a")
    ).toEqual({
      style: "croodles-neutral",
      seed: "0b6f2c1e-9a",
      background: null
    });
  });

  it("does not treat an uploaded photo path as generated", () => {
    expect(isGeneratedAvatar("5f0c3d2a-1b2c-4d5e-8f90-123456789abc.webp")).toBe(
      false
    );
  });

  it("rejects empty, missing and malformed seeds", () => {
    expect(isGeneratedAvatar(null)).toBe(false);
    expect(isGeneratedAvatar(undefined)).toBe(false);
    expect(isGeneratedAvatar("dicebear:croodles-neutral:")).toBe(false);
    expect(isGeneratedAvatar("dicebear:croodles-neutral:a/b")).toBe(false);
    expect(
      isGeneratedAvatar(`dicebear:croodles-neutral:${"a".repeat(65)}`)
    ).toBe(false);
    expect(isGeneratedAvatar("dicebear:")).toBe(false);
    expect(isGeneratedAvatar("dicebear:croodles-neutral")).toBe(false);
  });

  it("accepts every supported style and nothing else", () => {
    for (const style of GENERATED_AVATAR_STYLES) {
      expect(parseGeneratedAvatar(`dicebear:${style}:abc`)).toEqual({
        style,
        seed: "abc",
        background: null
      });
      expect(isGeneratedAvatar(newGeneratedAvatar(style))).toBe(true);
    }
    // A DiceBear style we do not ship.
    expect(isGeneratedAvatar("dicebear:adventurer:abc")).toBe(false);
  });

  it("creates the default style when no style is given", () => {
    expect(parseGeneratedAvatar(newGeneratedAvatar())?.style).toBe(
      "croodles-neutral"
    );
  });

  it("creates a new random value each call", () => {
    const first = newGeneratedAvatar();
    const second = newGeneratedAvatar();
    expect(isGeneratedAvatar(first)).toBe(true);
    expect(isGeneratedAvatar(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("accepts values with a UUID seed", () => {
    // The format a draft column default wrote during development; rows
    // created then still hold it.
    expect(
      isGeneratedAvatar(
        "dicebear:croodles-neutral:3f2b8c4e-6a1d-4f7e-9b2c-5d8e1a0f7c63"
      )
    ).toBe(true);
  });

  describe("what a user may store", () => {
    const userId = "5f0c3d2a-1b2c-4d5e-8f90-123456789abc";

    it("accepts the user's own upload", () => {
      expect(isOwnAvatarUpload(userId, `${userId}.webp`)).toBe(true);
      expect(isAllowedAvatarValue(userId, `${userId}.png`)).toBe(true);
    });

    it("accepts a generated avatar", () => {
      expect(isAllowedAvatarValue(userId, newGeneratedAvatar())).toBe(true);
    });

    it("rejects another user's file, folders, a bare id and empty values", () => {
      expect(isAllowedAvatarValue(userId, "someone-else.webp")).toBe(false);
      expect(isAllowedAvatarValue(userId, `${userId}./../x.webp`)).toBe(false);
      expect(isAllowedAvatarValue(userId, `tmp/${userId}.webp`)).toBe(false);
      expect(isAllowedAvatarValue(userId, `${userId}.`)).toBe(false);
      expect(isAllowedAvatarValue(userId, userId)).toBe(false);
      expect(isAllowedAvatarValue(userId, "")).toBe(false);
      expect(isAllowedAvatarValue(userId, null)).toBe(false);
    });
  });

  describe("background color", () => {
    it("parses an optional background segment", () => {
      expect(parseGeneratedAvatar("dicebear:voxel-art:seed-1:3b82f6")).toEqual({
        style: "voxel-art",
        seed: "seed-1",
        background: "3b82f6"
      });
    });

    it("rejects a malformed background or extra segments", () => {
      expect(isGeneratedAvatar("dicebear:voxel-art:seed-1:#3b82f6")).toBe(
        false
      );
      expect(isGeneratedAvatar("dicebear:voxel-art:seed-1:3B82F6")).toBe(false);
      expect(isGeneratedAvatar("dicebear:voxel-art:seed-1:abc")).toBe(false);
      expect(isGeneratedAvatar("dicebear:voxel-art:seed-1:")).toBe(false);
      expect(isGeneratedAvatar("dicebear:voxel-art:seed-1:3b82f6:x")).toBe(
        false
      );
    });

    it("normalizes picker input to lowercase rrggbb", () => {
      expect(normalizeAvatarBackground("#3B82F6")).toBe("3b82f6");
      expect(normalizeAvatarBackground("#abc")).toBe("aabbcc");
      expect(normalizeAvatarBackground("3b82f6")).toBe("3b82f6");
      expect(normalizeAvatarBackground("#12345")).toBeNull();
      expect(normalizeAvatarBackground("red")).toBeNull();
      expect(normalizeAvatarBackground("")).toBeNull();
      expect(normalizeAvatarBackground(null)).toBeNull();
    });

    it("round-trips through format and parse", () => {
      const avatar = {
        style: "planets" as const,
        seed: "seed-2",
        background: "ffd5dc"
      };
      expect(parseGeneratedAvatar(formatGeneratedAvatar(avatar))).toEqual(
        avatar
      );
      expect(formatGeneratedAvatar({ ...avatar, background: null })).toBe(
        "dicebear:planets:seed-2"
      );
      expect(newGeneratedAvatar("loops", "#FFF")).toMatch(
        /^dicebear:loops:[0-9a-f-]+:ffffff$/
      );
    });
  });

  describe("avatarSrc", () => {
    const toUrl = (path: string) =>
      `https://storage.example.com/avatars/${path}`;

    it("passes a generated avatar through untouched", () => {
      const value = "dicebear:planets:seed-1:1e3a8a";
      expect(avatarSrc(value, toUrl)).toBe(value);
    });

    it("turns an uploaded photo's path into a URL", () => {
      expect(avatarSrc("user-1.webp", toUrl)).toBe(
        "https://storage.example.com/avatars/user-1.webp"
      );
    });

    it("returns undefined for no avatar", () => {
      expect(avatarSrc(null, toUrl)).toBeUndefined();
      expect(avatarSrc("", toUrl)).toBeUndefined();
    });
  });
});
