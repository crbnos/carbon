# Billing System in Carbon

## Overview

Carbon implements a comprehensive billing system integrated with Stripe for subscription management. The system supports different product editions, subscription plans, and usage-based pricing.

## Editions

Carbon has three editions defined in `packages/utils/src/types.ts`:

1. **Cloud** - SaaS version with Stripe billing integration
2. **Enterprise** - Self-hosted enterprise version
3. **Community** - Free community version

## Plans

The system supports multiple subscription plans defined in the database:

### Public Plans

- **STARTER** (`price_1RgUYhFV6ecOa0XvD37hQOhK`) - Cloud Starter plan with user-based pricing
- **BUSINESS** (`price_1RjLE1FV6ecOa0Xv0kmTHWPu`) - Cloud Business plan with user-based pricing

### Private Plans (Design Partners)

- **PARTNER-400** (`price_1RgXMSFV6ecOa0XvLQtlhQr0`) - Flat fee pricing
- **PARTNER-300** (`price_1Rj20jFV6ecOa0Xvk4WV6b7l`) - Flat fee pricing
- **PARTNER-500** (`price_1Rj21OFV6ecOa0XvCTdELYdv`) - Flat fee pricing

### Plan Features

Each plan includes:

- `tasksLimit` - Maximum number of tasks (default: 10,000)
- `aiTokensLimit` - Maximum AI tokens (default: 1,000,000)
- `stripeTrialPeriodDays` - Trial period length (default: 7-30 days)
- `userBasedPricing` - Whether pricing is per-user or flat fee

## Database Schema

### Core Tables

**plan** table:

- Stores plan definitions with Stripe price IDs
- Includes limits for tasks, AI tokens, and trial periods
- Supports both user-based and flat fee pricing models

**companyPlan** table:

- Links companies to their active plans
- Stores Stripe customer and subscription IDs
- Tracks subscription status and dates
- Includes usage limits inherited from the plan

**companyUsage** table:

- Tracks actual usage of users, tasks, and AI tokens
- Includes reset date for usage periods
- Used for enforcing plan limits

## Stripe Integration

Located in `/packages/stripe/`, the integration provides:

### Key Features

1. **Customer Management**

   - Automatic customer creation during checkout
   - Customer ID stored in Redis KV store
   - Metadata linking to userId and companyId

2. **Subscription Management**

   - Checkout session creation with multiple payment methods
   - Subscription status syncing via webhooks
   - Automatic quantity updates for user-based pricing

3. **Billing Portal**
   - Self-service subscription management
   - Payment method updates
   - Plan changes and cancellations

### Webhook Events

The system handles various Stripe webhook events:

- `checkout.session.completed` - Triggers onboarding flow
- `customer.subscription.*` - Updates subscription status
- `invoice.*` - Payment processing events

### Environment Variables

- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Webhook signature verification
- `STRIPE_BYPASS_COMPANY_IDS` - Comma-separated list of companies to bypass billing

## Usage Tracking

### User-Based Pricing

For plans with `userBasedPricing = true`:

- Counts active users per company (excluding @carbon.ms emails)
- Automatically updates Stripe subscription quantity
- Triggered when users are added/removed from companies

### Usage Limits

The system tracks:

- Number of active users
- Task usage
- AI token consumption

## Frontend Integration

### Hooks

- `usePlan()` - Returns the current company's plan
- `useEdition()` - Returns the Carbon edition (Cloud/Enterprise/Community)

### Routes

- `/api/webhook/stripe` - Stripe webhook endpoint
- Checkout flow redirects to Stripe hosted checkout
- Billing portal accessible from company settings

## Security Features

1. **Webhook Verification** - Validates Stripe signatures
2. **Idempotency** - Prevents duplicate customer creation
3. **Role-Based Access** - Plans and usage data protected by RLS
4. **Service Role Operations** - Admin operations use service role

## Bypass Mechanism

For development and special cases:

- Companies listed in `STRIPE_BYPASS_COMPANY_IDS` environment variable
- Receive mock "Partner" plan with unlimited usage
- No actual Stripe integration required

## Integration with Authentication

The billing system integrates with the authentication flow:

1. User signs up and selects a plan
2. Redirected to Stripe checkout
3. Upon successful payment, webhook triggers:
   - Company plan creation
   - Onboarding email sequence
   - User activation

This billing system provides a complete solution for SaaS monetization while maintaining flexibility for enterprise and community editions.
