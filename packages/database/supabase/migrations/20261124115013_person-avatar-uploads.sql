-- An employee with people_update and users_update in one company may upload,
-- replace and remove the avatar photo of an employee of that company: what
-- updatePersonAvatar (users) requires to save it. users_update alone is the
-- "user" UPDATE policy's rule for avatarUrl (20260924153817_user-rls-company-scope.sql);
-- both are required here so the browser's upload cannot replace the photo file
-- when the save would be refused. A photo sits at the bucket root as
-- "<userId>.<ext>" (no folder, at least one dot), the shape isOwnAvatarUpload
-- (@carbon/utils) accepts. TO authenticated keeps API keys out, as the "own
-- avatars" policies do; those stay as they are.

CREATE POLICY "People and users editors can upload company avatars"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_update'))::text[])
  )
);

CREATE POLICY "People and users editors can replace company avatars"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_update'))::text[])
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
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_update'))::text[])
  )
);

CREATE POLICY "People and users editors can remove company avatars"
ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'avatars'
  AND strpos(name, '/') = 0
  AND strpos(name, '.') > 1
  AND split_part(name, '.', 1) IN (
    SELECT "userId" FROM "userToCompany"
    WHERE "role" = 'employee'
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('users_update'))::text[])
      AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('people_update'))::text[])
  )
);
