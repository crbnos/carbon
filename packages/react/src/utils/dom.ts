import { getLogger } from "@carbon/logger";

const log = getLogger("react", "dom");

export type Booleanish = boolean | "true" | "false";

export const dataAttr = (condition: boolean | undefined) =>
  (condition ? "" : undefined) as Booleanish;

export const ariaAttr = (condition: boolean | undefined) =>
  condition ? true : undefined;

/**
 * Copy text content (string or Promise<string>) into Clipboard.
 * Safari doesn't support write text into clipboard async, so if you need to load
 * text content async before coping, please use Promise<string> for the 1st arg.
 */
export const copyToClipboard = async (
  str: string | Promise<string>,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  callback = () => {}
) => {
  const focused = window.document.hasFocus();
  if (focused) {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      const text = await Promise.resolve(str);
      Promise.resolve(window.navigator?.clipboard?.writeText(text)).then(
        callback
      );

      return;
    }

    Promise.resolve(str)
      .then((text) => window.navigator?.clipboard?.writeText(text))
      .then(callback);
  } else {
    log.warning("Unable to copy to clipboard");
  }
};
