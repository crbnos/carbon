// ─── Types ───────────────────────────────────────────────────────────────────

import { getBrowserEnv } from "@carbon/auth";
import { Edition } from "@carbon/utils";

const isProxied = getBrowserEnv().CARBON_EDITION === Edition.Cloud;
const PUBLIC_KEY = getBrowserEnv().SUPABASE_ANON_KEY;

type SnippetLanguage = { language: string; code: string };

type Snippet = {
  title?: string;
  bash: SnippetLanguage | null;
  js?: SnippetLanguage;
  python?: SnippetLanguage;
  dart?: SnippetLanguage;
};

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

// ─── Curl Builder ────────────────────────────────────────────────────────────

const CONTENT_TYPE_HEADER = `"Content-Type: application/json"`;

function authHeader(apiKey?: string): string {
  return apiKey
    ? `"Authorization: Bearer ${apiKey}"`
    : `"Authorization: Bearer $CARBON_API_KEY"`;
}

function buildCurl(config: {
  method?: HttpMethod;
  url: string;
  body?: string;
  headers?: string[];
  range?: string;
  includeAuth?: boolean;
  includeContentType?: boolean;
  prefer?: string;
  apiKey?: string;
}): string {
  const {
    method,
    url,
    body,
    headers: extraHeaders = [],
    range,
    includeAuth = true,
    includeContentType = false,
    prefer,
    apiKey
  } = config;

  const parts: string[] = [];

  if (method && method !== "GET") {
    parts.push(`curl -X ${method} '${url}'`);
  } else {
    parts.push(`curl '${url}'`);
  }

  if (includeAuth) {
    parts.push(`-H ${authHeader(isProxied ? apiKey : "$CARBON_PUBLIC_KEY")}`);
    if (!isProxied) {
      parts.push(`-H "carbon-key: ${apiKey ?? "$CARBON_API_KEY"}"`);
    }
  }

  if (includeContentType) {
    parts.push(`-H ${CONTENT_TYPE_HEADER}`);
  }

  if (prefer) {
    parts.push(`-H "Prefer: ${prefer}"`);
  }

  for (const header of extraHeaders) {
    parts.push(`-H ${header}`);
  }

  if (range) {
    parts.push(`-H "Range: ${range}"`);
  }

  if (body) {
    parts.push(`-d '${body}'`);
  }

  return "\n" + parts.join(" \\\n");
}

// ─── Snippet Helpers ─────────────────────────────────────────────────────────

function defineSnippet(
  title: string | undefined,
  languages: Omit<Snippet, "title">
): Snippet {
  return { title, ...languages };
}

function createBashSnippet(code: string): SnippetLanguage {
  return { language: "bash", code };
}

function createJsSnippet(code: string): SnippetLanguage {
  return { language: "js", code };
}

// ─── Subscription Config + Builder ───────────────────────────────────────────

const SUBSCRIPTION_CONFIGS = {
  subscribeAll: {
    event: "*",
    channel: "custom-all-channel",
    title: "Subscribe to all events"
  },
  subscribeInserts: {
    event: "INSERT",
    channel: "custom-insert-channel",
    title: "Subscribe to inserts"
  },
  subscribeUpdates: {
    event: "UPDATE",
    channel: "custom-update-channel",
    title: "Subscribe to updates"
  },
  subscribeDeletes: {
    event: "DELETE",
    channel: "custom-delete-channel",
    title: "Subscribe to deletes"
  }
} as const;

const REALTIME_BASH_MESSAGE = `# Realtime streams are only supported by our client libraries`;

function createSubscriptionSnippet(
  config: { event: string; channel: string; title: string },
  listenerName: string,
  resourceId: string,
  filter?: string
): Snippet {
  const filterLine = filter ? `, filter: '${filter}'` : "";

  return defineSnippet(config.title, {
    bash: createBashSnippet(REALTIME_BASH_MESSAGE),
    js: createJsSnippet(`
const ${listenerName} = carbon.channel('${config.channel}')
  .on(
    'postgres_changes',
    { event: '${config.event}', schema: 'public', table: '${resourceId}'${filterLine} },
    (payload) => {
      console.log('Change received!', payload)
    }
  )
  .subscribe()`)
  });
}

