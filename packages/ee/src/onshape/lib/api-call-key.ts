// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/** An API path as one counter key per endpoint: the query dropped and every
 *  id (any segment that is not a lowercase word or the API version) replaced,
 *  so `/api/v10/translations/<id>` counts as `/api/v10/translations/{id}`. */
export function apiCallPathKey(path: string): string {
  return (path.split("?")[0] ?? "")
    .split("/")
    .map((segment) =>
      segment === "" ||
      (/^(v\d+|[a-z]+)$/.test(segment) && !/^[0-9a-f]{24}$/.test(segment))
        ? segment
        : "{id}"
    )
    .join("/");
}
