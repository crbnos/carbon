UPDATE "integration"
SET "jsonschema" = jsonb_build_object(
  'type', 'object',
  'properties', jsonb_build_object(
    'access_token', jsonb_build_object('type', 'string'),
    'team_id', jsonb_build_object('type', 'string'),
    'team_name', jsonb_build_object('type', 'string'),
    'channel', jsonb_build_object('type', 'string'),
    'channel_id', jsonb_build_object('type', 'string'),
    'slack_configuration_url', jsonb_build_object('type', 'string'),
    'url', jsonb_build_object('type', 'string'),
    'bot_user_id', jsonb_build_object('type', 'string'),
    'nonconformance_channel_id', jsonb_build_object(
      'type', 'string',
      'description', 'Default Slack channel for non-conformance notifications'
    ),
    'nonconformance_notifications_enabled', jsonb_build_object(
      'type', 'boolean',
      'default', true,
      'description', 'Enable automatic Slack notifications for non-conformances'
    )
  )
)
WHERE "id" = 'slack';