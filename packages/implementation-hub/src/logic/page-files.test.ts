// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ImplementationFileRow } from "../types";
import {
  attachedFileProblem,
  canRemovePageFile,
  filesByCard,
  formatFileSize,
  pageFilePath,
  pageFileRefusal,
  pointKey
} from "./page-files";

const MB = 1024 * 1024;

describe("pageFileRefusal", () => {
  it.each([
    ["price-list.xlsx", 2 * MB],
    ["drawing.STEP", 49 * MB],
    ["photo.heic", MB]
  ])("takes %s", (name, size) => {
    expect(pageFileRefusal({ name, size })).toBeNull();
  });

  it.each(["setup.exe", "archive.zip", "script.sh", "no-extension"])(
    "refuses %s by its type",
    (name) => expect(pageFileRefusal({ name, size: 10 })).toBe("type")
  );

  it("refuses a file over the bucket's 50 MB", () => {
    expect(pageFileRefusal({ name: "scan.pdf", size: 50 * MB + 1 })).toBe(
      "size"
    );
  });
});

describe("attachedFileProblem", () => {
  const file = (
    overrides: Partial<{ path: string; name: string; size: number }> = {}
  ) => ({
    path: pageFilePath("co_1", "user_1", "abc123", "prices.csv"),
    name: "prices.csv",
    size: 2048,
    ...overrides
  });

  it("records a file stored in the person's folder", () => {
    expect(file().path).toBe("co_1/implementation/user_1/abc123/prices.csv");
    expect(attachedFileProblem(file(), "co_1", "user_1")).toBeNull();
  });

  it.each([
    [
      "another person's folder",
      { path: "co_1/implementation/user_2/abc123/prices.csv" }
    ],
    [
      "another company's folder",
      { path: "co_2/implementation/user_1/abc123/prices.csv" }
    ]
  ])("refuses a path in %s", (_, overrides) => {
    expect(attachedFileProblem(file(overrides), "co_1", "user_1")).toBe(
      "The file is not in this person's folder"
    );
  });

  it.each([
    ["no upload folder", "co_1/implementation/user_1/prices.csv"],
    ["a deeper folder", "co_1/implementation/user_1/abc/def/prices.csv"],
    ["a parent folder", "co_1/implementation/user_1/../prices.csv"],
    ["another name", "co_1/implementation/user_1/abc123/other.csv"]
  ])("refuses a path with %s", (_, path) => {
    expect(attachedFileProblem(file({ path }), "co_1", "user_1")).toBe(
      "The file's path is not one this page stores"
    );
  });

  it("refuses a type and a size the page does not take", () => {
    expect(
      attachedFileProblem(
        file({
          path: "co_1/implementation/user_1/abc123/run.exe",
          name: "run.exe"
        }),
        "co_1",
        "user_1"
      )
    ).toBe("This type of file cannot be attached");
    expect(attachedFileProblem(file({ size: 51 * MB }), "co_1", "user_1")).toBe(
      "The file is larger than 50 MB"
    );
  });
});

describe("canRemovePageFile", () => {
  it("lets Carbon staff remove any file and a person only their own", () => {
    const file = { createdBy: "user_1" };
    expect(canRemovePageFile(file, { userId: "staff", isInternal: true })).toBe(
      true
    );
    expect(
      canRemovePageFile(file, { userId: "user_1", isInternal: false })
    ).toBe(true);
    expect(
      canRemovePageFile(file, { userId: "user_2", isInternal: false })
    ).toBe(false);
  });
});

describe("filesByCard", () => {
  const row = (
    id: string,
    cardId: string,
    createdAt: string
  ): ImplementationFileRow => ({
    id,
    userId: "user_1",
    cardId,
    path: `co_1/implementation/user_1/${id}/f.pdf`,
    name: "f.pdf",
    size: 1,
    createdBy: "user_1",
    createdAt
  });

  it("groups a page's files by card, oldest first", () => {
    const grouped = filesByCard([
      row("b", "setup:parts", "2026-11-02T10:00:00Z"),
      row("c", "custom:prices", "2026-11-01T10:00:00Z"),
      row("a", "setup:parts", "2026-11-01T09:00:00Z")
    ]);
    expect(grouped.get("setup:parts")?.map((file) => file.id)).toEqual([
      "a",
      "b"
    ]);
    expect(grouped.get("custom:prices")?.map((file) => file.id)).toEqual(["c"]);
  });
});

describe("pointKey", () => {
  it("keeps a point's tick per person and card, whatever the spacing", () => {
    const key = pointKey("user_1", "custom:prices", "Send the price list");
    expect(key.startsWith("check:point.user_1.custom:prices.")).toBe(true);
    expect(pointKey("user_1", "custom:prices", "  Send the price list ")).toBe(
      key
    );
  });

  it("gives a reworded point, another card and another person new ticks", () => {
    const key = pointKey("user_1", "custom:prices", "Send the price list");
    expect(
      pointKey("user_1", "custom:prices", "Send the price lists")
    ).not.toBe(key);
    expect(pointKey("user_1", "setup:parts", "Send the price list")).not.toBe(
      key
    );
    expect(pointKey("user_2", "custom:prices", "Send the price list")).not.toBe(
      key
    );
  });
});

describe("formatFileSize", () => {
  it.each([
    [512, "512 B"],
    [34 * 1024, "34 KB"],
    [2.15 * MB, "2.2 MB"]
  ])("reads %d bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes, "en")).toBe(expected);
  });
});
