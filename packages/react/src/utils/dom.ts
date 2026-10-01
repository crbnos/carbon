// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";

const log = getLogger("react", "dom");

export type Booleanish = boolean | "true" | "false";

export const dataAttr = (condition: boolean | undefined) =>
  (condition ? "" : undefined) as Booleanish;

export const ariaAttr = (condition: boolean | undefined) =>
  condition ? true : undefined;

/**
 * Copy text content (string or Promise<string>) into Clipboard, resolving to
 * whether it was copied. Safari doesn't support write text into clipboard
 * async, so if you need to load text content async before coping, please use
 * Promise<string> for the 1st arg.
 */
export const copyToClipboard = async (
  str: string | Promise<string>,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  callback = () => {}
): Promise<boolean> => {
  if (
    !window.document.hasFocus() ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    log.warning("Unable to copy to clipboard");
    return false;
  }
  try {
    await navigator.clipboard.writeText(await Promise.resolve(str));
    callback();
    return true;
  } catch (error) {
    log.warning("Unable to copy to clipboard", { error });
    return false;
  }
};
