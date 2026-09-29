/**
 * The inbound-family gate moved to `@carbon/ee/ramp.server` (`lib/modes.ts`) when
 * install modes landed: it now consults the MODE's ceiling as well as the stored
 * toggles, and the ceiling is defined with the mode. Re-exported here so the
 * family modules' imports are unchanged.
 */
export {
  isRampInboundFamilyEnabled,
  type RampInboundFamily
} from "@carbon/ee/ramp.server";

export function isRampEntityInScope(
  configuredEntityId: string | undefined,
  rowEntityId: string | null | undefined
): boolean {
  return configuredEntityId === undefined || rowEntityId === configuredEntityId;
}

export function rampEntityQuery(configuredEntityId: string | undefined): {
  entity_id?: string;
} {
  return configuredEntityId ? { entity_id: configuredEntityId } : {};
}
