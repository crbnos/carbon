import { z } from "zod";
import { zfd } from "zod-form-data";

export const integration = z.object({
  active: zfd.checkbox(),
});

export const apiKey = z.object({
  apiKey: z.string(),
});

export const exchangeRatesFormValidator = integration;

export const googlePlacesFormValidator = integration.merge(apiKey).refine(
  (data) => {
    if (data.active) {
      return data.apiKey.length > 0;
    }
    return true;
  },
  {
    message: "API key is required when integration is active",
    path: ["apiKey"],
  }
);

export const resendFormValidator = integration
  .merge(apiKey)
  .merge(
    z.object({
      fromEmail: zfd.text(z.string().email().optional()),
    })
  )
  .refine(
    (data) => {
      if (data.active) {
        return data.apiKey.length > 0;
      }
      return true;
    },
    {
      message: "API key is required when integration is active",
      path: ["apiKey"],
    }
  );
