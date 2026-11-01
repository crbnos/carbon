// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";
import { defineIntegration } from "../fns";
import type { IntegrationConfig } from "../types";
import { startIntegrationConnect } from "./connect";
import { pieceLogo } from "./piece-logo";
import type { ActivepiecesPiece } from "./pieces";

/** What a piece card says about itself. Everything else is the same for every
 * piece, so it is written once below. */
type PieceCard = Pick<
  IntegrationConfig,
  "name" | "category" | "active" | "shortDescription" | "description"
>;

/**
 * A workflow piece as an ORDINARY integration card. Its `id` IS the piece name,
 * which is what lets the connect route, the uninstall hook and the workflow
 * catalog all address it as one thing. No settings form and no Submit: Install
 * opens the piece's consent popup through the connect route, and the card's
 * Accounts tab manages however many accounts the company connects.
 */
export function definePieceIntegration<const P extends ActivepiecesPiece>(
  piece: P,
  card: PieceCard
) {
  return defineIntegration({
    ...card,
    id: piece,
    logo: pieceLogo(piece),
    images: [],
    settings: [],
    schema: z.object({}),
    onClientInstall: () =>
      startIntegrationConnect(`/api/integrations/connections/${piece}/connect`)
  });
}
