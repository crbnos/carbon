# SST Deployment and Infrastructure Configuration

## Overview

Carbon uses SST (Serverless Stack) for AWS infrastructure deployment and management. The project is configured to deploy on AWS with containerized applications running on ECS clusters.

## SST Configuration

### Main Configuration File

**Location**: `/sst.config.ts`

The SST configuration deploys Carbon as containerized services on AWS using:
- **App Name**: `carbon`
- **Cloud Provider**: AWS (`home: "aws"`)
- **Region**: Configured via `process.env.AWS_REGION` (typically `us-gov-east-1` for AWS GovCloud)
- **Removal Policy**: `retain` for production, `remove` for other stages

### Infrastructure Components

#### VPC and Cluster
- **VPC**: `CarbonVpc2` - Virtual Private Cloud for the application
- **Cluster**: `CarbonCluster` - ECS cluster running on the VPC with `forceUpgrade: "v2"`

#### Services
1. **CarbonERPService**
   - **Image**: Pulls from ECR: `{AWS_ACCOUNT_ID}.dkr.ecr.us-gov-east-1.amazonaws.com/carbon/erp:latest`
   - **Domain**: `itar.carbon.ms`
   - **Port Mapping**: External port 443/HTTPS → Internal port 3000/HTTP (with 80→443 redirect)
   - **Certificate**: Configured via `process.env.CERT_ARN_ERP`
   - **Scaling**: Min 1, Max 10 tasks, 70% CPU / 80% memory utilization targets

2. **CarbonMESService**
   - **Image**: Pulls from ECR: `{AWS_ACCOUNT_ID}.dkr.ecr.us-gov-east-1.amazonaws.com/carbon/mes:latest`
   - **Domain**: `mes.itar.carbon.ms`
   - **Port Mapping**: External port 443/HTTPS → Internal port 3000/HTTP (with 80→443 redirect)
   - **Certificate**: Configured via `process.env.CERT_ARN_MES`
   - **Scaling**: Min 1, Max 10 tasks, 70% CPU / 80% memory utilization targets

#### Security - Web Application Firewall (WAF)
- **Rate Limiting**: 1000 requests per IP (updated from 200)
- **AWS Managed Rules**: Uses `AWSManagedRulesCommonRuleSet`
- **Scope**: Regional (ALB protection)
- **Metrics**: CloudWatch monitoring enabled
- **Configuration**: WAF ACL created but needs manual association with load balancer

### Environment Variables

Both ERP and MES services receive identical environment variable configurations including:

#### Authentication & Database
- `SUPABASE_*` - Supabase database and auth configuration
- `SESSION_SECRET` - Session management

#### External Services
- `CLOUDFLARE_TURNSTILE_*` - Bot protection
- `EXCHANGE_RATES_API_KEY` - Currency exchange
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
- **Base Image**: `node:20` (not alpine)
- **Build Process**: Multi-stage build with 3 stages (deps, build, production)
- **Port**: 3000 (exposed and used)
- **Build Command**: `npx turbo@1.13.2 run build --filter=./apps/erp`
- **Working Directory**: `/repo/apps/erp`
- **Start Command**: `npm run start`
- **Environment**: `NODE_ENV=production`, `PORT=3000`

### MES Application (`apps/mes/Dockerfile`)
- **Base Image**: `node:20` (not alpine)
- **Build Process**: Multi-stage build with 3 stages (deps, build, production)
- **Port**: 3001 exposed, but ENV PORT=3000 (actual runtime uses 3000)
- **Build Command**: `npx turbo@1.13.2 run build --filter=./apps/mes`
- **Working Directory**: `/repo/apps/mes`
- **Start Command**: `npm run start`
- **Environment**: `NODE_ENV=production`, `PORT=3000`

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

## CI/CD Deployment Process

### GitHub Actions Workflow

**Location**: `.github/workflows/deploy.yml`

The deployment process consists of two jobs:

#### 1. Build Job
- Runs in parallel for both `erp` and `mes` apps (matrix strategy)
- Builds Docker images and pushes to Amazon ECR
- Tags images with both `:latest` and `:{git-sha}`
- Uses Docker BuildKit with GitHub Actions cache
- Platform: `linux/amd64`

#### 2. Deploy Job
- Runs after build job completes
- Installs dependencies in both root and `ci/` workspace
- Executes: `npm run -w ci ci:deploy`
- Runs `/ci/src/deploy.ts` which:
  - Fetches workspace configurations from Supabase
  - Sets up environment variables for each workspace
  - Runs `npx --yes sst deploy --stage prod` for each workspace
  - Skips the `app` workspace slug

### Workspace-Based Deployment

The deployment system supports multi-tenant deployments by:
- Storing workspace configurations in a `workspaces` table in Supabase
- Each workspace has its own AWS account, region, domain, certificates, and service credentials
- The CI deployment script (`ci/src/deploy.ts`) iterates through active workspaces and deploys to each

### Health Checks

**Location**:
- `/apps/erp/app/routes/_public+/health.tsx`
- `/apps/mes/app/routes/_public+/health.tsx`

Both apps have identical health check endpoints at `/health`:

**Features**:
- 5-second timeout protection
- Lightweight database connectivity check (queries `attributeDataType` table with limit 1)
- Returns JSON response with status, timestamp, and response time
- Returns 200 OK on success, 500 on error
- Used by ECS for container health checks

**Recent Changes** (commit `14de78719`):
- Added timeout protection to prevent health checks from hanging
- Changed from selecting all columns to just `id` with `limit(1).single()`
- Added JSON response format with timestamps and response times
- Added auto-scaling configuration to SST services
- Increased WAF rate limit from 200 to 1000 requests per IP

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
- Docker images are built in CI and pushed to ECR, then SST deploys ECS services using those images
- The system supports multi-workspace deployments for different tenants/environments
- Autodesk integration variables are still present in config but the Autodesk code has been removed (see commits `f72d910ed`, `0186a54d2`)