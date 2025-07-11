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

export const customerValidator = validator(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
  })
);
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
- Remix's built-in data loading for route-specific data

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