// ─── Auth Config + Builder ───────────────────────────────────────────────────

type AuthConfig = {
  method: HttpMethod;
  path: string;
  title: string;
  bashBody?: (...args: string[]) => string;
  jsCode: (...args: string[]) => string;
  bashHeaders?: string[];
};

const AUTH_CONFIGS: Record<string, AuthConfig> = {
  authSignup: {
    method: "POST",
    path: "/auth/v1/signup",
    title: "User signup",
    bashBody: (_ep, _ak, pw) =>
      `{\n  "email": "someone@email.com",\n  "password": "${pw}"\n}`,
    jsCode: (_ep, _ak, pw) => `
let { data, error } = await carbon.auth.signUp({
  email: 'someone@email.com',
  password: '${pw}'
})`
  },
  authLogin: {
    method: "POST",
    path: "/auth/v1/token?grant_type=password",
    title: "User login",
    bashBody: (_ep, _ak, pw) =>
      `{\n  "email": "someone@email.com",\n  "password": "${pw}"\n}`,
    jsCode: (_ep, _ak, pw) => `
let { data, error } = await carbon.auth.signInWithPassword({
  email: 'someone@email.com',
  password: '${pw}'
})`
  },
  authMagicLink: {
    method: "POST",
    path: "/auth/v1/magiclink",
    title: "User login",
    bashBody: () => `{\n  "email": "someone@email.com"\n}`,
    jsCode: () => `
let { data, error } = await carbon.auth.signInWithOtp({
  email: 'someone@email.com'
})`
  },
  authPhoneSignUp: {
    method: "POST",
    path: "/auth/v1/signup",
    title: "Phone Signup",
    bashBody: () =>
      `{\n  "phone": "+13334445555",\n  "password": "some-password"\n}`,
    jsCode: () => `
let { data, error } = await carbon.auth.signUp({
  phone: '+13334445555',
  password: 'some-password'
})`
  },
  authMobileOTPLogin: {
    method: "POST",
    path: "/auth/v1/otp",
    title: "Phone Login",
    bashBody: () => `{\n  "phone": "+13334445555"\n}`,
    jsCode: () => `
let { data, error } = await carbon.auth.signInWithOtp({
  phone: '+13334445555'
})`
  },
  authMobileOTPVerify: {
    method: "POST",
    path: "/auth/v1/verify",
    title: "Verify Pin",
    bashHeaders: [authHeader()],
    bashBody: () =>
      `{\n  "type": "sms",\n  "phone": "+13334445555",\n  "token": "123456"\n}`,
    jsCode: () => `
let { data, error } = await carbon.auth.verifyOtp({
  phone: '+13334445555',
  token: '123456',
  type: 'sms'
})`
  },
  authInvite: {
    method: "POST",
    path: "/auth/v1/invite",
    title: "Invite User",
    bashHeaders: [`"Authorization: Bearer USER_TOKEN"`],
    bashBody: () => `{\n  "email": "someone@email.com"\n}`,
    jsCode: () => `
let { data, error } = await carbon.auth.admin.inviteUserByEmail('someone@email.com')`
  },
  authThirdPartyLogin: {
    method: "GET",
    path: "/auth/v1/authorize?provider=github",
    title: "Third Party Login",
    bashHeaders: [`"Authorization: Bearer USER_TOKEN"`],
    jsCode: () => `
let { data, error } = await carbon.auth.signInWithOAuth({
  provider: 'github'
})`
  },
  authUser: {
    method: "GET",
    path: "/auth/v1/user",
    title: "Get User",
    jsCode: () => `
const { data: { user } } = await carbon.auth.getUser()`
  },
  authRecover: {
    method: "POST",
    path: "/auth/v1/recover",
    title: "Password Recovery",
    bashBody: () => `{\n  "email": "someone@email.com"\n}`,
    jsCode: () => `
let { data, error } = await carbon.auth.resetPasswordForEmail(email)`
  },
  authUpdate: {
    method: "PUT",
    path: "/auth/v1/user",
    title: "Update User",
    bashBody: () =>
      `{\n  "email": "someone@email.com",\n  "password": "new-password",\n  "data": {\n    "key": "value"\n  }\n}`,
    jsCode: () => `
const { data, error } = await carbon.auth.updateUser({
  email: "new@email.com",
  password: "new-password",
  data: { hello: 'world' }
})`
  },
  authLogout: {
    method: "POST",
    path: "/auth/v1/logout",
    title: "User logout",
    bashHeaders: [CONTENT_TYPE_HEADER, `"Authorization: Bearer USER_TOKEN"`],
    jsCode: () => `
let { error } = await carbon.auth.signOut()`
  }
};

