// TEMPORARY — Ramp domain/embed verification.
// Serves the token Ramp checks to verify ownership of this origin while setting
// up the API app. Not a secret; safe to delete once Ramp confirms verification.
export function loader() {
  return new Response(
    "ramp_embed_verification_tok_hzAVDrcDVy531uQrvZnh85uYjutW1-f5mXgsP30XhN8",
    {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    }
  );
}
