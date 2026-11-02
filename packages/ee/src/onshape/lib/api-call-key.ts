// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/** Whether Onshape bills a call that answered `status`: it bills a private
 *  app for every 2xx and 3xx response, and for nothing else. No status (a
 *  timeout or a dropped connection) is not billed. */
export function isBilledCall(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 400;
}

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
