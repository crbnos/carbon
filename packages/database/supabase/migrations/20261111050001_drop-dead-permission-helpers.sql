-- Two functions that read the legacy userPermission keys and nothing calls: no
-- policy, function or app code (a policy using one would make its DROP fail).
-- has_any_company_permission answered "holds this key in any company", which
-- never connected a row to its company (.ai/lessons.md); get_my_permission
-- read the caller's key map. Page permissions read the permission table
-- through util.access_level instead.
-- IF EXISTS: databases that ran this under its first name (20261110113817)
-- have already dropped them.
DROP FUNCTION IF EXISTS public.has_any_company_permission(text);
DROP FUNCTION IF EXISTS public.get_my_permission(text);
