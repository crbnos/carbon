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
