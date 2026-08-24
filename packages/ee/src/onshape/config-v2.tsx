import { ONSHAPE_CLIENT_ID } from "@carbon/auth";
import { defineIntegration } from "../fns";
import { Logo } from "./config";
import { ONSHAPE_V2_INTEGRATION_ID } from "./lib/ids";
import { onshapeV2SettingsSchema } from "./lib/settings-v2";

// Onshape v2 — a SEPARATE integration record from `onshape`, not a mode inside
// it. The two share the Onshape OAuth application (one client id, one redirect
// URL, one entry in Onshape's dev portal) and this package's protocol client.
// Everything else is its own: settings, grant, vault secret bag, webhook
// subscription and callback path, API routes and jobs.
//
// Exactly one of the two may be active for a company. Both would subscribe to
// `onshape.revision.created` on the same Onshape tenant, so every released
// element would arrive twice — two change notices for one release, and double
// the export quota. That is refused at every activation point rather than
// policed after the fact.
//
// The settings below carry no `visibleWhen`: with the pipeline selector gone
// there is nothing to gate them on, and a v2 company sees exactly the v2
// settings.
export const OnshapeV2 = defineIntegration({
  name: "Onshape v2",
  id: ONSHAPE_V2_INTEGRATION_ID,
  active: !!ONSHAPE_CLIENT_ID,
  category: "CAD",
  logo: Logo,
  description:
    "The rebuilt Onshape integration. Create Carbon parts directly from an Onshape selection, import BOMs together with their CAD models and drawings, and keep the two systems joined by a stable element id instead of a typed part number.",
  shortDescription: "Build Carbon items from Onshape, joined by id.",
  images: [],
  settings: [
    {
      name: "attachAssetsOnRelease",
      label: "Attach assets when a revision is released",
      description:
        "Pull the 3D model and drawing PDF onto the linked Carbon item whenever Onshape releases a revision. This covers releases that happen without anyone in Carbon; importing a BOM or creating an item from Onshape always brings its assets regardless of this setting.",
      type: "switch",
      required: false,
      value: true
    },
    {
      name: "releaseImportV2",
      label: "When a revision is released",
      // One field with an "off" option rather than a switch plus a nested mode.
      description:
        "What Carbon does with the engineering data in an Onshape release, beyond attaching its files.",
      type: "options",
      listOptions: [
        {
          value: "off",
          label: "Do nothing",
          description:
            "Ignore the release. Assets are still attached if the setting above is on."
        },
        {
          value: "changeNotice",
          label: "Create a change notice",
          description:
            "One Draft change notice per Onshape release, pre-populated with an affected item per released part, for a human to review and release."
        },
        {
          value: "revision",
          label: "Create the revision directly",
          description:
            "Create the new revision immediately, copying the previous revision's attributes and BOM. No review step."
        }
      ],
      required: false,
      value: "changeNotice"
    },
    {
      name: "allowUnreleasedSync",
      label: "Allow syncing unreleased versions",
      description:
        "Onshape stamps a revision only on release. An unreleased version therefore lands on Carbon's initial revision and carries no assets. Off by default so the version picker offers only released versions.",
      type: "switch",
      required: false,
      value: false
    },
    {
      name: "createItemsOnRelease",
      label: "Create the part when a release names one Carbon does not have",
      description:
        "Off by default: a released element with no linked Carbon part is refused, and someone links it or imports its assembly. Turned on, Carbon creates the part instead — but a release carries geometry, not structure, so Carbon has to GUESS the fields Onshape says nothing about. An assembly is created as Make / Make to Order, a part studio body as Buy / Pull from Inventory, tracked in Inventory and measured in EA. Every creation is reported so you can correct it.",
      type: "switch",
      required: false,
      value: false
    },
    {
      name: "webhookSigningSecret",
      label: "Webhook signing secret",
      description:
        "Leave blank to accept unsigned webhooks. Onshape's signing keys are company-level rather than per-webhook, so rotating one affects every consumer of that Onshape company. The key is encrypted at rest and never shown again — leave this blank on a later save to keep the stored one.",
      // Deliberately "text", not "password"/"secret". Both masked types render a
      // <Password> input, nothing in IntegrationForm sets autoComplete, and a
      // browser password manager was observed autofilling a saved password into
      // this field — which would then make the receiver reject every genuine
      // Onshape delivery. Masking buys nothing now that the value is vaulted and
      // never sent to the browser; a silently wrong value costs ingestion.
      type: "text",
      required: false,
      value: ""
    }
  ],
  schema: onshapeV2SettingsSchema,
  onClientInstall: async () => {
    // Same OAuth application as the legacy record, so the same install route —
    // it signs the target integration id into the OAuth `state`, and the shared
    // callback dispatches on it.
    const response = await fetch(
      `/api/integrations/onshape/install?integration=${ONSHAPE_V2_INTEGRATION_ID}`
    ).then((res) => res.json());

    const { url, error } = response;

    if (!url) {
      // The install route refuses when the counterpart is already connected, so
      // the popup is never opened on a conflict and no Onshape grant is spent.
      window.location.href = `/x/settings/integrations?integration=${ONSHAPE_V2_INTEGRATION_ID}&error=${error ?? "not-configured"}`;
      return;
    }

    const width = 600;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2.5;

    const popup = window.open(
      url,
      "",
      `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
    );

    if (!popup) {
      window.location.href = url;
      return;
    }

    const listener = (e: MessageEvent) => {
      if (e.data === "app_oauth_completed") {
        window.location.reload();
        window.removeEventListener("message", listener);
        popup.close();
      }
    };

    window.addEventListener("message", listener);
  }
});
