/**
 * The name offered for the next connected account.
 *
 * Extracted from `ConnectionsTab` so it can be tested: the default is the app's own
 * name, so with one account already connected the SECOND always collided with the
 * first — the Add button sat disabled beside a field showing a name the user never
 * typed, and nothing said what to do about it.
 */
export function suggestConnectionName(
  defaultName: string,
  taken: ReadonlySet<string>
): string {
  if (!taken.has(defaultName)) return defaultName;
  let n = 2;
  while (taken.has(`${defaultName} ${n}`)) n += 1;
  return `${defaultName} ${n}`;
}
