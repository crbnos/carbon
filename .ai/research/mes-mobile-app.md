# MES Mobile App Research: Best Practices Survey

## Summary

Surveyed how ERP and MES vendors put shop-floor operator execution on phones,
tablets and rugged handhelds, and whether Expo + a Tailwind-for-React-Native
library + React Native Reusables is a sound stack for Carbon's small team.
Covered: SAP (Digital Manufacturing, S/4HANA Fiori, SAP Service and Asset
Manager), MES point solutions (Tulip, First Resonance ION, Manufacturo, Fulcrum,
ProShop) and manufacturing ERPs (Odoo, Katana, MRPeasy, Epicor Kinetic, Plex).

Five findings drive the design:

- **Browser-first is the norm for operator screens; native is the exception.**
  SAP's operator dashboard, ION, Fulcrum, ProShop and Katana all run in the
  browser. Native apps come from vendors that need hardware access or one-time
  device registration: Tulip Player, Plex Mobile, SAP Service and Asset Manager,
  and Epicor's partner handheld app.
- **Shared tablets are the dominant device model.** The device is registered
  once, then operators identify themselves quickly by badge, PIN or QR code, and
  labor is attributed to that operator. Seen at Tulip, SAP, Odoo, Fulcrum and
  Katana.
- **Nobody offers offline writes for production execution.** Tulip says so
  outright. Odoo's offline mode is read-only. SAP's offline store exists only
  in its field-service app, and SAP's production execution relies on a
  plant-side edge server instead.
- **Scanning means keyboard-wedge scanners first, camera second.** Label printing
  from the device is weak everywhere and is done server-side or through a relay.
- **Native clients sit behind a mobile-specific backend layer at SAP** (BTP
  Mobile Services in front of the ERP). Fiori web apps call the ERP's OData
  directly.

## Competitors Surveyed

- **SAP S/4HANA + Digital Manufacturing** — the enterprise reference for
  operator execution (Production Operator Dashboard), and for how SAP builds
  native offline apps (Service and Asset Manager on the Mobile Development Kit).
- **Tulip** — the only MES in the survey with native store apps (Tulip Player)
  on iOS, iPadOS and Android.
- **First Resonance ION** — modern hardware-manufacturing MES; browser only,
  QR-to-step flow; its own UI uses its public GraphQL API.
- **Manufacturo** — MES for regulated discrete manufacturing; tablet-driven
  inventory and shop-floor steps.
- **Fulcrum, ProShop** — job-shop ERP/MES with browser shop-floor terminals.
- **Odoo** — Shop Floor module, installable as a PWA, plus an Enterprise store
  wrapper.
- **Katana, MRPeasy** — SMB manufacturing ERPs with shop-floor apps.
- **Epicor Kinetic** — browser MES plus a partner-built native handheld app.
- **Plex (Rockwell)** — native Plex Mobile for iOS and Android with a published
  device support policy.

## Key Consensus Patterns

### 1. Register the device once, then operators switch quickly

- **SAP**: Digital Manufacturing's Badge Access asked for a badge (RFID, barcode
  or typed) on a POD page so shared logins and terminals could be used; labor
  on/off could key on badge numbers. It is deprecated as of 2508 (supported until
  2611); the replacement was not found.
- **Tulip**: the device is registered once against an instance URL and becomes an
  Interface tied to a Station; operators then sign in by badge ID, RFID or
  credentials, with auto-logout on inactivity.
- **Odoo**: the signed-in user is an operator; others are added with "Edit
  Operators" and an optional numeric PIN. Many can be signed in, one is active,
  and time books to the active one.
- **Fulcrum**: Job Tracking uses a PIN login, which can be replaced by email and
  password plus MFA.
- **Katana**: each operator scans their QR code and types a 6-digit code; for
  shared devices the QR code stays printed at the workstation.
- **Rationale**: shop-floor devices are shared and gloved hands can't type
  passwords, but every labor minute and quantity must still belong to a person.

