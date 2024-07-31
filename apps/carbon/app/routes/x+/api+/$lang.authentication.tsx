import { getBrowserEnv } from "~/config/env";
import { CodeSnippet, Snippets, useSelectedLang } from "~/modules/api";

const { SUPABASE_ANON_PUBLIC, SUPABASE_API_URL } = getBrowserEnv();

export default function Authentication() {
  const selectedLang = useSelectedLang();

  return (
    <>
      <h2 className="doc-heading">Authentication</h2>
      <div className="doc-section">
        <article className="code-column text-foreground">
          <p>Supabase works through a mixture of JWT and Key auth.</p>
          <p>
            If no <code>Authorization</code> header is included, the API will
            assume that you are making a request with an anonymous user.
          </p>
          <p>
            If an <code>Authorization</code> header is included, the API will
            "switch" to the role of the user making the request. See the User
            Management section for more details.
          </p>
          <p>We recommend setting your keys as Environment Variables.</p>
        </article>
      </div>

      <h2 className="doc-heading">Client API Keys</h2>
      <div className="doc-section ">
        <article className="code-column text-foreground">
          <p>
            Client keys allow "anonymous access" to your database, until the
            user has logged in. After logging in the keys will switch to the
            user's own login token.
          </p>
          <p>
            In this documentation, we will refer to the key using the name{" "}
            <code>SUPABASE_KEY</code>.
          </p>
        </article>
        <article className="code">
          <CodeSnippet
            selectedLang={selectedLang}
            snippet={Snippets.authKey(
              "CLIENT API KEY",
              "SUPABASE_KEY",
              SUPABASE_ANON_PUBLIC
            )}
          />
          <CodeSnippet
            selectedLang={selectedLang}
            snippet={Snippets.authKeyExample(
              SUPABASE_ANON_PUBLIC,
              SUPABASE_API_URL,
              {
                showBearer: false,
              }
            )}
          />
        </article>
      </div>
    </>
  );
}
