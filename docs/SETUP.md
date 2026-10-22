# Setup and launch

The frontend and backend are separate deployments. GitHub Pages hosts public HTML/CSS/JavaScript and cannot hold API keys, run a private API, or safely enforce free-render limits. The included backend targets Cloudflare Workers with D1 and private R2. No backend, database, bucket, provider billing, or credentials have been provisioned by these files.

## 1. Public site settings

Edit `public/config.js` with the actual event label and optional booking and privacy-policy HTTPS links. The initial branding is Spray-Net South Charlotte and the starting visitor allowance is three renders. Do not put keys, administrator tokens, or private endpoint credentials in any file under `public/`.

`apiBase` is the API origin, such as `https://spray-net-home-show-api.example.workers.dev`; do not append `/api`. The frontend adds endpoint paths itself. Leave it empty until a real backend is ready. The GitHub Actions build can override this with the public repository variable `API_BASE_URL`.

The frontend allowance text is informational. The backend `FREE_RENDERS` setting and database balance enforce the actual allowance. Keep both at `3` for this offer.

## 2. Provision the private backend

These commands are deployment instructions to run once the intended Cloudflare account and billing are selected. They were not executed during local implementation. Use a supported Wrangler CLI through your normal development environment; it is a deployment tool, not a frontend runtime dependency.

From the repository root:

```sh
npx wrangler login
npx wrangler d1 create spray-net-home-show
npx wrangler r2 bucket create spray-net-home-show-private
```

Copy the returned D1 database ID into `backend/wrangler.jsonc`. Confirm the `DB` and `PHOTOS` bindings point to the intended D1 database and private R2 bucket. Leave R2 public access disabled. Never use a public bucket URL for uploaded homes or generated images.

Update the public Worker variables in `backend/wrangler.jsonc`:

| Variable | Initial setting and purpose |
| --- | --- |
| `ALLOWED_ORIGINS` | Exact production page origin, such as `https://benjamin41997-ctrl.github.io`. Origins have no repository path or trailing slash. Add localhost origins only when needed for development. |
| `EVENT_ID` | Stable internal ID for this show. The frontend's display label does not determine the credit boundary. Use a new event ID deliberately for a new event. |
| `FREE_RENDERS` | `3`, per normalized email and event. |
| `DAILY_RENDER_LIMIT` | Initial cap of `50` provider attempts per UTC day across the event/site. Review for expected attendance and budget. |
| `LEADS_PER_IP_HOUR` | Initial cap of `30`. Many booth visitors can share one venue IP; test before choosing a stricter value. |
| `CONSENT_VERSION` | Version of the consent text currently shown. Update when that wording changes. |
| `OPENAI_IMAGE_MODEL` | Used only for the optional direct OpenAI adapter. |
| `RENDER_TIMEOUT_MS` | Initial upstream timeout of `90000` ms. |

Create the schema, then set two different random secrets of at least 32 characters:

```sh
npx wrangler d1 execute spray-net-home-show --remote --file backend/schema.sql --config backend/wrangler.jsonc
npx wrangler secret put RATE_LIMIT_SALT --config backend/wrangler.jsonc
npx wrangler secret put ADMIN_TOKEN --config backend/wrangler.jsonc
```

Keep `ADMIN_TOKEN` in your password manager or approved secret manager. It grants access to all exported leads. The rate-limit salt is server-only and prevents storing raw visitor IPs in the rate-limit table.

For local Worker development only, copy `backend/.dev.vars.example` to `backend/.dev.vars` and fill values locally. `.dev.vars` is ignored by Git. Use `npx wrangler dev --config backend/wrangler.jsonc` for the Worker; the static preview server remains a separate process. A local D1 database needs its own schema initialization with `--local` instead of `--remote`.

## 3. Connect the rendering provider

### Existing rendering API

The preferred route is the business's existing HTTPS rendering API. Its actual endpoint and contract were not supplied, so integration cannot yet be verified. The included adapter expects this contract; adjust `callRenderer` in `backend/worker.mjs` if your existing API differs.

```sh
npx wrangler secret put RENDER_API_URL --config backend/wrangler.jsonc
npx wrangler secret put RENDER_API_KEY --config backend/wrangler.jsonc
```

The Worker POSTs JSON with a server-only bearer credential:

```json
{
  "image_base64": "<JPEG, PNG or WebP bytes encoded as base64>",
  "mime_type": "image/jpeg",
  "color_name": "Soft white",
  "color_hex": "#F2EFE6",
  "surface": "Exterior siding"
}
```

Expected successful response:

```json
{
  "image_base64": "<completed image encoded as base64>",
  "mime_type": "image/jpeg"
}
```

Supported output MIME types are JPEG, PNG, and WebP, with a maximum decoded result size of 15 MB. The adapter checks image signatures and rejects redirects and arbitrary returned image URLs. This avoids sending credentials to redirected services or fetching untrusted private network locations. The custom API takes precedence; incomplete custom API settings keep rendering unavailable rather than silently switching providers.

### Optional direct OpenAI Images API

If the existing API is unsuitable, the included adapter can call OpenAI Images edits using a server-side key:

```sh
npx wrangler secret put OPENAI_API_KEY --config backend/wrangler.jsonc
```

