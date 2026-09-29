# CAD

> Sync CAD data from Onshape and Onshape Government into Carbon.

## Onshape

Connect to **Onshape** over **OAuth** to bring CAD data into Carbon. No keys to paste.

  
  ### Authorize over OAuth

  Start the connection and Carbon opens an Onshape popup.
  
  
  ### Approve read access

  Approve read access to your Onshape documents in the popup.
  
  
  ### Tokens stored

  Carbon stores the connection, the access and refresh tokens, and can then pull from your Onshape documents.
  

| Setting | What it controls |
| --- | --- |
| Connection | Established by OAuth — no keys to paste. Carbon stores the access and refresh tokens for you. |

Onshape only appears when its OAuth client is configured server-side (`ONSHAPE_CLIENT_ID`) — see
`docs/platform/self-hosting/environment-variables`.

## Onshape Government

**Onshape Government** is the ITAR and FedRAMP edition of Onshape. It has no public App Store, so Carbon's
public app can't be installed there. Instead, your Enterprise owns a **private OAuth app** that Carbon
connects through. Everything after the connection works the same as Onshape: browsing documents, importing a
bill of materials, and syncing released assets.

  
  ### Create the private app in Onshape

  An Enterprise admin opens **Enterprise settings → Developer → OAuth applications** and creates a new OAuth
  application. Choose **Connected Cloud App** as the type. Set the redirect URL to
  `https://<your Carbon address>/api/integrations/onshape-government/oauth`. Grant read access to profile
  information, read access to documents, and write access to documents. Onshape shows the client secret only
  once, so copy it straight away. If you'd rather not do this yourselves, give Carbon support a seat in your
  Enterprise and we'll build the app with you.
  
  
  ### Enter it in Carbon

  Open **Onshape Government** under **Settings → Integrations**. Enter your Onshape URL, the OAuth URL, and the
  app's client ID and client secret. The integration drawer shows the exact redirect URL for your Carbon
  address.
  
  
  ### Approve the connection

  When you save, Carbon sends you to your Onshape tenant to approve the connection, then brings you back.
  

| Setting | What it controls |
| --- | --- |
| Onshape URL | The address your team signs in to Onshape Government at. Each Enterprise has its own. |
| OAuth URL | The OAuth server for your Onshape Government environment, from your Onshape account team. |
| Client ID / Client secret | The private OAuth app from your Enterprise. The secret is stored encrypted. Leave it empty to keep the saved one, or enter it again to reconnect. |
| Sync released assets | Same as on Onshape: pulls released drawings and models onto matching items. |

A private app's API calls count toward your Enterprise's **yearly Onshape API limit**. Browsing and importing
a bill of materials take a few calls each. Released-asset sync takes several calls per released revision, so
leave it off if your allowance is tight.

Onshape Government is only offered on controlled (ITAR) Carbon instances — those running with
`CONTROLLED_ENVIRONMENT=true`. See `docs/platform/self-hosting/environment-variables`.

A company connects to one Onshape at a time. Uninstall Onshape before connecting Onshape Government, and the
other way round.

## Related

  - Items The part records CAD data attaches to.
  - Methods & sourcing How a part's bill of materials is built up.
