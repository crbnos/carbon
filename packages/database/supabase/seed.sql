-- Insert admin user into auth.users table and public.user table
WITH new_auth_user AS (
  INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, 
      email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, 
      recovery_token, recovery_sent_at, email_change_token_new, email_change, 
      email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, 
      is_super_admin, created_at, updated_at, phone, phone_confirmed_at, 
      phone_change, phone_change_token, phone_change_sent_at, 
      email_change_token_current, email_change_confirm_status, banned_until, 
      reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous
  ) VALUES (
      '00000000-0000-0000-0000-000000000000', 
      uuid_generate_v4(), 
      'authenticated', 
      'authenticated', 
      'brad@carbonos.dev', 
      crypt(md5(random()::text), gen_salt('bf')),
      CURRENT_TIMESTAMP, 
      NULL, 
      '', 
      NULL, 
      '', 
      NULL, 
      '', 
      '', 
      NULL, 
      NULL, 
      '{"role": "employee", "provider": "email", "providers": ["email"]}', 
      '{}', 
      NULL, 
      CURRENT_TIMESTAMP, 
      CURRENT_TIMESTAMP, 
      NULL, 
      NULL, 
      '', 
      '', 
      NULL, 
      '', 
      0, 
      NULL, 
      '', 
      NULL, 
      false, 
      NULL, 
      false
  ) RETURNING id
),
new_user_identity AS (
  INSERT INTO auth.identities (
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
  )
  SELECT 
      id,
      id,
      format('{"sub":"%s","email":"%s"}', id, 'brad@carbonos.dev')::jsonb,
      'email',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
  FROM new_auth_user
  RETURNING user_id
)
SELECT user_id FROM new_user_identity;