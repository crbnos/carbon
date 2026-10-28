// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Test stand-in for `@lingui/core/macro`. The real macro is a compile-time
// transform that the apps' Vite builds run; the package's tests do not, so the
// content modules would throw on import. This builds the same kind of
// MessageDescriptor the transform emits, with the source text as its message.

import type { MessageDescriptor } from "@lingui/core";

export function msg(
  strings: TemplateStringsArray | string,
  ...values: unknown[]
): MessageDescriptor {
  const message =
    typeof strings === "string"
      ? strings
      : strings.reduce(
          (text, part, i) => text + (i > 0 ? `{${i - 1}}` : "") + part,
          ""
        );
  return {
    id: message,
    message,
    values: Object.fromEntries(values.map((value, i) => [String(i), value]))
  };
}
