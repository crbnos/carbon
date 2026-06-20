# Carbon Coding Patterns

## Import Conventions

The project uses absolute imports with these patterns:

- `@carbon/*` - For packages
- `~/` - For app-specific imports (configured in tsconfig)

Example:

```typescript
import { Button } from "@carbon/react";
import { useUser } from "~/hooks/useUser";
```

## Component Patterns

### Component Structure

- Components are typically functional components using TypeScript
- Props are defined with TypeScript interfaces
- Components are exported from index.ts files for cleaner imports

### Common Component Patterns

```typescript
// Simple component with props
interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  // Component logic
}

// Components often use the @carbon/react library
import { Button, VStack } from "@carbon/react";
```

## Service Layer Pattern

Services handle business logic and database operations:

```typescript
// Example from sales.service.ts
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function closeSalesOrder(
  client: SupabaseClient<Database>,
  orderId: string
) {
  return client
    .from("salesOrder")
    .update({
      status: "Closed",
    })
    .eq("id", orderId);
}
```

## Form Handling

The project uses a custom form library with validators:

```typescript
import { validator } from "@carbon/form";
import { z } from "zod";

export const customerValidator = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
```

## Route Patterns

### Loader Pattern

```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "moduleName",
  });
  // Data fetching logic
  return json({ data });
}
```

### Action Pattern

```typescript
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  // Handle form submission
  return json({ success: true });
}
```

## State Management

- Uses nanostores for global state
- React Query for server state
- React Router's built-in data loading for route-specific data

## Error Handling

- Uses try-catch blocks in services
- Returns structured error responses
- Type-safe error handling with TypeScript

## Authentication Pattern

```typescript
import { requirePermissions } from "@carbon/auth";

// In server-side code
const { client, companyId, userId } = await requirePermissions(request, {
  view: "sales",
});
```

## UI Patterns

- Consistent use of the Carbon design system
- Responsive design with Tailwind utilities
- Accessibility considerations (ARIA attributes)
- Dark mode support via theme system

### Popover dropdowns inside Drawers/Dialogs must stop wheel propagation

`Combobox`, `CreatableCombobox`, `CreatableMultiSelect`, `MultiSelect`, and
`ChoiceSelect` (all in `packages/react/src/`) render their options list in a
`PopoverContent` portaled to `document.body`. The `Drawer` (`Drawer.tsx`) is a
Radix Dialog, which uses `react-remove-scroll` to lock background scrolling.
Because the popover is portaled outside the dialog subtree, the scroll-lock's
document-level wheel listener intercepts wheel/touch events over the dropdown
and the list's internal `overflow-auto` container cannot scroll (symptom: the
dropdown shows only the first ~6 options and won't scroll).

Fix/required pattern: add `onWheel={(e) => e.stopPropagation()}` and
`onTouchMove={(e) => e.stopPropagation()}` to the `PopoverContent` so the event
never reaches the scroll-lock listener. Any new popover-based dropdown with an
internal scroll area used inside a drawer/dialog must follow this pattern.

The list's scroll container should also carry
`scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent` (tailwind
scrollbar plugin) so a draggable scrollbar is visible even on platforms with
overlay scrollbars (macOS). All four dropdowns now use these classes.

## Theme System

Themes are defined in `packages/utils/src/themes.ts` with CSS variables for colors. The user's selected theme is stored in the database and accessed via the `useTheme()` hook in `apps/erp/app/hooks/useTheme.tsx`.

Each theme defines a `primary` CSS variable that represents the theme's main color. To use the theme color dynamically:

```typescript
// In Recharts components, use hsl(var(--primary)) for theme-aware colors
<Bar dataKey="value" fill="hsl(var(--primary))" radius={2} />
```

The theme CSS variables are applied to the body element and include:
- `--primary` / `--primary-foreground`: Main theme color
- `--background` / `--foreground`: Base colors
- `--card`, `--popover`, `--secondary`, `--muted`, `--accent`: Component colors
- `--destructive`, `--success`: Semantic colors

Available themes: zinc (Modern), neutral (Brutal), red (Cherry), orange (Apricot), yellow (Lemon), green (Mint), blue (Blueberry), violet (Lavender)
