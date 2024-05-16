-- Add GIN index to userPermissions table
CREATE INDEX idx_user_permissions_gin 
  ON "userPermission" USING gin (permissions);