// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The built client, read once when the server starts.
//
// An image's files never change under it, so everything a request for a
// file needs is worked out here: which files exist, what each is called,
// and — for all but the largest — the bytes themselves. Serving one is
// then a lookup and a write. Read from disk per request, each cost a
// stat, an open and a stream on libuv's four threads, which are the same
// four that compress every rendered page.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isUtf8MimeType, mime } from "@fastify/send";

/** One answer to a request for a file, ready to send. */
export type Asset = {
  body: Buffer;
  headers: Record<string, string>;
};

export type AssetEntry = {
  /** The Brotli copy the build left beside the file, when it left one. */
  brotli: Asset | null;
  /**
   * The file as it is, when that is what most callers get and it is small
   * enough to hold. Otherwise it is on disk, and sent from there.
   */
  plain: Asset | null;
};

// Past this a file stays on disk: a 3D model is megabytes, fetched rarely,
// and wants byte ranges, which the file sender answers.
const HELD_IN_MEMORY = 1024 * 1024;

// Fingerprinted by the build: the name changes when the bytes do.
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATED = "public, max-age=3600";

export const cacheControl = (name: string) =>
  name.startsWith("assets/") ? IMMUTABLE : REVALIDATED;

/** By the library that sends the files, so both copies of one are called one thing. */
function contentType(name: string): string {
  const type = mime.getType(name) ?? "application/octet-stream";
  return isUtf8MimeType(type) ? `${type}; charset=utf-8` : type;
}

function held(file: string, headers: Record<string, string>): Asset {
  const body = readFileSync(file);
  const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  return { body, headers: { ...headers, etag } };
}

/** Every file under `root`, by its path from it. */
export function loadAssets(root: string): Map<string, AssetEntry> {
  const names = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    )
    .filter((name) => !name.split("/").some((part) => part.startsWith(".")));
  const onDisk = new Set(names);

  const assets = new Map<string, AssetEntry>();
  for (const name of names) {
    // A copy of the file before it, not a file of its own.
    if (name.endsWith(".br") && onDisk.has(name.slice(0, -3))) continue;

    const file = path.join(root, name);
    const headers = {
      "content-type": contentType(name),
      "cache-control": cacheControl(name)
    };
    const compressed = onDisk.has(`${name}.br`);
    assets.set(name, {
      brotli: compressed
        ? held(`${file}.br`, {
            ...headers,
            "content-encoding": "br",
            vary: "Accept-Encoding"
          })
        : null,
      plain:
        !compressed && statSync(file).size <= HELD_IN_MEMORY
          ? held(file, headers)
          : null
    });
  }
  return assets;
}
