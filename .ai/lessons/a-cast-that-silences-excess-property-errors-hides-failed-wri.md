---
paths: []
triggers: []
promoted: null
---
# A cast that silences excess-property errors hides failed writes

**Context:** supabase-js 2.117 types reject keys a table does not have (`RejectExcessProperties`). The upgrade wrapped ~75 failing write payloads in `unchecked()` (a cast to `never`) to get typecheck green.

**Problem:** About 30 of those were typed payloads (a zod validator spread into an insert/update) carrying fields the table lacks: `item.shelfLifeCalculateFromBom`, `ability.name`, `quote.notes`, `salesOrder.promisedDate`, `batchProperty.batchPropertyGroupId`, and more. PostgREST rejects any unknown column with PGRST204, so every such write failed whenever the field was present, and `itemValidator`'s always-present checkbox made the BoM explorer's item edit (`api+/item.$type.ts` → `updateItem`) fail on every save. The cast had removed the only warning. The 2.80 types never rejected excess keys, so these were latent all along.

**Rule:** Never cast a typed payload past the table's type. When the compiler names an extra key, destructure it out at the write, where every caller is covered, and say where the value actually lives. `unchecked()` is only for a column or table chosen at runtime (`{ [field]: value }`, `.from(table)`). To list every extra key at once rather than one per error, probe with `Exclude<keyof Payload, keyof Database["public"]["Tables"][T]["Update"]>`.

**Applies to:** every `{module}.service.ts` write, MES `services/*.service.ts`, `packages/utils/src/object.ts` (`unchecked`).
