// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ScanReader, typedByScanner } from "../hooks/useKeyboardWedge";

// A kanban URL is 70 characters: 69 gaps between its first and last key.
describe("typedByScanner", () => {
  it("accepts a URL a scanner typed at 8 ms per key", () => {
    expect(typedByScanner(0, 69 * 8, 70)).toBe(true);
  });

  it("accepts a scan with one slow gap when the average is still scanner speed", () => {
    // 68 gaps of 10 ms and one Bluetooth hiccup of 400 ms: 1080 / 69 ≈ 15.7 ms.
    expect(typedByScanner(0, 68 * 10 + 400, 70)).toBe(true);
  });

  it("refuses the same URL typed by a person at 150 ms per key", () => {
    expect(typedByScanner(0, 69 * 150, 70)).toBe(false);
  });

  it("refuses an average of exactly 50 ms per key", () => {
    expect(typedByScanner(0, 69 * 50, 70)).toBe(false);
  });

  it("refuses a single key, which has no speed", () => {
    expect(typedByScanner(100, 100, 1)).toBe(false);
  });
});

const URL_TEXT = "https://erp.carbon.ms/api/kanban/complete/kbn_8f3k2m1q";

/** Types `text` into `reader` from `start` at `gap` ms per key; returns the last key's time. */
function type(reader: ScanReader, text: string, start: number, gap: number) {
  let at = start;
  for (const char of text) {
    reader.key(char, at);
    at += gap;
  }
  return at - gap;
}

describe("ScanReader", () => {
  it("reads a scan at scanner speed", () => {
    const reader = new ScanReader();
    type(reader, URL_TEXT, 0, 8);
    expect(reader.isScan()).toBe(true);
    expect(reader.candidates()[0]).toBe(URL_TEXT);
  });

  it("drops a stray key pressed a second before the scan", () => {
    const reader = new ScanReader();
    reader.key("a", 0);
    type(reader, URL_TEXT, 1000, 8);
    expect(reader.candidates()[0]).toBe(URL_TEXT);
  });

  it("joins a scan the scanner paused for 400 ms part-way through", () => {
    const reader = new ScanReader();
    const last = type(reader, URL_TEXT.slice(0, 30), 0, 8);
    type(reader, URL_TEXT.slice(30), last + 400, 8);
    expect(reader.candidates()[0]).toBe(URL_TEXT);
  });

  it("keeps every printable character, including % # + and spaces", () => {
    const reader = new ScanReader();
    const text = "https://erp.carbon.ms/x/items?search=M6%20bolt+nut#top KB 1";
    type(reader, text, 0, 8);
    expect(reader.candidates()[0]).toBe(text);
  });

  it("holds keys back from the page only from the fourth scanner-speed key", () => {
    const reader = new ScanReader();
    const holds = [..."http"].map((char, i) => reader.key(char, i * 8).hold);
    expect(holds).toEqual([false, false, false, true]);
  });

  it("never treats a person typing as a scan", () => {
    const reader = new ScanReader();
    type(reader, "hello", 0, 150);
    expect(reader.isScan()).toBe(false);
    expect(reader.typedByScanner()).toBe(false);
    expect(reader.candidates()).toEqual(["o"]);
  });

  it("does not count two keys pressed together as a scan", () => {
    const reader = new ScanReader();
    type(reader, "gs", 0, 20);
    expect(reader.isScan()).toBe(false);
  });
});