function createAuthSnippet(
  configKey: keyof typeof AUTH_CONFIGS,
  endpoint: string,
  ...args: string[]
): Snippet {
  const config = AUTH_CONFIGS[configKey];

  const useCustomHeaders = !!config.bashHeaders;
  const body = config.bashBody?.(...args);

  const bashCode = useCustomHeaders
    ? buildCurl({
        method: config.method,
        url: `${endpoint}${config.path}`,
        includeAuth: false,
        includeContentType: !!body,
        headers: config.bashHeaders,
        body
      })
    : buildCurl({
        method: config.method,
        url: `${endpoint}${config.path}`,
        includeContentType: !!body,
        body
      });

  return defineSnippet(config.title, {
    bash: createBashSnippet(bashCode),
    js: createJsSnippet(config.jsCode(...args))
  });
}

// ─── CRUD Config + Builders ──────────────────────────────────────────────────

function createRestUrl(
  endpoint: string,
  resourceId: string,
  query?: string
): string {
  const base = `${endpoint}/rest/v1/${resourceId}`;
  return query ? `${base}?${query}` : base;
}

function createReadSnippet(config: {
  title: string;
  resourceId: string;
  endpoint: string;
  select: string;
  range?: string;
  filter?: string;
  jsChain: string;
  apiKey?: string;
}): Snippet {
  const {
    title,
    resourceId,
    endpoint,
    select,
    range,
    filter,
    jsChain,
    apiKey
  } = config;

  const queryParts = [];
  if (filter) queryParts.push(filter);
  queryParts.push(`select=${select}`);
  const query = queryParts.join("&");

  return defineSnippet(title, {
    bash: createBashSnippet(
      buildCurl({
        url: createRestUrl(endpoint, resourceId, query),
        range,
        apiKey
      })
    ),
    js: createJsSnippet(jsChain)
  });
}

function createWriteSnippet(config: {
  title: string;
  method: HttpMethod;
  resourceId: string;
  endpoint: string;
  body: string;
  prefer?: string;
  query?: string;
  jsChain: string;
  apiKey?: string;
}): Snippet {
  const {
    title,
    method,
    resourceId,
    endpoint,
    body,
    prefer,
    query,
    jsChain,
    apiKey
  } = config;

  return defineSnippet(title, {
    bash: createBashSnippet(
      buildCurl({
        method,
        url: createRestUrl(endpoint, resourceId, query),
        includeContentType: true,
        body,
        prefer,
        apiKey
      })
    ),
    js: createJsSnippet(jsChain)
  });
}