### 2. Online-first; no offline writes for production

- **SAP**: Service and Asset Manager has a full offline store (an on-device store
  plus an ordered request queue, ETag conflict detection, an ErrorArchive for
  failed requests). Production execution does not: resilience comes from an
  edge server in the plant that rides out "a few hours" of cloud outage.
- **Tulip**: no offline. Staff called it a year-plus effort and suggested WiFi
  extenders. Its docs warn that an unstable network makes the trigger queue drop
  events permanently.
- **Odoo**: offline mode is read-only, limited to views opened earlier.
- **Rationale**: several stations write to the same job at once; replaying
  stale writes later corrupts quantities and time.

### 3. Keyboard-wedge scanning, camera as fallback

- **SAP**: the operator dashboard offers a camera preview plus a manual field
  that also accepts scanner input. SAP's native Android SDK supports Zebra and
  Honeywell built-in scanners through the DataWedge intent API, and Bluetooth
  scanners in keyboard mode only.
- **Tulip / Odoo / ION / Katana web**: USB or Bluetooth scanners acting as
  keyboards that send Enter; Zebra devices set to DataWedge keystroke output.
  Camera scanning in Tulip, Katana's shop-floor app and MRPeasy.
- **Rationale**: keyboard mode works on every device with no native code;
  rugged-device intents are an optimisation.

### 4. Printing happens on the server, not the device

- **SAP**: Digital Manufacturing manages printers and print queues and prints
  server-side; no source found for printing from the device.
- **Tulip**: the Zebra network printer driver is Windows-only, so iPads need an
  edge device or a nearby Windows player.
- **ION**: Zebra Browser Print (a desktop app) or PrintNode relaying through a
  computer.
- **Rationale**: mobile OSes make raw network or Bluetooth printing hard; a
  server or relay already knows the printers.

### 5. The operator action set is consistent

Start, pause and finish an operation with setup/labor/machine time; report
good, scrap and rework quantities; consume or issue material by scan; follow
work instructions; record data and photos; raise a quality issue; clock in and
out. Seen at SAP (yield/scrap/activity confirmations, goods issue, data
collection, NCs), Odoo, Fulcrum, Katana, Epicor's handheld app and Plex.

### 6. Native clients use a mobile backend or the vendor's public API

- **SAP**: native apps go device → BTP Mobile Services (onboarding, auth, app
  lifecycle, offline sync) → Cloud Connector → Gateway OData. Posting from
  Digital Manufacturing to the ERP uses a *sequential* queue for quantity
  confirmations because order matters.
- **ION**: its own clients use the same public GraphQL API.
- **Epicor partner app**: calls Kinetic's REST API and recommends extending the
  token lifetime to 10 hours (a shift).
- **Rationale**: a dedicated layer owns auth, versioning and ordering so the
  ERP core does not have to know about devices.

## Answers to Research Questions

1. **Native app or web?** — Mostly web. Native where hardware access, device
   registration or store distribution matter: Tulip, Plex, SAP Service and
   Asset Manager, Epicor's partner app (native Android). Odoo and MRPeasy ship
   store wrappers around the web client.
2. **Operator identity on shared devices?** — Device registered once, then badge,
   PIN or QR plus code per operator (SAP, Tulip, Odoo, Fulcrum, Katana).
3. **Offline?** — Not for production writes anywhere. SAP's offline store is
   field-service only; Odoo offline is read-only; Tulip has none.
4. **Which operator actions?** — Pattern 5 above.
5. **Hardware?** — Keyboard-wedge scanners plus camera. Printing server-side.
   Bluetooth gauges on mobile: not found for any vendor (Tulip's caliper driver
   is Windows-only).
6. **API architecture?** — SAP puts a mobile backend in front of the ERP and
   orders quantity confirmations; ION and Epicor's partner app use public APIs.
   No vendor documents client-side idempotency keys; SAP relies on ETags and an
   ordered queue.
