# Carbon Project Overview

## Project Structure

Carbon is a manufacturing system built with modern web technologies. It consists of three main applications:

1. **ERP (Enterprise Resource Planning)** - Located at `/apps/erp/`
2. **MES (Manufacturing Execution System)** - Located at `/apps/mes/`
3. **University (Training App)** - Located at `/apps/university/`

## Technology Stack

### Frontend

- **Framework**: Remix (React-based)
- **UI Components**: Custom component library at `/packages/react/`
- **Styling**: Tailwind CSS
- **Forms**: Custom form library at `/packages/form/`
- **TypeScript**: Strict mode enabled

### Backend

- **Database**: Supabase (PostgreSQL)
- **Edge Functions**: Vercel Edge Runtime
- **Authentication**: Supabase Auth via `/packages/auth/`

### Build Tools

- **Monorepo**: NPM workspaces with Turbo
- **Bundler**: Vite
- **Linting**: ESLint with custom config
- **Formatting**: Prettier

## Package Structure

The monorepo uses NPM workspaces with packages located in `/packages/`:

- `auth` - Authentication services and utilities
- `database` - Database types and migrations
- `documents` - PDF/Email/ZPL document generation
- `form` - Form components and validation
- `kv` - Key-value store (Redis)
- `logger` - Logging utilities
- `notifications` - Notification services
- `react` - Shared React components
- `remix` - Remix-specific utilities
- `utils` - Common utilities

## Common Patterns

### File Organization

Each app follows a consistent structure:

- `components/` - React components
- `hooks/` - Custom React hooks
- `routes/` - Remix routes
- `services/` - Business logic and API calls
- `stores/` - State management (appears to use nanostores)
- `styles/` - CSS files
- `types/` - TypeScript types and validators
- `utils/` - Utility functions

### Module Organization

The ERP app organizes business logic into modules:

- Each module has its own folder in `/modules/`
- Contains `.models.ts`, `.service.ts`, and UI components
- Examples: sales, purchasing, inventory, accounting, etc.

### Database Access

- Uses Supabase client from `@carbon/auth`
- Type-safe queries with generated types from `@carbon/database`
- Service functions handle database operations

### Routing

- Uses Remix flat routes
- Protected routes under `x+/` prefix
- Public routes under `_public+/` prefix
- API routes under `api+/` prefix
- File serving routes under `file+/` prefix
- External/shared routes under `share+/` prefix

## External Links System

The system supports external links for sharing quotes and customer portals:

### Database Structure
- `externalLink` table stores external link records
- Fields: `id` (UUID), `documentType` (enum), `documentId`, `customerId`, `createdAt`, `expiresAt`, `companyId`
- Document types: `'Quote'`, `'Customer'` (added in 2025-07-11 migration)

### URL Structure
External links follow these patterns:
- **Quote Links**: `/share/quote/{externalLinkId}`
  - Example: `https://domain.com/share/quote/123e4567-e89b-12d3-a456-426614174000`
- **Customer Portal Links**: Expected pattern `/share/customer/{externalLinkId}` (route not yet implemented)

### Path Configuration
In `/apps/erp/app/utils/path.ts`:
- `path.to.externalQuote(id)` generates `/share/quote/${id}`
- Quote sharing implemented in `QuoteHeader.tsx` using `window.location.origin + path.to.externalQuote(externalLinkId)`

### Services
- `upsertExternalLink()` - Create/update external links
- `getCustomerPortals()` - List customer portal links
- `getCustomerPortal()` - Get specific customer portal
- `deleteCustomerPortal()` - Delete customer portal link

### Current Implementation Status
- ✅ Quote external links fully implemented (`/share/quote/{id}`)
- ⚠️ Customer portal links have database support but no public route yet
- ⚠️ Customer portal form exists but routes incomplete (`path.to.customerPortal()`, `path.to.newCustomerPortal` not defined)
