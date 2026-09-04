import type { FC } from "react";

/** Every Activepieces piece publishes its logo at this CDN path — `logoUrl` is a
 * required field of `createPiece`, and all of them follow
 * `https://cdn.activepieces.com/pieces/<name>.png` — so a piece card's logo is
 * derived from the piece name instead of drawn by hand. */
export function pieceLogo(piece: string): FC<{ className?: string }> {
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
