
-- Insert admin user into auth.users table
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
    '82fd05db-270d-46af-b29e-082e9f709b1f', 
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
);

INSERT INTO
  auth.identities (
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
VALUES (
    '82fd05db-270d-46af-b29e-082e9f709b1f',
    '82fd05db-270d-46af-b29e-082e9f709b1f',
    format('{"sub":"%s","email":"%s"}', '82fd05db-270d-46af-b29e-082e9f709b1f', 'brad@carbonos.dev')::jsonb,
    'email',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT (provider_id, provider) DO NOTHING;

-- Insert admin user into public.user table
INSERT INTO public."user" (
    id, email, "firstName", "lastName", about, "avatarUrl", 
    active, "createdAt", "updatedAt", developer, admin
) VALUES (
    '82fd05db-270d-46af-b29e-082e9f709b1f', 
    'brad@carbonos.dev', 
    'Brad', 
    'Barbin', 
    '', 
    NULL, 
    true, 
    '2025-03-14 19:25:59.271544+00', 
    NULL, 
    false, 
    false
);

-- Insert admin user permissions
INSERT INTO public."userPermission" (
    id, permissions
) VALUES (
    '82fd05db-270d-46af-b29e-082e9f709b1f', 
    '{
      "users_update": [
        "0"
      ],
      "settings_update": [
        "0"
      ]
    }'
);