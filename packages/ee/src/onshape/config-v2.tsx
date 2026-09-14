import { ONSHAPE_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { beginOAuthPopup } from "../oauth-popup";
import { Logo } from "./config";
import { ONSHAPE_V2_INTEGRATION_ID } from "./lib/integration-id";
import {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./panel/plan";
import { DEFAULT_PUSH_DEFAULTS } from "./panel/preferences";

/**
 * The panel integration: push-only, driven from inside Onshape's element right
 * panel. Separate from `onshape` (the pull-shaped original) because it holds
 * its own OAuth grant and writes its own `externalIntegrationMapping`
 * namespace — see `./lib/integration-id`.
 *
 * Connect, disconnect and the push defaults live here. The panel itself has
 * no settings: it shows status and pushes.
 */
export const OnshapeV2 = defineIntegration({
  name: "Onshape V2",
  id: ONSHAPE_V2_INTEGRATION_ID,
  active: !!ONSHAPE_CLIENT_ID,
  category: "CAD",
  logo: Logo,
  description:
    "Onshape is a browser-based CAD/PLM software for modern engineering teams. This integration adds a panel inside Onshape for pushing parts, assemblies and releases into Carbon.",
  shortDescription: "Push CAD data to Carbon from inside Onshape.",
  images: [],
  /*
   * What a push fills in that Onshape has no field for. Everything else a
   * created item carries — part number, name, description, revision, Buy vs
   * Make — comes from Onshape, and is changed there. These are read at plan
   * time by `parsePushDefaults`, which also falls back to DEFAULT_PUSH_DEFAULTS
   * for a value that no longer parses. The generic settings save merges into
   * the stored metadata, so the property map and connection keys survive.
   */
  settingGroups: [
    {
      name: "Push defaults",
      description:
        "Values Carbon gives items it creates from Onshape. Change an individual item on its page in Carbon after the push."
    }
  ],
  settings: [
    {
      name: "defaultReplenishmentSystem",
      label: "Replenishment for designed parts",
      description: "Parts marked purchased in Onshape's BOM are always Buy.",
      group: "Push defaults",
      type: "select",
      listOptions: [...ITEM_REPLENISHMENT_SYSTEMS],
      required: false,
      value: DEFAULT_PUSH_DEFAULTS.replenishmentSystem
    },
    {
      name: "defaultMethodTypeForMake",
      label: "Method for designed parts",
      group: "Push defaults",
      type: "select",
      listOptions: [...ITEM_METHOD_TYPES],
      required: false,
      value: DEFAULT_PUSH_DEFAULTS.methodTypeForMake
    },
    {
      name: "defaultMethodTypeForBuy",
      label: "Method for purchased parts",
      group: "Push defaults",
      type: "select",
      listOptions: [...VALID_METHOD_TYPES_BY_REPLENISHMENT.Buy],
      required: false,
      value: DEFAULT_PUSH_DEFAULTS.methodTypeForBuy
    },
    {
      name: "defaultItemTrackingType",
      label: "Tracking type",
      group: "Push defaults",
      type: "select",
      listOptions: [...ITEM_TRACKING_TYPES],
      required: false,
      value: DEFAULT_PUSH_DEFAULTS.itemTrackingType
    },
    {
      name: "defaultUnitOfMeasureCode",
      label: "Unit of measure",
      description:
        "Leave empty to use EA, or the company's first unit when it has no EA.",
      group: "Push defaults",
      type: "select",
      // Per company: filled from the unit of measure list by the settings
      // route loader.
      listOptions: [],
      required: false,
      value: DEFAULT_PUSH_DEFAULTS.unitOfMeasureCode ?? ""
    }
  ],
  schema: z
    .object({
      defaultReplenishmentSystem: z.enum(ITEM_REPLENISHMENT_SYSTEMS).optional(),
      defaultMethodTypeForMake: z.enum(ITEM_METHOD_TYPES).optional(),
      defaultMethodTypeForBuy: z
        .enum(VALID_METHOD_TYPES_BY_REPLENISHMENT.Buy as [string, ...string[]])
        .optional(),
      defaultItemTrackingType: z.enum(ITEM_TRACKING_TYPES).optional(),
      defaultUnitOfMeasureCode: z.string().optional()
    })
    .superRefine((value, ctx) => {
      // The same rule the Part form applies. Refused here rather than quietly
      // reconciled at plan time, so the saved value is the value pushes use.
      const replenishment =
        value.defaultReplenishmentSystem ??
        DEFAULT_PUSH_DEFAULTS.replenishmentSystem;
      const method =
        value.defaultMethodTypeForMake ??
        DEFAULT_PUSH_DEFAULTS.methodTypeForMake;
      if (
        !VALID_METHOD_TYPES_BY_REPLENISHMENT[replenishment].includes(method)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultMethodTypeForMake"],
          message: `${method} isn't allowed with ${replenishment}`
        });
      }
    }),
  onClientInstall: async () => {
    // Opened here, inside the click, so the browser still holds user
    // activation; the fetch below can take as long as it needs.
    const popup = beginOAuthPopup();
    try {
      const response = await fetch("/api/integrations/onshape-v2/install");
      const body = await response.json();
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? `Carbon answered ${response.status}`);
      }
      popup.navigate(body.url);
    } catch (error) {
      popup.close();
      throw error;
    }
  }
});
