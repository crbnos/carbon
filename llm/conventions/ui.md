# UI Conventions

## Component Library

Use `@carbon/react` for components, `@carbon/form` for form fields.

```typescript
import { Button, Card, HStack, VStack, Table } from "@carbon/react";
import { Input, Select, Submit } from "~/components/Form";
```

## Layout Patterns

### Vertical Stack
```typescript
<VStack spacing={4}>
  <Input name="name" label="Name" />
  <Input name="description" label="Description" />
</VStack>
```

### Grid Layout
```typescript
<div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4">
  <Input name="field1" />
  <Input name="field2" />
  <Input name="field3" />
</div>
```

### Button Row
```typescript
<HStack>
  <Submit isDisabled={isDisabled}>Save</Submit>
  <Button variant="solid" onClick={onClose}>Cancel</Button>
</HStack>
```

## Polish Principles

Apply these when building or reviewing UI.

### 1. Concentric Border Radius

Outer radius = inner radius + padding.

```typescript
// Bad: same radius on parent and child
<div className="rounded-xl p-2">
  <button className="rounded-xl">...</button>
</div>

// Good: outer is larger
<div className="rounded-2xl p-2">
  <button className="rounded-lg">...</button>
</div>
```

### 2. Shadows Over Borders

Use layered `box-shadow` instead of solid borders for depth.

### 3. Tabular Numbers

For dynamic numbers, prevent layout shift:

```typescript
<span className="tabular-nums">{count}</span>
```

### 4. Scale on Press

Tactile button feedback:

```typescript
<button className="active:scale-[0.96] transition-transform">
```

Always use `0.96`. Never below `0.95`.

### 5. Minimum Hit Area

Interactive elements need 40×40px minimum. Extend with pseudo-element if needed.

### 6. Animations

- Use CSS transitions for interactive states (interruptible)
- Use keyframes for staged sequences
- Never use `transition: all` — specify exact properties
- Stagger enter animations ~100ms
- Keep exit animations subtle

```typescript
// Good
className="transition-transform"

// Bad
className="transition-all"
```

### 7. AnimatePresence

Skip animation on page load:

```typescript
<AnimatePresence initial={false}>
  ...
</AnimatePresence>
```

### 8. Font Smoothing

Applied at root level with `-webkit-font-smoothing: antialiased`.

### 9. Text Wrapping

```typescript
// Headings
<h1 className="text-wrap-balance">...</h1>

// Body text
<p className="text-wrap-pretty">...</p>
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Same border radius on parent/child | `outerRadius = innerRadius + padding` |
| Numbers cause layout shift | `tabular-nums` |
| `transition: all` | Specify exact properties |
| Animation on page load | `initial={false}` on AnimatePresence |
| Tiny hit areas | Extend to 40×40px |
| Hard borders | Use layered shadows |

## Review Checklist

- [ ] Concentric border radius on nested elements
- [ ] Icons optically centered
- [ ] Shadows instead of borders where appropriate
- [ ] Dynamic numbers use `tabular-nums`
- [ ] Buttons have scale on press
- [ ] No `transition: all`
- [ ] Interactive elements have 40×40px hit area
- [ ] Enter animations staggered
- [ ] Exit animations subtle
