import { z } from "zod";
import { zfd } from "zod-form-data";

export const onboardingUserValidator = z.object({
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  // about: zfd.text(z.string().optional()),
  next: z.string().min(1, { message: "Next is required" }),
});

export const accountProfileValidator = z.object({
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
  about: z.string(),
});

export const accountPasswordValidator = z
  .object({
    currentPassword: z
      .string()
      .min(6, { message: "Current password is required" }),
    password: z.string().min(6, { message: "Password is required" }),
    confirmPassword: z
      .string()
      .min(6, { message: "Confirm password is required" }),
  })
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        code: "custom",
        message: "The passwords did not match",
      });
    }
  });

export const accountPersonalDataValidator = z.object({});

const attributeDefaults = {
  type: z.string().min(1, { message: "Type is required" }),
  userAttributeId: z.string().min(20),
  userAttributeValueId: zfd.text(z.string().optional()),
};

export const attributeBooleanValidator = z.object({
  ...attributeDefaults,
  value: zfd.checkbox(),
});

export const attributeNumericValidator = z.object({
  ...attributeDefaults,
  value: zfd.numeric(z.number()),
});

export const attributeTextValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(1, { message: "Value is required" }),
});

export const attributeUserValidator = z.object({
  ...attributeDefaults,
  value: z.string().min(36, { message: "User is required" }),
});

export const deleteUserAttributeValueValidator = z.object({
  userAttributeId: z.string().min(20),
  userAttributeValueId: z.string().min(20),
});
