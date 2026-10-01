// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";

/**
 * One glossary entry: a domain term, a one-sentence definition, and an optional
 * link to where it's explained in the docs.
 *
 * `term` and `definition` are Lingui `MessageDescriptor`s (built with `msg`) —
 * so the extractor picks them up and ERP/MES translate them via `i18n._()`.
 * For consumers without a Lingui runtime (docs site), read the source English
 * off `descriptor.message` via `getTermText` / `getDefinitionText`.
 */
export type GlossaryEntry = {
  /** Canonical name shown as the popover heading. */
  term: MessageDescriptor;
  /** One crisp, grounded sentence. */
  definition: MessageDescriptor;
  /** Optional internal route + section anchor for the "Learn more" link. */
  href?: string;
  /**
   * Alternate slugs that resolve to this entry. Lets MDX prose write either
   * the canonical or the spelled-out form and land on the same entry.
   */
  aliases?: readonly string[];
};
