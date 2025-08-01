import { z } from "zod";
import { zfd } from "zod-form-data";

export const loginValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  redirectTo: z.string(),
});

export const emailAndPasswordValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  password: z.string().min(6, { message: "Password is too short" }),
});

export const forgotPasswordValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
});

export const magicLinkValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  redirectTo: zfd.text(z.string().optional()),
  turnstileToken: zfd.text(z.string().optional()),
});

export const resetPasswordValidator = z.object({
  password: z.string().min(6, { message: "Password is too short" }),
});

export const callbackValidator = z.object({
  refreshToken: z.string(),
  userId: z.string(),
});

export const selfSignupValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  firstName: z.string().min(1, { message: "First name is required" }),
  lastName: z.string().min(1, { message: "Last name is required" }),
});

export const verifySignupValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  verificationCode: z
    .string()
    .min(1, { message: "Verification code is required" })
    .length(6, { message: "Verification code must be 6 characters" }),
});