7. **Distribution?** — Public App Store and Google Play (Tulip, Plex, SAP,
   Odoo, MRPeasy, Epicor partner app). Server URL typed at first launch (Epicor
   partner app, Tulip instance URL; a QR code can carry it). No MDM guidance
   found for any manufacturing vendor.
8. **Is Expo + NativeWind + React Native Reusables sound for Carbon?** — Expo
   yes. NativeWind's stable release only supports Tailwind v3, and Carbon web is
   on Tailwind 4.3; Uniwind supports Tailwind v4 today and is supported by React
   Native Reusables. See the technology section.

## Competitor-Specific Details

### SAP
- The Production Operator Dashboard is a browser (SAPUI5) app that supports
  touch and mobile screens. Each POD has its own URL; operators bookmark it or
  scan a QR code, and URL parameters preset the machine.
- Fiori "Confirm Production Operations" is a responsive web app.
- SAP Mobile Start is SAP's native entry point (iOS 2021, Android 2022),
  rolled out by QR code or MDM.
- Terminology: confirmation (partial/final), yield, scrap, rework, activity
  confirmation, backflush, goods issue/receipt, labor on/off, clock in/out,
  badge, nonconformance, disposition.

### Tulip
- Tulip Player on iPhone, iPad, Apple Silicon Mac (iOS 15.1+, SAML login) and
  Android phones and tablets. The native app is recommended over the web
  player for hardware access and one-time admin authentication.
- In GxP mode a logout cancels the running app without saving; on iOS,
  backgrounding the app counts as closing it.

### Odoo
- Shop Floor replaced the tablet view in 16.4. Store apps do not support SSO.
- Public XML-RPC/JSON-RPC APIs are removed in Odoo 22 in favour of JSON-2 with
  bearer API keys.

### Katana
- "Not a native Android or iOS app"; tablets recommended, phones supported,
  every device needs a camera. One session per account.

### Epicor Kinetic
- Browser MES; the native handheld app (Epicor Kinetic Warehouse, by BISCIT)
  runs on Honeywell and Zebra Android devices. A device licence key, then
  Epicor or Azure AD login; a QR code can carry the username and server URL.

### Plex
- Plex Mobile on iOS and Android since 2018, organised into "applets". Its
  support policy lists tested rugged devices (Honeywell CT60/CK65, Zebra
  MC3400/TC52X and others) and supported OS ranges (Android 11–14, iOS 15–17).

## Technology Findings (checked 24–26 Sep 2026)

- **Expo SDK 57** (stable 30 Jun 2026): React Native 0.86, React 19.2. The New
  Architecture is mandatory. Expo Router is the default for new apps.
- **Expo monorepos**: Metro configures itself for monorepos (SDK 52+); pnpm
  isolated installs are supported from SDK 54. "Duplicate React Native
  versions in a single monorepo are not supported" and "Duplicate React version
  in a single app will cause runtime errors". Different React versions in
  different apps are not forbidden.
- **NativeWind**: stable 4.2.7 supports Tailwind v3 only; v5 (Tailwind v4) is
  a release candidate its docs call "not intended for production use".
  Documented v4 performance issues: a ~4× slowdown against StyleSheet in a
  1,000-view benchmark, a 4 MB interop cache costing ~250 ms at startup, and a
  memory leak around CSS variables.
- **Uniwind** (from the Unistyles team): Tailwind v4, MIT core, releases
  roughly every two weeks (1.12.0 on 4 Sep 2026). A paid Pro tier adds a C++
  engine; not needed.
- **React Native Reusables**: a shadcn/ui port on `@rn-primitives`, copied into
  the consuming repo. 31 components; no data table, toast, date picker,
  combobox or sheet (the repo points to community libraries). Uniwind supported
  since Dec 2025. Effectively one maintainer (1,114 commits vs 17 for the next
  contributor).
