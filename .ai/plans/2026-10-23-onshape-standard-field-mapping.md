# Onshape panel: standard fields through the property map

## Goal

A company BOM template, a language or a customised property setup must not stop the
panel from reading the values every push needs. Today the panel finds Part number,
Revision, Name, Description, Item and Quantity by label (since `85b3216ff4`, by
`propertyName` then label ignoring case). This change gives those reads one resolver.
An admin can point each read at another Onshape property or BOM column. The admin
does this on the Fields page, which already maps custom fields.

## Design

- One pure module, `packages/ee/src/onshape/panel/standard-sources.ts`:
  - `ONSHAPE_PROPERTIES`: Onshape's own properties with their fixed property id,
    `propertyName` and default label (Name `…60d`, Description `…60e`, Part number
    `…60f`, Revision `…610`, State `…611`, Not revision managed `…61d`, Exclude from
    BOM `…61e`, Item, Quantity, Subassembly BOM behavior).
  - `standardSources(map)`: the overrides the property map holds.
  - `bomColumnIds(headers, sources)`: column id per field. An override first, then
    Onshape's own column by `propertyName`, id, then label ignoring case.
  - `identityValue(properties, field, sources)`: a metadata value by the override's
    property id, else Onshape's own property id, else label ignoring case.
  - `onshapePropertyField(property)`: which of Onshape's own properties a property
    is. Replaces `RESERVED_PROPERTY_NAMES` and `FIXED_PROPERTY_NAMES`.
- Two new property map targets (sibling of `customField` and `item`):
  - `{ kind: "identity", field: "partNumber" | "revision" | "name" | "description" }`:
    the Onshape property the value is read from. Text and list properties only.
  - `{ kind: "bomLine", field: "item" | "quantity" }`: the BOM column, stored by
    column id. Offered only when the BOM has no column the panel recognises.
- Where overrides apply: assembly BOM lines and root, Part Studio parts (one extra
  part metadata read, only when an identity override exists), release item Name and
  Description. Release pushes keep Onshape's Part number and Revision: Onshape's
  release records name them, and the Releases tab reads those records.
- Fields page: the four fixed rows become source pickers that default to Onshape's own
  property. On an assembly, Item and Quantity rows show the detected column, or a
  picker when none is detected. Changing the Part number or Revision source while
  `onshape-v2` item links exist shows a warning with the count.
- The missing-columns error names the Fields page, and the panel offers the Fields tab
  on that error.
- The v1 BOM route reads Onshape's own columns by `propertyName` (no mapping).

## Tasks

- [x] `standard-sources.ts` with the resolver and tests (default, all-caps and
      renamed label sets with real ids and `propertyName`; overrides).
- [x] `bom.ts` uses `bomColumnIds`; `parseBomTree(payload, sources)`; missing columns
      named by the override's label; message points to the Fields page.
- [x] `properties.ts`: `onshapePropertyField` replaces the reserved set; new targets
      in `parsePropertyMap`, `targetKey`, `resolveMappedFields` (skipped, but used).
- [x] Metadata reads: `identityValue` in the status and plan-assembly routes and
      `buildReleasePlan`; release package items by property id, then label.
- [x] `loadStandardSources` (`lib/panel-plan-data.ts`); status, plan-assembly,
      plan-part and plan-release pass the sources; Part Studio identity overrides.
- [x] Save validation for the new targets (`saveOnshapePropertyMap`), with tests.
- [x] Fields route: BOM columns and detection on assemblies, linked item count.
- [x] Fields page UI: identity source pickers, Item/Quantity rows, change warning,
      release note; Fields tab and a button on the missing-columns error.
- [x] v1 BOM route reads Onshape's own columns by `propertyName`.
- [x] Update `.claude/rules/onshape-panel.md` (Property map, Onshape API facts).
- [x] Typecheck `@carbon/ee` and `erp`, ee onshape tests, Biome.

## Open points

- No fixture or live response confirms that release package properties carry
  `propertyId`. The release read takes the id first and keeps the label as a
  fallback.

## Browser self-test (local stack, panel inside Onshape, 2026-10-23)

The BOM response was relabelled on the server for the template cases (a temporary edit, not committed).

- [x] Onshape's default template: Item and Quantity show Found; status, push review and Releases load.
- [x] All labels in capitals, Onshape's ids and `propertyName` kept: status loads; Fields shows ITEM and QUANTITY as Found.
- [x] Item and Quantity unrecognisable (custom ids and property names, unfamiliar labels): status refuses with Choose columns; the Fields rows show pickers; choosing both and saving loads the assembly; the push writes the BOM lines with the chosen Quantity column's values (1 and 3).
- [x] Clearing an Item override with None brings the missing-column refusal back for Item only.
- [x] A saved Quantity override whose column a BOM lacks: pushes read Onshape's own column, and the row says so.
- [x] Part number from a custom text property, empty on these parts: the change warns with the link count; parts stay linked and read "No part number"; the assembly hint and the push refusal name the property.
- [x] Part Studio: Fields shows no Item or Quantity rows; a Part number override reads part metadata.

Fixed during the self-test:
- [x] The Item and Quantity picker offered Onshape's own columns (which the save refuses) and the other row's column.
- [x] A saved Item or Quantity override could not be cleared while no column was detected (None option).
- [x] The picker placeholder now names the field ("Choose the Item column").
- [x] An assembly refresh that failed on missing columns had no Choose columns button.
- [x] The "no part number" hint and the push refusal named Part number when another property was the source.
