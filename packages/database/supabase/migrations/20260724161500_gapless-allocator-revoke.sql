-- Gapless Numbering & Legal Series — allocator hardening (readiness finding SD-2)
-- Tracking spec: .ai/specs/2026-07-04-gapless-numbering-legal-series.md
-- Tracking issue: crbnos/carbon#1038
--
-- Follow-up to 20260721162233_gapless-numbering-legal-series.sql. The atomic
-- allocators get_next_sequence_atomic / get_next_legal_series_number are only
-- ever meant to run INSIDE a posting transaction on a service-role/superuser
-- connection (the Kysely edge helper `getNextSequence` and the SQL posters). A
-- SECURITY DEFINER function is granted EXECUTE to PUBLIC by default, which would
-- otherwise expose both as PostgREST RPCs — letting any authenticated client
-- burn an accounting number in its own standalone transaction, the exact gap
-- source SD-2 is closing. Lock them to the owner. Every statement is idempotent.
--
-- NOTE: get_next_sequence itself stays PostgREST-callable (operational sequences
-- — quotes, jobs, POs, fixed assets — allocate through it via client.rpc). Its
-- RAISE guard for the six accounting sequences lands with the coordinated
-- posting-time wave (Decision 15) that moves those six off draft-creation
-- allocation; enabling the guard before those callers move would break them.

REVOKE ALL ON FUNCTION get_next_sequence_atomic(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_next_sequence_atomic(text, text) FROM anon;
REVOKE ALL ON FUNCTION get_next_sequence_atomic(text, text) FROM authenticated;

REVOKE ALL ON FUNCTION get_next_legal_series_number(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_next_legal_series_number(text, text) FROM anon;
REVOKE ALL ON FUNCTION get_next_legal_series_number(text, text) FROM authenticated;
