// Standalone (like allocation.ts) so unit tests can import it without pulling
// the operations service barrel, whose transitive imports need macro transforms.

/**
 * First-operation auto-advance decision (`useOperation`). On the first
 * operation units flow #1..#N without scanning, so we auto-select the next
 * incomplete unit — but only on arrival with nothing selected, or when the
 * unit the operator was holding itself completes. An explicit selection of an
 * already-complete unit (going back to review or re-print a label) must never
 * be overridden.
 */
export function shouldAdvanceToNextSerialUnit({
  selectedEntityId,
  selectedIsIncomplete,
  heldEntityId
}: {
  selectedEntityId: string | null;
  selectedIsIncomplete: boolean;
  heldEntityId: string | null;
}): boolean {
  if (selectedIsIncomplete) return false;
  return !selectedEntityId || selectedEntityId === heldEntityId;
}