- **Gluestack UI v5** (stable July 2026): the closest alternative to React Native
  Reusables, with more components, supporting both NativeWind v5 and Uniwind.
- **Supabase on Expo**: the official guide persists the session with an
  encrypted SecureStore wrapper (SecureStore caps values at 2 KB); PKCE flow
  for deep-link sign-in.
- **Hardware**: `expo-camera` scans 13 barcode formats. Zebra's own DataWedge
  React Native library has been archived since 2021, so intent-mode scanning
  needs a custom Expo module; keystroke mode needs none.

## Recommended Approach for Carbon

1. **Native app, tablet-first, phone supported** — following Tulip and Plex:
   native is justified by hardware access (camera, keep-awake, later DataWedge
   intents), device registration and store distribution.
2. **Shared-tablet mode in v1, not later** — every surveyed vendor with a
   shop-floor app supports quick operator switching on a shared device (Pattern
   1). Carbon already has this on web (console mode), so the mobile app should
   ship it, using a server-verified operator identity rather than a cookie.
3. **Online-first with a short ordered outbox** — nobody offers offline
   production writes (Pattern 2). An outbox for brief Wi-Fi drops, sent in
   order per operation (the SAP sequential-queue idea), with server-side
   duplicate protection, is the most any vendor does.
4. **Keyboard-wedge scanning plus camera; printing through the existing
   server path** — Patterns 3 and 4. No native printer code in v1.
5. **A dedicated MES API in front of the backend** — the SAP pattern for native
   clients (Pattern 6), and in Carbon the MES write logic already lives in
   server code that a device cannot call.
6. **Store distribution with a server address at first launch** — the Epicor
   partner app and Tulip pattern; supports Carbon Cloud and self-hosted installs
   from one build.
7. **Uniwind rather than NativeWind** — same Tailwind version as Carbon web.

## Sources

SAP
- https://help.sap.com/docs/sap-digital-manufacturing/execution/production-operator-dashboard-pod
- https://learning.sap.com/courses/exploring-customization-in-sap-digital-manufacturing/providing-pods-to-operators
- https://help.sap.com/doc/saphelp_ssb/1.0/en-US/df/ec39520c3b6160e10000000a423f68/content.htm?no_cache=true
- https://community.sap.com/t5/technology-blog-posts-by-members/sap-mobile-start-the-new-native-entry-point-to-access-applications-contents/ba-p/13514662
- https://learning.sap.com/courses/implementing-sap-service-and-asset-manager/explaining-sap-service-and-asset-manager-features
- https://developers.sap.com/tutorials/cp-mobile-dev-kit-build-client.html
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-sap/enable-faster-user-changes-and-shared-terminals-using-badges-in-sap-digital/ba-p/13789397
- https://community.sap.com/t5/supply-chain-management-blog-posts-by-sap/clock-in-out-and-labor-on-off-with-sap-digital-manufacturing/ba-p/13561374
- https://help.sap.com/doc/13c9f83611f94a5ab2c94f23cacfc217/latest/en-US/SAP_DMC_FSD_enUS.pdf
- https://help.sap.com/doc/f53c64b93e5140918d676b927a3cd65b/Cloud/en-US/docs-en/guides/features/offline/overview.html
- https://help.sap.com/doc/f53c64b93e5140918d676b927a3cd65b/Cloud/en-US/docs-en/guides/features/offline/common/handling-errors-and-conflicts/offline-errors-troubleshooting.html
- https://help.sap.com/docs/sap-digital-manufacturing/setup-and-operations-guide-for-sap-digital-manufacturing-for-edge-computing/basic-concepts-426b451ca7574eb895ea86d93437005d
- https://help.sap.com/doc/f53c64b93e5140918d676b927a3cd65b/Cloud/en-US/docs-en/guides/features/fiori-ui/android/qrcode-view.html
- https://learning.sap.com/courses/implementing-sap-service-and-asset-manager/explaining-the-mobile-application-integration-framework-maif-
- https://help.sap.com/doc/f6b2ab2222794bebad4c0dcd33138e71/latest/en-US/SAP_DMC_Integration_Guide_enUS.pdf

