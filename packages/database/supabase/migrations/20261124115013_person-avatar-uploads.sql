-- An employee with users_update may upload, replace and remove the avatar photo
-- of an employee of one of their companies: the rule the "user" UPDATE policy
-- (20260924153817_user-rls-company-scope.sql) applies to that user's avatarUrl,
-- narrowed to employees, the only people the person page edits. A photo sits
-- at the bucket root as "<userId>.<ext>" (no folder, at least one dot), the
-- shape isOwnAvatarUpload (@carbon/utils) accepts. TO authenticated keeps API
-- keys out, as the "own avatars" policies do; those stay as they are.

CREATE POLICY "Employees with users_update can upload company avatars"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
  )
);

CREATE POLICY "Employees with users_update can replace company avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
  )
)
WITH CHECK (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
  )
);

CREATE POLICY "Employees with users_update can remove company avatars"
ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
  )
);
