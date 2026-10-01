// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  ramp: {
    denied: {
      title: msg`Ramp denied the connection`,
      description: msg`The authorization was refused in Ramp. Try connecting again.`
    },
    "invalid-response": {
      title: msg`Ramp didn't return an authorization code`,
      description: msg`The response from Ramp was missing required parameters. Try connecting again.`
    },
    "invalid-state": {
      title: msg`The Ramp connection expired`,
      description: msg`Return to Integrations and connect Ramp again.`
    },
    "token-exchange": {
      title: msg`Ramp rejected the authorization`,
      description: msg`Exchanging the authorization code for access failed. Try connecting again.`
    },
    "save-failed": {
      title: msg`Couldn't save the Ramp connection`,
      description: msg`Ramp authorized the connection but saving it failed. Try connecting again.`
    },
    "role-conflict": {
      title: msg`Another spend integration is already active`,
      description: msg`Only one spend integration can be active at a time. Uninstall the current one first, then connect Ramp.`
    },
    "install-failed": {
      title: msg`Ramp connected but setup didn't finish`,
      description: msg`Open the Ramp integration and try connecting again to finish setup.`
    },
    // Ramp allows exactly ONE connected accounting system, and another one holds
    // it. This is the conflict push-only mode exists for, so the copy names the
    // two real ways out instead of the generic "try again", which cannot work.
    "seat-conflict": {
      title: msg`Another system is connected to Ramp as its accounting system`,
      description: msg`Ramp allows only one. Disconnect the other system in Ramp, or connect Carbon again choosing "Another system posts my ledger".`
    }
  },
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
    "invalid-state": {
      title: msg`The Onshape connection expired`,
      description: msg`Return to Integrations and connect Onshape again.`
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
    },
    "connection-conflict": {
      title: msg`Onshape Government is already connected`,
      description: msg`A company connects to one Onshape at a time. Uninstall Onshape Government, then connect Onshape.`
    }
  },
  // A Government customer's private OAuth app. Same codes as `onshape` — the two
  // share one callback handler — but the fixes live in the customer's own
  // Enterprise settings and in the Carbon integration settings, not in Carbon's
  // environment.
  "onshape-government": {
    "write-permission": {
      title: msg`Onshape Government denied the connection`,
      description: msg`In your Enterprise settings under Developer, edit the private OAuth application's permissions to include "Application can write to your documents", then save the integration settings again.`
    },
    denied: {
      title: msg`Onshape Government denied the connection`,
      description: msg`The authorization was refused in Onshape. Save the integration settings to try again.`
    },
    "invalid-state": {
      title: msg`The Onshape Government connection expired`,
      description: msg`Open the Onshape Government integration and save its settings to connect again.`
    },
    "invalid-response": {
      title: msg`Onshape Government didn't return an authorization code`,
      description: msg`The response from Onshape was missing required parameters. Check the private app's redirect URL, then save the integration settings again.`
    },
    "not-configured": {
      title: msg`Onshape Government isn't configured`,
      description: msg`Enter the Onshape URL, client ID and client secret of your private OAuth application, then save.`
    },
    "token-exchange": {
      title: msg`Onshape Government rejected the authorization`,
      description: msg`Exchanging the authorization code failed. Check the Onshape URL and the client secret, then save the integration settings again.`
    },
    "save-failed": {
      title: msg`Couldn't save the Onshape Government connection`,
      description: msg`Onshape authorized the connection but saving it failed. Save the integration settings to try again.`
    },
    unexpected: {
      title: msg`Couldn't complete the Onshape Government connection`,
      description: msg`An unexpected error occurred while connecting to Onshape. Save the integration settings to try again.`
    },
    "connection-conflict": {
      title: msg`Onshape is already connected`,
      description: msg`A company connects to one Onshape at a time. Uninstall Onshape, then connect Onshape Government.`
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