Leave the custom API settings unset to use this adapter. Check the model's availability and current API costs in the selected OpenAI account before enabling it. API usage is billed separately from ChatGPT; a ChatGPT subscription does not provide this site's image-generation allowance. The business pays even though the visitor receives three renders for free. Set provider-side budgets/alerts where available as well as the application's attempt cap. Timeouts and failed browser downloads can still incur upstream charges.

No provider is enabled until server credentials are configured. A connected lead API can still collect a project when rendering is unavailable, and the visitor is told that rendering is unavailable.

## 4. Deploy and check the Worker

```sh
npx wrangler deploy --config backend/wrangler.jsonc
```

Call `/api/health` on the returned Worker origin. With D1 schema, R2, origin settings, and salt configured, it should report `ready: true`; with a usable configured renderer it should also report `renderAvailable: true`. Health checks configuration and a lead-table read; they do not perform a paid provider request or prove the provider's credentials work. A real end-to-end rendering test is required.

## 5. Publish the static frontend to personal GitHub Pages

The requested personal destination is `benjamin41997-ctrl`. Verify the signed-in account and repository access before creating or pushing the repository. The expected project repository name is `spray-net-home-show`, but the final URL must be taken from an actual successful deployment.

Push this folder as the repository source on `main`. In repository settings, select **Pages → Source → GitHub Actions**. Set **Settings → Secrets and variables → Actions → Variables → New repository variable** named `API_BASE_URL` to the public Worker origin. This URL is public configuration, not a secret. Never add a provider key or administrator token to a Pages build variable or source file.

The included `.github/workflows/deploy.yml` checks source, runs tests, builds `dist/`, uploads a Pages artifact, and deploys it using the official GitHub actions. It runs on pushes to `main` and manual workflow dispatch. An empty `API_BASE_URL` deliberately publishes preview mode.

Confirm the completed deployment URL before printing a QR code. A custom domain can be added later without changing relative asset paths; remember to update `ALLOWED_ORIGINS` to include the new origin.

## 6. Leads, CSV, and corporate process

`GET /api/admin/leads.csv` returns an administrator CSV with a bearer `ADMIN_TOKEN`. Retrieve it through an approved administrative client that sends an Authorization header. Do not put that token into a URL, browser bookmark, public page, or shared QR. The export excludes access tokens, storage keys, and image data.

Current CSV columns are:

```text
id,first_name,last_name,email,phone,address,city,state,zip,service,timeline,notes,event_id,event_label,consent_at,consent_version,remaining_renders,created_at,photo_count,render_count
```

The CSV escapes spreadsheet formulas. It is not yet certified as the exact Spray-Network import schema. Obtain the official/sample import CSV, map and rename columns accordingly, and test a synthetic record before using it with live leads. Downloaded exports contain personal information; store them privately and delete temporary copies under your business's retention policy.

The supplied corporate procedure says to keep essential lead questions and consult the business coach for changes beyond event details. This form captures name, email, phone, full project address, and service interest, but the exact original question wording and import schema still need comparison. Confirm the alternate flow through that process. Keep the existing Microsoft Form available until live submission, export, and import have been tested.

## 7. Privacy, limits, and launch acceptance

The frontend discloses project follow-up, storage of submitted photos, and photo processing by the configured image provider; uploading does not grant advertising permission. Before live use, add a real business privacy policy/contact, select an approved provider, and establish access/deletion and retention procedures. The application currently has no scheduled deletion job or public self-service deletion endpoint. Administrators must remove D1 records and corresponding R2 objects together; deleting one does not clean up the other automatically. Configure appropriate R2 lifecycle retention and a matching D1 process for the policy you choose.

Email deduplication trims/case-normalizes the address and is scoped to the server event ID. It is not verified identity, and aliases/different email addresses can bypass a per-email offer. Rate limits and the global daily provider-attempt cap provide additional controls, but CORS is not authentication or full bot protection. Add stronger verification only if actual abuse warrants it.

Before accepting real visitors:

1. Test the deployed site on an actual iPhone and Android phone, including autofill, optional supported contact sharing, photo selection, and small-screen layout.
2. Confirm the form rejects missing consent and required contact fields, then save a synthetic complete project.
3. Create and download a real visualization; confirm only the selected project photo is sent to the provider and review output quality. This test incurs provider usage.
4. Complete three renders and confirm a fourth is rejected server-side. Resubmit the same email for the same event and confirm a fresh allowance is not issued.
5. Check retry behavior on a slow connection, provider errors, and the private image endpoints with a missing or another lead's token.
6. Export the synthetic lead, map it to the official Spray-Network CSV, and test an import.
7. On a shared booth device, use **Finish & clear this device for the next visitor** before the next visitor. The visitor session allows access to their private photos and renders; clear it deliberately.
8. Confirm venue Wi-Fi/cellular access, charged backup device, and a staffed fallback. There is no offline submission queue.
9. Print and scan the QR code for the actual live deployment. Review follow-up assignments so every lead is contacted within 24 hours after the show's final day.

## Initial repository visibility

The first version is stored in a private repository. The workflow runs build and tests, and deploys only when the repository variable `PUBLISH_PAGES` is exactly `true`. Enable Pages and this variable only after the public audience has been confirmed. A free GitHub account may require a public repository for Pages. No visitor information or credentials should ever be committed.
