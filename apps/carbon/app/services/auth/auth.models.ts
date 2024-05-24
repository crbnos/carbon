import { z } from "zod";

export const loginValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
  password: z.string().min(6, { message: "Password is too short" }),
  redirectTo: z.string(),
});

export const forgotPasswordValidator = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email("Must be a valid email"),
});

export const resetPasswordValidator = z.object({
  password: z.string().min(6, { message: "Password is too short" }),
});

export const callbackValidator = z.object({
  refreshToken: z.string(),
  userId: z.string(),
});
