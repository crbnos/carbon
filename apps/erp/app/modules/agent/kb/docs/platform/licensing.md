# Licensing

> Carbon is dual-licensed: AGPLv3 for the open core, a commercial license for Enterprise features and for production or hosted use.

Carbon's source is public, but using it isn't unconditional. Two licenses govern the code, and which one applies depends on **what you run and how you run it**. This page is the map; the [LICENSE](https://github.com/crbnos/carbon/blob/main/LICENSE) file is the contract.

## Editions

| Edition | What it is | License |
| --- | --- | --- |
| **Community** | The open core: ERP + MES, self-hosted on your own infrastructure. | AGPLv3 |
| **Enterprise** | Self-hosted Carbon with a commercial license: unlocks Enterprise features and lifts the AGPL copyleft obligation. | Commercial |
| **Cloud** | Carbon run for you at [app.carbon.ms](https://app.carbon.ms), billed on the Starter and Business plans. | Commercial |

Self-hosting (the `docs/platform/self-hosting/docker-caddy` or the `docs/platform/self-hosting/aws-sst`) runs the **Community** edition by default. A commercial license turns the same hardware into the **Enterprise** edition.

## Open core vs. Enterprise

Most of the repository is the **open core**, licensed under AGPLv3. A defined slice is not.

Everything under `packages/ee` and every file whose name contains `.ee` is Enterprise code. From the LICENSE: *"All content that resides under [...]/packages/ee and all files that contains a `.ee` in this repository require the purchase of a commercial license."*

That slice is the first-party **integrations** (Slack, Jira, Linear, Xero, OnShape, Zapier) plus other Enterprise features: API keys, webhooks, the audit log, customer portals, storage rules, and email notifications. **Email** and **Exchange Rates** are the exceptions: they're available on every edition. See `docs/integrations` for the catalog.

## The AGPL obligation

AGPLv3 is a **network copyleft** license: modify Carbon, make it available to users over a network, and you must offer those users your complete modified source under the same license. Carbon's license goes one step further than stock AGPL.

From the LICENSE: *"any use of this software for internal production use is strictly prohibited unless the modifications are made open-source in accordance with the 'AGPLv3' license or a commercial license is obtained."* Running Carbon in production is fine, but unless you hold a commercial license, your changes have to be published under AGPLv3.

## You can't resell Carbon as a service

From the LICENSE: *"Any use of this software to sell Carbon source code as a hosted service is strictly prohibited without obtaining a commercial license."*

## When you need a commercial license

[Get a commercial license](mailto:chase@carbon.ms), or just use [Carbon Cloud](https://app.carbon.ms), if you want to:

- **Keep your modifications private** instead of publishing them under AGPLv3.
- **Use Enterprise features:** the EE integrations and the capabilities listed above.
- **Run Carbon in production** without open-sourcing your changes.
- **Offer Carbon to others** as a hosted service.

Cloud is the managed path; an Enterprise (commercial) license is the self-hosted path. Either one lifts the copyleft obligation and unlocks the full feature set.

This page summarizes the terms so you can find the right path quickly. The [LICENSE](https://github.com/crbnos/carbon/blob/main/LICENSE) file is what actually governs. Read it in full, and [email us](mailto:chase@carbon.ms) if you're unsure which edition fits.
