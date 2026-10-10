// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { supportedLanguages } from "@carbon/locale";
import { NotificationTopic } from "@carbon/notifications";
import { z } from "zod";
import { zfd } from "zod-form-data";

// Shared with the MES and the starter, which open the same settings modal.
export {
  type AccountSettingsTab,
  accountProfileValidator,
  accountSettingsTabs,
  isAccountSettingsTab
} from "@carbon/account";

export const notificationPreferenceValidator = z.object({
  topic: z.nativeEnum(NotificationTopic),
  channel: z.enum(["email", "slack"]),
  enabled: z.enum(["true", "false"])
});

// The browser's PushSubscription.toJSON(), plus the endpoint it replaces when
// the service worker re-subscribes after a pushsubscriptionchange.
export const pushSubscriptionValidator = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  oldEndpoint: z.string().url().optional()
});

export const pushSubscriptionEndpointValidator = z.object({
  endpoint: z.string().url()
});

export const onboardingUserValidator = z.object({
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  // about: zfd.text(z.string().optional()),
  next: z.string().min(1, { message: "Next is required" })
});

export const accountLanguageValidator = z.object({
  locale: z.enum(supportedLanguages)
});

export const accountPasswordValidator = z
  .object({
    currentPassword: z
      .string()
      .min(6, { message: "Current password is required" }),
    password: z.string().min(6, { message: "Password is required" }),
    confirmPassword: z
      .string()
      .min(6, { message: "Confirm password is required" })
  })
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        code: "custom",
        message: "The passwords did not match"
      });
    }
  });

export const accountPersonalDataValidator = z.object({});

const attributeDefaults = {
  type: z.string().min(1, { message: "Type is required" }),
  userAttributeId: z.string().min(20),
  userAttributeValueId: zfd.text(z.string().optional())
};

export const attributeBooleanValidator = z.object({
  ...attributeDefaults,
  value: zfd.checkbox()
});

export const attributeNumericValidator = z.object({
  ...attributeDefaults,
  value: zfd.numeric(z.number())
});

export const attributeTextValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(1, { message: "Value is required" })
});

export const attributeUserValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(1, { message: "User is required" })
});

export const attributeCustomerValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(1, { message: "Customer is required" })
});

export const attributeSupplierValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(1, { message: "Supplier is required" })
});

export const attributeFileValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(1, { message: "File is required" })
});

export const deleteUserAttributeValueValidator = z.object({
  userAttributeId: z.string().min(20),
  userAttributeValueId: z.string().min(20)
});
