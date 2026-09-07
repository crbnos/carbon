import type { FC } from "react";
import type { PieceLogoSlug } from "./pieces";

/** Every Activepieces piece publishes its logo at this CDN path — `logoUrl` is a
 * required field of `createPiece`, and all of them follow
 * `https://cdn.activepieces.com/pieces/<name>.png` — so a card's logo is derived
 * from the name instead of drawn by hand. `PieceLogoSlug` is the set of names
 * verified to exist there; the CDN 404s silently as a broken image, which is why
 * the parameter is not a plain string. */
export function pieceLogo(piece: PieceLogoSlug): FC<{ className?: string }> {
  return function PieceLogo({ className }: { className?: string }) {
    return (
      <img
        src={`https://cdn.activepieces.com/pieces/${piece}.png`}
        alt={piece}
        className={className}
      />
    );
  };
}