MES point solutions
- https://apps.apple.com/us/app/tulip-player/id1634675541
- https://play.google.com/store/apps/details?id=co.tulip.player
- https://support.tulip.co/docs/tulip-player-overview
- https://support.tulip.co/docs/player-logout-behavior
- https://community.tulip.co/t/offline-apps-connectivity/403
- https://support.tulip.co/docs/tulip-cloud-deployment-networking-requirements
- https://support.tulip.co/docs/set-up-a-barcode-scanner
- https://community.tulip.co/t/support-for-zebra-network-printer-driver-on-ios/9465
- https://manual.firstresonance.io/features/runs/run-execution-overview
- https://manual.firstresonance.io/features/runs/time-tracking
- https://manual.firstresonance.io/features/barcode-labels/scanning
- https://manual.firstresonance.io/features/barcode-labels/printing/configuring-printing-in-ion
- https://manual.firstresonance.io/api/about-graphql
- https://manufacturo.com/manufacturo-manufacturing-management-software/inventory-management/
- https://manufacturo.com/integration/
- https://fulcrumpro.com/manufacturing-software/job-tracking
- https://fulcrumpro.com/article/best-hardware-choices-for-fulcrum-on-the-shop-floor
- https://fulcrumpro.com/product-update/log-in-to-job-tracking-without-a-pin
- https://get.proshoperp.com/

Manufacturing ERPs
- https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_overview.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_tracking.html
- https://www.odoo.com/documentation/19.0/applications/general/offline_mode.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/setup/hardware.html
- https://www.odoo.com/documentation/17.0/administration/mobile.html
- https://www.odoo.com/documentation/19.0/developer/reference/external_api.html
- https://support.katanamrp.com/en/articles/5967150-recommended-devices-for-the-shop-floor-control-app
- https://support.katanamrp.com/en/articles/5967433-how-to-log-into-a-shop-floor-operator-account
- https://support.katanamrp.com/en/articles/5966964-barcode-scanning-hardware
- https://www.mrpeasy.com/resources/user-manual/reporting/internet-kiosk/
- https://apps.apple.com/us/app/mrpeasy/id1179387308
- https://www.epicor.com/en-us/products/enterprise-resource-planning-erp/kinetic/supply-chain-management/ptw-warehouse/
- https://docs.biscit.com/epicor-kinetic-warehouse/epicor-kinetic-warehouse-user-guide/login.md
- https://docs.biscit.com/epicor-kinetic-warehouse/epicor-kinetic-warehouse-installation-guide/ekw-installation-guide.md
- https://apps.apple.com/us/app/plex-mobile/id1410847591
- https://plex.rockwellautomation.com/content/dam/plex/documents/pdf/plex-mobile-support-policy-v4-2025-1.pdf

Technology
- https://expo.dev/changelog/sdk-57
- https://docs.expo.dev/guides/monorepos/
- https://docs.expo.dev/guides/dom-components/
- https://www.nativewind.dev/v5
- https://github.com/nativewind/nativewind/discussions/642
- https://github.com/nativewind/nativewind/issues/1071
- https://docs.uniwind.dev/
- https://github.com/founded-labs/react-native-reusables
- https://github.com/gluestack/gluestack-ui/discussions/3366
- https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native
- https://docs.expo.dev/versions/latest/sdk/camera/
- https://developer.zebra.com/blog/integrating-datawedge-your-expo-application

## Not Verified

- What replaces SAP Digital Manufacturing Badge Access after 2611.
- Operator identity at ProShop, Manufacturo and Plex (Plex docs are behind a
  login).
- Offline write queues or client idempotency keys at any vendor other than
  SAP's field-service app.
- Whether MRPeasy's store app is a web wrapper (inferred from a 478 KB iOS
  build and its listing wording).
