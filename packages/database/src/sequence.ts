// Node-side re-export keeps document-number allocation in one place;
// duplicate implementations silently diverge and mint duplicate sequence IDs.
export {
  getNextRevisionSequence,
  getNextSequence
} from "../supabase/functions/shared/get-next-sequence.ts";
export { getNextSerialNumbers } from "../supabase/functions/shared/get-next-serial-number.ts";