const snippets = {
  // ── Setup ────────────────────────────────────────────────────────────────

  endpoint: (endpoint: string) => ({
    title: "API URL",
    bash: createBashSnippet(endpoint),
    js: { language: "bash", code: endpoint }
  }),

  install: () => ({
    title: "Install",
    bash: null,
    js: createBashSnippet(`npm install --save @supabase/supabase-js`)
  }),

  env: ({ apiUrl, apiKey }: { apiUrl: string; apiKey: string }) =>
    defineSnippet(undefined, {
      bash: createBashSnippet(
        [
          `export CARBON_API_URL="${apiUrl}"`,
          `export CARBON_API_KEY="${apiKey}"`,
          !isProxied && `export CARBON_PUBLIC_KEY="${PUBLIC_KEY}`
        ].join("\n")
      ),
      js: createJsSnippet(
        [
          `// .env`,
          `CARBON_API_URL = "${apiUrl}"`,
          `CARBON_API_KEY = "${apiKey}"`,
          !isProxied && `CARBON_PUBLIC_KEY = "${PUBLIC_KEY}"`
        ].join("\n")
      )
    }),

  init: (endpoint: string) =>
    defineSnippet(undefined, {
      bash: createBashSnippet(`# No client library required for Bash.`),
      js: createJsSnippet(`
import { createClient } from '@supabase/supabase-js'

const apiUrl = process.env.CARBON_API_URL
const apiKey = process.env.CARBON_API_KEY
${!isProxied ? `const publicKey = process.env.CARBON_PUBLIC_KEY` : ""}

const carbon = createClient(apiUrl, ${
        !isProxied
          ? `publicKey, {
  global: {
    headers: {
      "carbon-key": apiKey,
    },
  },
}`
          : `apiKey`
      });`)
    }),
  // ── Read (CRUD) ──────────────────────────────────────────────────────────

  readAll: (resourceId: string, endpoint: string, apiKey?: string) =>
    createReadSnippet({
      title: "Read all rows",
      resourceId,
      endpoint,
      select: "*",
      apiKey,
      jsChain: `
let { data: ${resourceId}, error } = await carbon
  .from('${resourceId}')
  .select('*')
`
    }),

  readColumns: ({
    title = "Read specific columns",
    resourceId,
    endpoint,
    columnName = "some_column,other_column",
    apiKey
  }: {
    title?: string;
    resourceId: string;
    endpoint: string;
    columnName?: string;
    apiKey?: string;
  }) =>
    createReadSnippet({
      title,
      resourceId,
      endpoint,
      select: columnName,
      apiKey,
      jsChain: `
let { data: ${resourceId}, error } = await carbon
  .from('${resourceId}')
  .select('${columnName}')
`
    }),

  readForeignTables: (resourceId: string, endpoint: string, apiKey?: string) =>
    createReadSnippet({
      title: "Read referenced tables",
      resourceId,
      endpoint,
      select: "some_column,other_table(foreign_key)",
      apiKey,
      jsChain: `
let { data: ${resourceId}, error } = await carbon
  .from('${resourceId}')
  .select(\`
    some_column,
    other_table (
      foreign_key
    )
  \`)
`
    }),

  readRange: (resourceId: string, endpoint: string, apiKey?: string) =>
    createReadSnippet({
      title: "With pagination",
      resourceId,
      endpoint,
      select: "*",
      range: "0-9",
      apiKey,
      jsChain: `
let { data: ${resourceId}, error } = await carbon
  .from('${resourceId}')
  .select('*')
  .range(0, 9)
`
    }),

  readFilters: (resourceId: string, endpoint: string, apiKey?: string) =>
    createReadSnippet({
      title: "With filtering",
      resourceId,
      endpoint,
      select: "*",
      filter: "id=eq.1",
      range: "0-9",
      apiKey,
      jsChain: `
let { data: ${resourceId}, error } = await carbon
  .from('${resourceId}')
  .select("*")
  // Filters
  .eq('column', 'Equal to')
  .gt('column', 'Greater than')
  .lt('column', 'Less than')
  .gte('column', 'Greater than or equal to')
  .lte('column', 'Less than or equal to')
  .like('column', '%CaseSensitive%')
  .ilike('column', '%CaseInsensitive%')
  .is('column', null)
  .in('column', ['Array', 'Values'])
  .neq('column', 'Not equal to')
  // Arrays
  .contains('array_column', ['array', 'contains'])
  .containedBy('array_column', ['contained', 'by'])
`
    }),

  // ── Write (CRUD) ─────────────────────────────────────────────────────────

  insertSingle: (resourceId: string, endpoint: string, apiKey?: string) =>
    createWriteSnippet({
      title: "Insert a row",
      method: "POST",
      resourceId,
      endpoint,
      prefer: "return=minimal",
      body: `{ "some_column": "someValue", "other_column": "otherValue" }`,
      apiKey,
      jsChain: `
const { data, error } = await carbon
  .from('${resourceId}')
  .insert([
    { some_column: 'someValue', other_column: 'otherValue' },
  ])
  .select()
`
    }),

  insertMany: (resourceId: string, endpoint: string, apiKey?: string) =>
    createWriteSnippet({
      title: "Insert many rows",
      method: "POST",
      resourceId,
      endpoint,
      body: `[{ "some_column": "someValue" }, { "other_column": "otherValue" }]`,
      apiKey,
      jsChain: `
const { data, error } = await carbon
  .from('${resourceId}')
  .insert([
    { some_column: 'someValue' },
    { some_column: 'otherValue' },
  ])
  .select()
`
    }),

  upsert: (resourceId: string, endpoint: string, apiKey?: string) =>
    createWriteSnippet({
      title: "Upsert matching rows",
      method: "POST",
      resourceId,
      endpoint,
      prefer: "resolution=merge-duplicates",
      body: `{ "some_column": "someValue", "other_column": "otherValue" }`,
      apiKey,
      jsChain: `
const { data, error } = await carbon
  .from('${resourceId}')
  .upsert({ some_column: 'someValue' })
  .select()
`
    }),

  update: (resourceId: string, endpoint: string, apiKey?: string) =>
    createWriteSnippet({
      title: "Update matching rows",
      method: "PATCH",
      resourceId,
      endpoint,
      prefer: "return=minimal",
      query: "some_column=eq.someValue",
      body: `{ "other_column": "otherValue" }`,
      apiKey,
      jsChain: `
const { data, error } = await carbon
  .from('${resourceId}')
  .update({ other_column: 'otherValue' })
  .eq('some_column', 'someValue')
  .select()
`
    }),

  delete: (resourceId: string, endpoint: string, apiKey?: string) =>
    defineSnippet("Delete matching rows", {
      bash: createBashSnippet(
        buildCurl({
          method: "DELETE",
          url: createRestUrl(endpoint, resourceId, "some_column=eq.someValue"),
          apiKey
        })
      ),
      js: createJsSnippet(`
const { error } = await carbon
  .from('${resourceId}')
  .delete()
  .eq('some_column', 'someValue')
`)
    }),

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribeAll: (listenerName: string, resourceId: string) =>
    createSubscriptionSnippet(
      SUBSCRIPTION_CONFIGS.subscribeAll,
      listenerName,
      resourceId
    ),

  subscribeInserts: (listenerName: string, resourceId: string) =>
    createSubscriptionSnippet(
      SUBSCRIPTION_CONFIGS.subscribeInserts,
      listenerName,
      resourceId
    ),

  subscribeUpdates: (listenerName: string, resourceId: string) =>
    createSubscriptionSnippet(
      SUBSCRIPTION_CONFIGS.subscribeUpdates,
      listenerName,
      resourceId
    ),

  subscribeDeletes: (listenerName: string, resourceId: string) =>
    createSubscriptionSnippet(
      SUBSCRIPTION_CONFIGS.subscribeDeletes,
      listenerName,
      resourceId
    ),

  subscribeEq: (
    listenerName: string,
    resourceId: string,
    columnName: string,
    value: string
  ) =>
    createSubscriptionSnippet(
      {
        event: "*",
        channel: "custom-filter-channel",
        title: "Subscribe to specific rows"
      },
      listenerName,
      resourceId,
      `${columnName}=eq.${value}`
    ),

  // ── Auth ─────────────────────────────────────────────────────────────────

  authSignup: (endpoint: string, apiKey: string, randomPassword: string) =>
    createAuthSnippet("authSignup", endpoint, apiKey, randomPassword),

  authLogin: (endpoint: string, apiKey: string, randomPassword: string) =>
    createAuthSnippet("authLogin", endpoint, apiKey, randomPassword),

  authMagicLink: (endpoint: string) =>
    createAuthSnippet("authMagicLink", endpoint),

  authPhoneSignUp: (endpoint: string) =>
    createAuthSnippet("authPhoneSignUp", endpoint),

  authMobileOTPLogin: (endpoint: string) =>
    createAuthSnippet("authMobileOTPLogin", endpoint),

  authMobileOTPVerify: (endpoint: string) =>
    createAuthSnippet("authMobileOTPVerify", endpoint),

  authInvite: (endpoint: string) => createAuthSnippet("authInvite", endpoint),

  authThirdPartyLogin: (endpoint: string) =>
    createAuthSnippet("authThirdPartyLogin", endpoint),

  authUser: (endpoint: string) => createAuthSnippet("authUser", endpoint),

  authRecover: (endpoint: string) => createAuthSnippet("authRecover", endpoint),

  authUpdate: (endpoint: string) => createAuthSnippet("authUpdate", endpoint),

  authLogout: (endpoint: string) => createAuthSnippet("authLogout", endpoint)
};

export default snippets;
