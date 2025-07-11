# Authentication System in Carbon

## Overview

Carbon uses a robust authentication system built on top of Supabase Auth with custom session management and role-based permissions. The system supports multiple authentication methods and multi-company access.

## Package Structure (@carbon/auth)

Located at `/packages/auth/`, the auth package provides:

- **Client Configuration**: Supabase client setup with service role and anonymous access
- **Authentication Services**: Login, logout, magic links, OAuth (Google), and password reset
- **Session Management**: Cookie-based sessions with automatic token refresh
- **Permission System**: Role-based access control with company-specific permissions
- **User Management**: User creation, invitation flows, and account management

### Key Files:

- `src/lib/supabase/client.ts` - Supabase client configurations
- `src/services/auth.server.ts` - Server-side authentication logic
- `src/services/session.server.ts` - Session management and cookies
- `src/services/users.ts` - User queries and permission handling
- `src/types.ts` - Authentication type definitions

## Authentication Flow

### Login Process

1. **Magic Link Flow** (Primary):

   - User enters email on `/login`
   - System sends magic link via Supabase Auth
   - User clicks link, redirected to `/callback`
   - Callback exchanges tokens and creates session

2. **OAuth Flow** (Google):
   - User clicks "Continue with Google"
   - Redirected to Google OAuth
   - Returns to `/callback` for token exchange

### Session Management

- **Storage**: HTTP-only cookies named "carbon"
- **Refresh**: Automatic token refresh before expiry (configurable threshold)
- **Security**: Secure cookies in production, domain-specific
- **Persistence**: Sessions stored with Redis for caching permissions

### Logout Process

- POST to `/logout` destroys session cookies
- Clears both auth session and company selection
- Redirects to login page

## Database Schema

### Core Tables

**user** table:

```typescript
{
  id: string (UUID, matches Supabase auth.users.id)
  email: string
  firstName: string
  lastName: string
  fullName: string | null
  about: string
  avatarUrl: string | null
  active: boolean
  admin: boolean | null
  developer: boolean | null
  createdAt: string
  updatedAt: string | null
}
```

**company** table:

```typescript
{
  id: string (UUID)
  name: string
  email: string | null
  phone: string | null
  website: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  stateProvince: string | null
  postalCode: string | null
  countryCode: string | null
  taxId: string | null
  baseCurrencyCode: string
  logo fields: logoLight, logoDark, logoLightIcon, logoDarkIcon
  slackChannel: string | null
  updatedBy: string | null
}
```

**userToCompany** table (Junction):

```typescript
{
  userId: string (FK to user.id)
  companyId: string (FK to company.id)
  role: "employee" | "supplier" | "customer" (enum)
}
```

**apiKey** table:

```typescript
{
  id: string
  key: string
  name: string
  companyId: string (FK)
  createdBy: string (FK to user.id)
  createdAt: string
}
```

## User Registration/Invitation System

### Invitation Flow

1. **Create Invite**: Admin creates invite with email and role
2. **Send Invite**: Email sent with unique invitation code
3. **Accept Invite**: User visits `/invite/:code` to accept
4. **Account Creation**: If user doesn't exist, account is created
5. **Company Association**: User linked to company with specified role

### Invitation Routes

- `GET /invite/:code` - Display invitation acceptance page
- `POST /invite/:code` - Process invitation acceptance

### Current Registration Types

- **Employee Invites**: Full access based on employee type permissions
- **Customer Invites**: Limited access for customer portal features
- **Supplier Invites**: Access to supplier-specific features

### User Creation via OAuth

1. **Database Trigger**: When a user signs up via Google OAuth, a trigger (`on_auth_user_created`) fires on the `auth.users` table
2. **Public User Creation**: The trigger function `create_public_user()` creates entries in:
   - `public.user` table with email, firstName, lastName from OAuth metadata
   - `public.userPermission` table with the user's ID
3. **Identity Group**: A separate trigger creates an identity group for the user

<<<<<<< HEAD

### Self-Signup Flow

