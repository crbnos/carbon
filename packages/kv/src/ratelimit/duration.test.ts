// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ms } from "./duration";

describe("duration parser", () => {
  describe("ms()", () => {
    it("should parse milliseconds", () => {
      expect(ms("100ms")).toBe(100);
      expect(ms("1ms")).toBe(1);
      expect(ms("1000ms")).toBe(1000);
    });

    it("should parse milliseconds with space", () => {
      expect(ms("100 ms")).toBe(100);
      expect(ms("1 ms")).toBe(1);
    });

    it("should parse seconds", () => {
      expect(ms("1s")).toBe(1000);
      expect(ms("10s")).toBe(10000);
      expect(ms("60s")).toBe(60000);
    });

    it("should parse seconds with space", () => {
      expect(ms("1 s")).toBe(1000);
      expect(ms("10 s")).toBe(10000);
    });

    it("should parse minutes", () => {
      expect(ms("1m")).toBe(60000);
      expect(ms("5m")).toBe(300000);
      expect(ms("60m")).toBe(3600000);
    });

    it("should parse minutes with space", () => {
      expect(ms("1 m")).toBe(60000);
      expect(ms("5 m")).toBe(300000);
    });

    it("should parse hours", () => {
      expect(ms("1h")).toBe(3600000);
      expect(ms("24h")).toBe(86400000);
    });

    it("should parse hours with space", () => {
      expect(ms("1 h")).toBe(3600000);
      expect(ms("24 h")).toBe(86400000);
    });

    it("should parse days", () => {
      expect(ms("1d")).toBe(86400000);
      expect(ms("7d")).toBe(604800000);
    });

    it("should parse days with space", () => {
      expect(ms("1 d")).toBe(86400000);
      expect(ms("7 d")).toBe(604800000);
    });

    it("should throw on invalid format", () => {
      expect(() => ms("invalid" as any)).toThrow("Unable to parse window size");
      expect(() => ms("10" as any)).toThrow("Unable to parse window size");
      expect(() => ms("10x" as any)).toThrow("Unable to parse window size");
      expect(() => ms("" as any)).toThrow("Unable to parse window size");
    });

    it("should handle edge cases", () => {
      expect(ms("0s")).toBe(0);
      expect(ms("0 s")).toBe(0);
      expect(ms("0m")).toBe(0);
    });
  });
});
