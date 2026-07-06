# Printing Settings UI Redesign

## Summary

Replace the current multi-card printing settings page with a two-section layout: a printers list at top, and an assignment tree below that shows every location with its shipping, receiving, and work center rows. The tree makes it immediately obvious which printer handles any given print job, where printers are missing, and where inheritance is in effect.

## Data Model Changes

### PrintingSettings type (replaces current structure)

```typescript
type PrintingSettings = {
  assignments: Record<string, LocationAssignment>;
  // keyed by locationId
};

type LocationAssignment = {
  defaultPrinterRouteId: string | null;
  defaultAutoPrint: boolean;
  shipping: ContextAssignment;
  receiving: ContextAssignment;
  workCenters: Record<string, ContextAssignment>;
  // workCenters keyed by workCenterId
};

type ContextAssignment = {
  printerRouteId: string | null; // null = inherit from location default
  autoPrint: boolean;
};
```

### PrinterRoute table changes

Add `templateId` column (text, nullable) to the `printerRoute` table. This replaces the per-document-type template assignment.

Remove: `autoPrint` from companySettings.printing (now per-row in assignments). Remove: `locationOverrides`, `workCenterOverrides`, `assignments` (old shape) from companySettings.printing.

## UI Structure

### Page Layout

```
┌─────────────────────────────────────────────┐
│ Printing                    [View Prints]   │
├─────────────────────────────────────────────┤
│ Printers                    [+ Add Printer] │
│ ┌─────────────────────────────────────────┐ │
│ │ Zebra 4x6  ZPL  label4x6  https://...  │ │
│ │ Zebra 2x1  ZPL  label2x1  https://...  │ │
│ │ HP LaserJet PDF            https://...  │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Assignments                                 │
│                                             │
│ Main Warehouse          Zebra 4x6    [auto] │
│   Shipping              Zebra 2x1    [auto] │
│   Receiving          inherits 4x6    [auto] │
│   WC Assembly Line 1    Zebra 2x1    [auto] │
│   WC Pack Station    inherits 4x6    [auto] │
│                                             │
│ East Facility           ⚠ No printer [auto] │
│   Shipping              ⚠ No printer [auto] │
│   Receiving             ⚠ No printer [auto] │
│   WC Inspection         ⚠ No printer [auto] │
└─────────────────────────────────────────────┘
```

### Printers Section

A card with a list of physical printers. Each row shows:
- Printer name (font-medium)
- Format badge (uppercase, muted)
- Media size (muted, if set)
- URL (monospace, muted, truncated)
- Template ID (muted, if set)
- Actions: dropdown menu with Test, Edit, Delete

"Add Printer" button opens a modal with fields: name, format, media size, location, printer URL, API key, template ID.

### Assignments Section

A card with the full assignment tree. The tree is built from all locations, with their work centers nested underneath.

**Row structure:** Each row is a flex container with:
- Left: context label (location name bold at top level, "Shipping"/"Receiving"/WC name indented)
- Right: printer assignment + auto-print toggle

**Work center prefix:** Work center rows show a "WC" label in small muted text before the name, to visually distinguish them from shipping/receiving.

**Indentation:** Shipping, receiving, and work center rows are indented with `pl-7` (28px).

### Printer Assignment States

Each assignment cell has three visual states:

1. **Explicitly assigned** — printer name shown in normal text. Clickable to change via inline dropdown.
2. **Inherited** — "inherits [printer name]" in italic muted text. Clickable to set an explicit override.
3. **No printer** — warning icon + "No printer" in destructive/red text. Clickable to assign. This appears when no printer is set AND the location has no default to inherit from.

### Inline Editing

Clicking any printer assignment (in any state) converts that cell to a Select dropdown populated with available printers, plus a "None" option to clear an override (which reverts to inheritance). The dropdown saves immediately on selection (no save button needed).

### Auto-Print Toggle

Each row has a Switch/toggle on the right side. This controls whether labels auto-print for that context. The toggle saves immediately on change.

### Inheritance Logic

- Shipping/receiving/work center rows inherit from their location's default printer.
- If a row has an explicit `printerRouteId`, that's used (shown as assigned).
- If a row's `printerRouteId` is null, it inherits the location default (shown as "inherits X").
- If a row's `printerRouteId` is null AND the location default is also null, it shows the warning state.

## Action Intents

The page action handler supports these intents:

| Intent | Fields | Description |
|--------|--------|-------------|
| `upsertRoute` | id?, name, format, mediaSizeId, printerUrl, apiKey?, locationId?, templateId? | Create or update a printer |
| `testPrint` | routeId | Send test label to printer |
| `updateAssignment` | locationId, context, contextId?, printerRouteId?, autoPrint? | Update a single assignment row |

The `context` field is one of: `default`, `shipping`, `receiving`, `workCenter`. When context is `workCenter`, `contextId` is the work center ID.

`updateAssignment` reads the current printing settings, merges the change into the correct location/context, and writes back. This replaces the old separate intents for location overrides, work center overrides, and auto-print.

Printer deletion continues to use the existing `printing.$id.delete.tsx` child route.

## Loader Data

The loader fetches:
- `companySettings` (for printing JSON)
- `printerRoutes` (list of printers)
- `locations` (all locations)
- `workCenters` (all work centers — grouped by locationId on the client)

Work centers are grouped by `locationId` client-side to build the tree.

## Migration Notes

- Add `templateId` column to `printerRoute` table.
- Migrate existing `assignments[docType].templateId` values to the corresponding printer's `templateId` column.
- Migrate existing `locationOverrides`, `workCenterOverrides`, and `autoPrint` data into the new `assignments` shape in the printing JSONB column.
- Old shape can be dropped after migration.

## Out of Scope

- Kanban card document type (deferred)
- Per-document-type assignments (simplified to product labels only)
- Template management UI (just a text field on the printer for now)