- Login page has a "Sign up for free" link pointing to `/signup`
- User can select a plan (Starter, Business, Partner)
- # Account creation happens through:

### Self-Signup Flow (Not Yet Implemented)

- Login page has a "Sign up for free" link pointing to `/signup`
- The signup route is not yet implemented
- Current user creation only happens through:
  > > > > > > > 489408f29 (feat: signup with email)
  - Company invitations
  - OAuth authentication (Google)
  - Stripe checkout completion

## Permission System

### Structure

- **Role-based**: Users have roles (employee, customer, supplier)
- **Company-scoped**: Permissions are per-company
- **Module-based**: Permissions organized by system modules
- **Action-based**: CRUD permissions (view, create, update, delete)

### Permission Caching

- Permissions cached in Redis with key: `permissions:${userId}`
- Cache invalidated on role/permission changes
- Claims retrieved from database RPC function `get_claims`

### Permission Checking

The `requirePermissions` function validates:

- Access tokens or API keys
- Required permissions for specific actions
- Company context for multi-tenant access
- Role-based restrictions

## API Authentication

### Access Token Authentication

- Bearer tokens in Authorization header
- Tokens automatically refreshed before expiry
- Used for user session-based requests

### API Key Authentication

- Custom header: `carbon-key: <api-key>`
- Used for server-to-server communication
- Scoped to specific company context
- No user session required

## Security Features

### Rate Limiting

- Magic link requests: 5 per hour per IP
- Implemented using Upstash Redis
- Applied to login endpoints

### Session Security

- HTTP-only cookies prevent XSS
- Secure cookies in production
- SameSite protection
- Domain restrictions

### Token Management

- Automatic refresh before expiry
- Configurable refresh threshold
- Service role tokens for admin operations
- Proper token validation and verification

## Multi-Company Support

Users can belong to multiple companies with different roles:

1. **Company Selection**: Users choose active company context
2. **Permission Isolation**: Permissions are company-specific
3. **Data Isolation**: RLS (Row Level Security) enforces data separation
4. **Context Switching**: Users can switch between companies

## Authentication Routes

### Public Routes

- `/_public+/login` - Login page with magic link and OAuth
- `/_public+/callback` - OAuth callback and token exchange
- `/_public+/logout` - Session destruction
- `/_public+/invite/:code` - Invitation acceptance

### Protected Routes

- All routes under `/x+/` require authentication
- Permission checks applied at route level
- Automatic redirect to login if unauthenticated

## Configuration

Environment variables in `packages/auth/src/config/env.ts`:

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Public anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Admin service role key
- `SESSION_SECRET` - Cookie encryption secret
- `REFRESH_ACCESS_TOKEN_THRESHOLD` - Token refresh timing
- `DOMAIN` - Cookie domain for production

## Onboarding Email System

### Email Templates

1. **WelcomeEmail**: Sent immediately after user creation

- Personal welcome from founder Brad
- Link to Carbon University
- Located at `packages/documents/src/email/WelcomeEmail.tsx`

2. **GetStartedEmail**: Sent 1 minute after welcome email
   - Contains links to specific Carbon University courses
   - Covers basics, company setup, items, quoting, production, purchasing, and API
   - Located at `packages/documents/src/email/GetStartedEmail.tsx`

### Onboarding Task

- Trigger: `onboardTask` in `packages/jobs/trigger/onboard.ts`
- Triggered when:
  - User completes Stripe checkout (`checkout.session.completed` webhook)
  - Company is created during onboarding flow
- Process:
  1. Creates contact in Resend email service
  2. Sends WelcomeEmail
  3. Waits 1 minute
  4. Sends GetStartedEmail
- Only sends emails to users with 1 or fewer company associations

### Company Creation Flow

1. **New Company Creation** (`/onboarding/company`):

   - Creates new company with provided details
   - Seeds company with default data via `seedCompany()`
   - Creates headquarters location
   - Creates employee job record for the user
   - Updates session with new company ID

2. **Existing Company Update**:
   - Updates company and location details if they already exist
