// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";

/**
 * An inline field, as Linear's properties: an empty field the user can edit
 * has no label above it, its button reads "Add start date" instead. A field
 * with a value, or one the user cannot edit, keeps its label; an empty
 * read-only field reads "None".
 */
export function useInlineField({
  inline,
  label,
  isEmpty,
  isReadOnly
}: {
  inline: boolean;
  label: ReactNode;
  isEmpty: boolean;
  isReadOnly?: boolean;
}) {
  const { t, i18n } = useLingui();
  const showLabel = !inline || !isEmpty || !!isReadOnly;

  let placeholder: ReactNode;
  if (isReadOnly) {
    placeholder = t`None`;
  } else if (typeof label === "string" && label) {
    const phrase = i18n.locale.startsWith("en") ? lowerCaseWords(label) : label;
    placeholder = t`Add ${phrase}`;
  } else {
    placeholder = label || t`Add`;
  }

  return { showLabel, placeholder };
}

/** "Start Date" → "start date"; an acronym ("WBS code") keeps its capitals. */
function lowerCaseWords(label: string) {
  return label
    .split(" ")
    .map((word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
    .join(" ");
}
