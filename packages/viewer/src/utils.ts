/**
 * Minimal class-name joiner. Kept local so @carbon/viewer stays free of
 * @carbon/react (and its router/i18n peer dependencies) per the assembly
 * design spec's decoupling requirement.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
