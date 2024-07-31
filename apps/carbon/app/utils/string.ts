export const capitalize = (words: string) => {
  const [first, ...otherLetters] = words;
  return [first.toLocaleUpperCase(), ...otherLetters].join("");
};

export const snakeToCamel = (str: string) =>
  str.replace(/([-_][a-z])/g, (group: string) =>
    group.toUpperCase().replace("-", "").replace("_", "")
  );

/**
 * Copy text content (string or Promise<string>) into Clipboard.
 * Safari doesn't support write text into clipboard async, so if you need to load
 * text content async before coping, please use Promise<string> for the 1st arg.
 */
export const copyToClipboard = async (
  str: string | Promise<string>,
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
    console.warn("Unable to copy to clipboard");
  }
};

// used to generate sequences
export const interpolateSequenceDate = (value: string | null) => {
  // replace all instances of %{year} with the current year
  if (!value) return "";
  let result = value;

  if (result.includes("%{")) {
    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const seconds = date.getSeconds();

    result = result.replace(/%{yyyy}/g, year.toString());
    result = result.replace(/%{yy}/g, year.toString().slice(-2));
    result = result.replace(/%{mm}/g, month.toString().padStart(2, "0"));
    result = result.replace(/%{dd}/g, day.toString().padStart(2, "0"));
    result = result.replace(/%{hh}/g, hours.toString().padStart(2, "0"));
    result = result.replace(/%{ss}/g, seconds.toString().padStart(2, "0"));
  }

  return result;
};
