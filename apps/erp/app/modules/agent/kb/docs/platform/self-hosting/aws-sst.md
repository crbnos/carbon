# AWS with SST

> Deploy the Carbon stack to your own AWS account with SST: ECS Fargate, ECR, and a WAF.

One of the `docs/platform/self-hosting` recipes: deploy Carbon to **AWS** with **SST**. The two apps, ERP and MES, run as containers on **ECS Fargate** behind load balancers, defined in `sst.config.ts` (app `carbon`, home `aws`). For a single-box setup instead, see `docs/platform/self-hosting/docker-caddy`.

[Carbon Cloud](https://app.carbon.ms) is the hosted edition. We run the whole stack for you, with scaling, backups, upgrades, and uptime handled. Sign up and you're in: no servers to provision, no Supabase to run, no infrastructure to babysit. Self-host only if you specifically need Carbon on your own hardware.

## What gets provisioned

| Resource | Details |
| --- | --- |
| VPC + ECS cluster | `CarbonVpc2` and `CarbonCluster`. |
| `CarbonERPService` | 2 vCPU / 4 GB · port 3000 · health check `/health` · autoscaling 1–10 tasks on CPU and memory. |
| `CarbonMESService` | The same shape, for the MES. |
| WAF web ACL | `AppAlbWebAcl`: a 1000 requests/IP rate-limit rule plus the AWS managed common rule set. |

Container images are pulled from **ECR** (`carbon/erp` and `carbon/mes`), built and pushed by CI. SST does not build them.

## Prerequisites

| Requirement | Details |
| --- | --- |
| AWS account | With `AWS_REGION` and `AWS_ACCOUNT_ID`. |
| ECR images | Pre-built and tagged with `IMAGE_TAG`. |
| TLS certificates | `CERT_ARN_ERP` and `CERT_ARN_MES`; optionally custom domains `URL_ERP` and `URL_MES`. |
| Supabase instance | Provisioned out of band, not by SST. Supplies `SUPABASE_URL`, `SUPABASE_DB_URL`, the keys, and `SUPABASE_JWT_SECRET`. |

The WAF web ACL must be **manually associated** with the application load balancer after the first deploy. SST creates it but does not attach it.

## Deploy

SST drives the deploy from `sst.config.ts`. Run it from the repo root with the `docs/platform/self-hosting/environment-variables` exported.

  
  ### Set the environment

  Export the SST variables (`AWS_REGION`, `AWS_ACCOUNT_ID`, `IMAGE_TAG`, the `CERT_ARN_*`, and any `URL_*`) plus the app config the services read at runtime. The `docs/platform/self-hosting/environment-variables` is provisioned out of band.
  
  
  ### Deploy the stack

  ```bash
  npx sst deploy --stage prod
  ```

  This provisions the VPC, cluster, both Fargate services, and the WAF, pulling the ECR images tagged `IMAGE_TAG`. The `prod` stage retains resources on removal; any other stage removes them.
  
  
  ### Associate the WAF

  Attach `AppAlbWebAcl` to the application load balancer in the AWS console (or with the CLI). SST creates the web ACL but does not attach it.
  

SST does not build the container images. CI builds and pushes `carbon/erp` and `carbon/mes` to ECR; the deploy pulls the tag named by `IMAGE_TAG`.

See `docs/platform/self-hosting/environment-variables` for the full configuration surface, the `docs/platform/self-hosting/docker-caddy` recipe for a single VPS, or `docs/building/local-development` to run Carbon locally with the `crbn` CLI.
