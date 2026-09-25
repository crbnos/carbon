# Self-hosting

> Run the whole Carbon stack on your own infrastructure, a single VPS or your own AWS account, instead of Carbon Cloud.

Carbon can run entirely on hardware you control, the ERP and MES apps plus everything they need: the Supabase data plane (Postgres, Auth, REST, Realtime, Storage, Edge Functions), Redis, and Inngest. This is the alternative to [Carbon Cloud](https://app.carbon.ms), where Carbon runs the whole stack for you.

## Recipes

  - Docker with Caddy The whole stack on a single Linux VPS: a single-node Docker Swarm behind an automatic-HTTPS Caddy reverse proxy.
  - AWS with SST The two apps on ECS Fargate, provisioned with SST, for teams that need Carbon inside their own AWS account.

Self-hosted Carbon runs under **AGPLv3**: it's free to run and change, and if you let others use a modified copy over a network, you must offer them its source. A commercial license is required to use Business features (anything in `packages/ee`) or to keep your changes private from the people who use them. See `docs/platform/licensing`.
