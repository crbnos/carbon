/**
 * The unit axis (FIX-1) — the list of units an operator pages through ("Unit X of N").
 *
 * Quantity-centric, so it works for *every* tracking type:
 *   - Serial:    `count` entities → unit i bound to entities[i]
 *   - Batch:     1 lot entity     → unit 0 bound to the lot, units 1..N-1 bound to null
 *   - Inventory: 0 entities       → every unit bound to null
 *
 * `index` is the 0-based axis position and is the key written to
 * `jobOperationStepRecord.index` / the inspection result record, identical to the
 * convention the Operation view already uses. This is what isolates unit i's
 * step records from every other unit. See .ai/specs/2026-07-14-mes-execution-views.md
 * §2 ("unit axis").
 */
export type Unit<E> = {
  index: number;
  entity: E | null;
};

/**
 * Derive the unit axis from a unit count and an optional list of tracked entities.
 *
 * @param count    How many units to page — `operationQuantity` for Assembly, or the
 *                 derived sample size for Inspection. Rounded and clamped to >= 1 so a
 *                 missing/zero/NaN quantity still yields a single shared unit (mirrors the
 *                 existing `Math.max(1, Math.round(operationQuantity))` behavior).
 * @param entities The tracked entities, in their stable loader order. Entities beyond
 *                 `count` are ignored (a job may pre-generate more serials than it builds);
 *                 a `count` longer than the list binds the surplus units to `null`.
 */
export function deriveUnits<E>(
  count: number,
  entities?: readonly E[] | null
): Unit<E>[] {
  const total = Math.max(1, Math.round(Number.isFinite(count) ? count : 1));
  const list = entities ?? [];

  return Array.from({ length: total }, (_, index) => ({
    index,
    entity: list[index] ?? null
  }));
}
