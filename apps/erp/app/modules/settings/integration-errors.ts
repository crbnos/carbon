import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * An integration's OAuth callback is reached by the provider redirecting the
 * user's browser, so it can't render its own failure. It redirects to the
 * integrations page with `?integration=<id>&error=<code>` instead, and the copy
 * is resolved on that page, where Lingui's runtime lives.
 *
 * Only a code crosses the URL, never the provider's message: a value like OAuth's
 * `error_description` is chosen by whoever crafted the redirect to a public
 * callback, so reflecting it would put attacker-authored text in a Carbon toast.
 * The raw value is logged in the callback instead.
 */
type IntegrationErrorMessage = {
  title: MessageDescriptor;
  description: MessageDescriptor;
};

export const integrationErrors = {
  onshape: {
    // `invalid_scope` means the OAuth application isn't granted a scope we asked
    // for. In practice that's `OAuth2Write`, so name the exact dev-portal
    // permission instead of echoing Onshape's wording, which never says which
    // scope is missing. The quoted label stays English in every locale — it's a
    // literal string in Onshape's UI.
    "write-permission": {
      title: msg`Onshape denied the connection`,
      description: msg`In Onshape, edit this OAuth application's permissions to include "Application can write to your documents", then connect again.`
    },
    denied: {
      title: msg`Onshape denied the connection`,
      description: msg`The authorization was refused in Onshape. Try connecting again.`
    },
    "invalid-response": {
      title: msg`Onshape didn't return an authorization code`,
      description: msg`The response from Onshape was missing required parameters. Try connecting again.`
    },
    "not-configured": {
      title: msg`Onshape isn't configured`,
      description: msg`This Carbon instance is missing its Onshape OAuth credentials. Ask an administrator to set them.`
    },
    "token-exchange": {
      title: msg`Onshape rejected the authorization`,
      description: msg`Exchanging the authorization code for an access token failed. Try connecting again.`
    },
    "save-failed": {
      title: msg`Couldn't save the Onshape connection`,
      description: msg`Onshape authorized the connection but saving it failed. Try connecting again.`
    },
    unexpected: {
      title: msg`Couldn't complete the Onshape connection`,
      description: msg`An unexpected error occurred while connecting to Onshape. Try connecting again.`
    }
  }
} satisfies Record<string, Record<string, IntegrationErrorMessage>>;

export type IntegrationWithErrors = keyof typeof integrationErrors;

export type IntegrationErrorCode<T extends IntegrationWithErrors> =
  keyof (typeof integrationErrors)[T] & string;

/** The query string an OAuth callback redirects to the integrations page with. */
export function integrationErrorSearch<T extends IntegrationWithErrors>(
  integration: T,
  error: IntegrationErrorCode<T>
) {
  return `?integration=${integration}&error=${error}`;
}

/** Resolves those params back to copy. Unknown integration or code → nothing. */
export function getIntegrationError(
  integration: string | null,
  error: string | null
): IntegrationErrorMessage | undefined {
  if (!integration || !error) return undefined;

  const messages =
    integrationErrors[integration as IntegrationWithErrors] ?? undefined;

  return messages?.[error as keyof typeof messages];
}
