// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// The flash shares the session cookie, so a long list of parts would make the
// cookie too large to set: name the first few and count the rest.
const NAMED_PARTS = 5;

function shortfall(row: {
  part: string;
  unit: string | null;
  onHand: number | null;
  held: number | null;
}) {
  if (row.onHand === null || row.held === null) return row;
  const place = row.unit ? `${row.unit}: ` : "";
  return {
    part: row.part,
    unit: `${place}${row.onHand} there, ${row.held} held`
  };
}

function partList(rows: Array<{ part: string; unit: string | null }>) {
  const names = rows.map((row) =>
    row.unit ? `${row.part} (${row.unit})` : row.part
  );
  const shown = names.slice(0, NAMED_PARTS).join(", ");
  const more = names.length - NAMED_PARTS;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

// Post (Pending -> Posted): the variances become inventory adjustments.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.postInventoryCount({
    inventoryCountId: id
  });
  // An error is toasted by the Post button's fetcher.
  if (!result.data) return result;
  // Lines that cannot post: the page toasts the reason and marks them.
  if ("invalidLineIds" in result.data) return result.data;
  const warnings = result.data.heldStockWarnings ?? [];
  const awaiting = warnings.filter((row) => row.awaitingInspection);
  const short = warnings.filter(
    (row) => !row.awaitingInspection && row.countedShort
  );
  const movable = warnings.filter(
    (row) => !row.awaitingInspection && !row.countedShort
  );
  const message = ["Inventory count posted."];
  if (short.length > 0) {
    message.push(
      `${partList(short.map(shortfall))} ${short.length === 1 ? "was" : "were"} counted short in ${short.length === 1 ? "its" : "their"} inspection unit: its inspection lots hold more than is there. A Reject or an NCR's Scrap writes off only what is there.`
    );
  }
  if (movable.length > 0) {
    message.push(
      `Stock held for inspection was counted outside its inspection unit: ${partList(movable)}. Move it back.`
    );
  }
  if (awaiting.length > 0) {
    message.push(
      `Units under inspection were counted outside their inspection unit: ${partList(awaiting)}. Quality must decide their inspection lots before they can move.`
    );
  }
  return respond(args.request, result).redirect(path.to.inventoryCount(id), {
    message: warnings.length > 0 ? message.join(" ") : "Inventory count posted"
  });
}
