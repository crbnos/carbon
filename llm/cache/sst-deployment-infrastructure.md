# SST Deployment and Infrastructure Configuration

## Overview

Carbon uses SST (Serverless Stack) for AWS infrastructure deployment and management. The project is configured to deploy on AWS with containerized applications running on ECS clusters.

## SST Configuration

### Main Configuration File

**Location**: `/sst.config.ts`

The SST configuration deploys Carbon as containerized services on AWS using:
- **App Name**: `carbon`
- **Cloud Provider**: AWS (`home: "aws"`)
- **Region**: `us-gov-east-1` (AWS GovCloud)
- **Removal Policy**: `retain` for production, `remove` for other stages

### Infrastructure Components

#### VPC and Cluster
- **VPC**: `CarbonVpc` - Virtual Private Cloud for the application
- **Cluster**: `CarbonCluster` - ECS cluster running on the VPC

#### Services
1. **CarbonERPService**
   - **Port Mapping**: External port 80 → Internal port 3000
   - **Dockerfile**: `apps/erp/Dockerfile`
   - **Context**: Root directory (`./`)

2. **CarbonMESService**
   - **Port Mapping**: External port 80 → Internal port 3001
   - **Dockerfile**: `apps/mes/Dockerfile`
   - **Context**: Root directory (`./`)

#### Security - Web Application Firewall (WAF)
- **Rate Limiting**: 200 requests per IP
- **AWS Managed Rules**: Uses `AWSManagedRulesCommonRuleSet`
- **Scope**: Regional (ALB protection)
- **Metrics**: CloudWatch monitoring enabled

### Environment Variables

Both ERP and MES services receive identical environment variable configurations including:

#### Authentication & Database
- `SUPABASE_*` - Supabase database and auth configuration
- `SESSION_SECRET` - Session management

#### External Services
- `AUTODESK_*` - CAD integration
- `CLOUDFLARE_TURNSTILE_*` - Bot protection
- `EXCHANGE_RATES_API_KEY` - Currency exchange
- `NOVU_*` - Notifications
- `OPENAI_API_KEY` - AI features
- `POSTHOG_*` - Analytics
- `RESEND_API_KEY` - Email service
- `SLACK_*` - Slack integration
- `STRIPE_*` - Payment processing
- `TRIGGER_*` - Job queue (Trigger.dev)
- `UPSTASH_REDIS_*` - Redis KV store

#### Configuration
- `CARBON_EDITION` - Product edition
- `CONTROLLED_ENVIRONMENT` - Environment type
- `DOMAIN` - Application domain
- `VERCEL_*` - Vercel deployment context

## Container Configuration

### ERP Application (`apps/erp/Dockerfile`)
- **Base Image**: `node:20-alpine`
- **Build Process**: Multi-stage build
- **Port**: 3000
- **Build Command**: `npx turbo run build --filter=./apps/erp`

### MES Application (`apps/mes/Dockerfile`)
- **Base Image**: `node:20-alpine`
- **Build Process**: Multi-stage build
- **Port**: 3001 (note: Dockerfile shows 3001 expose but ENV shows 3000)
- **Build Command**: `npx turbo run build --filter=./apps/mes`

## Generated Files

SST generates type definition files (`sst-env.d.ts`) in each app and package directory for type safety when accessing SST resources.

**Example Resource Types**:
```typescript
declare module "sst" {
  export interface Resource {
    "ERPApi": {
      "type": "sst.aws.ApiGatewayV2"
      "url": string
    }
  }
}
```

## Dependencies

- **SST Version**: `3.17.14` (listed in root `package.json`)
- **Deployment Scripts**: `turbo run deploy` command available

## Current Branch Status

The project is currently on branch `feat/sst-cluster` which suggests active development of the SST cluster infrastructure.

## Deploy Command

The project includes a `deploy` script that uses Turbo to run deployments:
```bash
npm run deploy  # Runs turbo run deploy
```

## Notes

- The deployment targets AWS GovCloud (us-gov-east-1), indicating potential government/federal compliance requirements
- Both applications share the same environment variables, suggesting a shared configuration approach
- WAF protection is configured with rate limiting and AWS managed security rules
- The infrastructure uses container-based deployment rather than serverless functions