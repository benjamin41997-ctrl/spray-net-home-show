# Setup and launch

The frontend and backend are separate deployments. GitHub Pages hosts public HTML/CSS/JavaScript and cannot hold API keys, run a private API, or safely enforce free-render limits. The included backend targets Cloudflare Workers with D1 and private R2. No backend, database, bucket, provider billing, or credentials have been provisioned by these files.

The repository is public and the lead backend is deployed. See [DEPLOYMENT.md](DEPLOYMENT.md) for current production URLs and status. GitHub Actions supplies the production API origin; the source config remains disconnected for local design previews. Image generation is disabled pending provider-key/billing approval.

## Implemented lead and consultation flow

Visitors choose a service, enter their contact/project details, and either submit the lead alone or submit it with a consultation request. Both options save the same required lead fields and unlock the private color studio. The next screen puts consultation arrangements first; opening the studio is a separate optional action. Photo upload controls appear only inside the studio after the server has accepted the lead.

The server stores `consultationPreference` as `contact_me` or `schedule_now`, and exports it as `consultation_preference`. Here `schedule_now` means the visitor requested help arranging a consultation. It does not indicate a reserved time, live availability, calendar event, or confirmed appointment. A lead-only visitor can subsequently request a consultation from the confirmation screen. The app does not notify the team automatically, so someone must review the saved requests and follow up.

The confirmation screen lets a visitor copy an HTTPS private studio resume link or open the studio immediately. The link has the form `https://<published-page>/#studio=<lead-id>.<visitor-token>`. It contains a bearer credential: anyone receiving it can access the saved project's photos and renders. Treat it as private access, never a public booth QR, analytics value, or marketing link. The app removes the access fragment from the address bar and verifies the lead/token with the configured API; the link cannot choose its own API destination or create a new lead or allowance.

There is no email/SMS sending or email magic-link service. Visitors must save or privately transfer their copied link themselves to use it on another phone later. Browser `sessionStorage` only helps reopen the current tab's session; closing/clearing the tab or clearing a shared device can remove that convenience. Before clearing a booth device, have the visitor save their link. A private link is generated only on an HTTPS page; the local HTTP design preview cannot issue a usable production resume link.

## 1. Public site settings

Edit `public/config.js` with the actual event label and optional booking and privacy-policy HTTPS links. The initial branding is Spray-Net South Charlotte and the starting visitor allowance is three renders. Do not put keys, administrator tokens, or private endpoint credentials in any file under `public/`.

`bookingUrl` must be a verified business scheduling destination, free of contact details and access credentials in its query. Leave it empty while no actual calendar is configured. The official South Charlotte location page is a quote-request/follow-up page, not verified appointment scheduling. Without a calendar, the confirmation screen records a request and explains that the team will arrange the time. With a calendar, it offers a separate link after the lead is saved; only the team or calendar can confirm an appointment. No calendar API integration is included.

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

## 5. GitHub Pages deployment

The personal source destination is the public `benjamin41997-ctrl/spray-net-home-show` repository. The user approved public repository visibility and GitHub Pages deployment. Production deployment is controlled by `PUBLISH_PAGES=true`; the build must also receive the configured `API_BASE_URL`.

Push this folder as the repository source on `main`. In repository settings, select **Pages → Source → GitHub Actions**. Set **Settings → Secrets and variables → Actions → Variables → New repository variable** named `API_BASE_URL` to the public Worker origin. This URL is public configuration, not a secret. Never add a provider key or administrator token to a Pages build variable or source file.

The included `.github/workflows/deploy.yml` checks source, runs tests, and builds `dist/` on pushes to `main` and manual workflow dispatch. Pages configuration, artifact upload, and deployment run only when `PUBLISH_PAGES` is exactly `true`. Set that variable only after public launch is authorized. If publication is later enabled with an empty `API_BASE_URL`, the public page remains a design preview rather than a working lead collector.

Confirm the completed deployment URL before printing a QR code. A custom domain can be added later without changing relative asset paths; remember to update `ALLOWED_ORIGINS` to include the new origin.

## 6. Leads, CSV, and corporate process

`GET /api/admin/leads.csv` returns an administrator CSV with a bearer `ADMIN_TOKEN`. Retrieve it through an approved administrative client that sends an Authorization header. Do not put that token into a URL, browser bookmark, public page, or shared QR. The export excludes access tokens, storage keys, and image data.

Current CSV columns are:

```text
id,first_name,last_name,email,phone,address,city,state,zip,service,consultation_preference,timeline,notes,event_id,event_label,consent_at,consent_version,remaining_renders,created_at,photo_count,render_count
```

The CSV escapes spreadsheet formulas. It is not yet certified as the exact Spray-Network import schema. Obtain the official/sample import CSV, map and rename columns accordingly, and test a synthetic record before using it with live leads. Downloaded exports contain personal information; store them privately and delete temporary copies under your business's retention policy.

The supplied corporate procedure says to keep essential lead questions and consult the business coach for changes beyond event details. This form captures name, email, phone, full project address, and service interest, but the exact original question wording and import schema still need comparison. Confirm the alternate flow through that process. Keep the existing Microsoft Form available until live submission, export, and import have been tested.

## 7. Privacy, limits, and launch acceptance

The frontend discloses project follow-up, storage of submitted photos, and photo processing by the configured image provider; uploading does not grant advertising permission. Before live use, add a real business privacy policy/contact, select an approved provider, and establish access/deletion and retention procedures. The application currently has no scheduled deletion job or public self-service deletion endpoint. Administrators must remove D1 records and corresponding R2 objects together; deleting one does not clean up the other automatically. Configure appropriate R2 lifecycle retention and a matching D1 process for the policy you choose.

Email deduplication trims/case-normalizes the address and is scoped to the server event ID. It is not verified identity, and aliases/different email addresses can bypass a per-email offer. Rate limits and the global daily provider-attempt cap provide additional controls, but CORS is not authentication or full bot protection. Add stronger verification only if actual abuse warrants it.

Before accepting real visitors:

1. After deployment is authorized, test the site on an actual iPhone and Android phone, including autofill, optional supported contact sharing, and small-screen layout. Confirm photo upload and studio controls are unavailable before submission.
2. Confirm the form rejects missing consent and required contact fields. Save one synthetic lead-only project and a separate lead-plus-consultation project. Both must show the consultation-focused confirmation and unlock the studio. Check the saved/exported consultation preference and verify no appointment is claimed without calendar/team confirmation.
3. Copy a private studio link, open it on a separate phone/browser, and verify it restores the correct existing lead and remaining allowance. Confirm the fragment is scrubbed and invalid credentials are rejected. Add a photo only after saving the lead, then create and download a real visualization; confirm only the selected project photo is sent to the provider and review output quality. This rendering test incurs provider usage. No email or SMS should be expected.
4. Complete three renders and confirm a fourth is rejected server-side. Resubmit the same email for the same event and confirm a fresh allowance is not issued.
5. Check retry behavior on a slow connection, provider errors, and the private image endpoints with a missing or another lead's token.
6. Export the synthetic lead, map it to the official Spray-Network CSV, and test an import.
7. On a shared booth device, have the visitor save/transfer their private studio link, then use **Finish & clear this device for the next visitor**. Confirm the next visitor sees an empty lead form. The bearer link remains usable after clearing the device, so keep it private.
8. Confirm venue Wi-Fi/cellular access, charged backup device, and a staffed fallback. There is no offline submission queue.
9. Print and scan the QR code for the actual live deployment. Review follow-up assignments so every lead is contacted within 24 hours after the show's final day.

## Initial repository visibility

The initial version was private. The user subsequently authorized making this repository public and deploying GitHub Pages. Keep customer information, runtime credentials, and exported leads out of source control. The workflow deploys only when `PUBLISH_PAGES` is exactly `true`.

## Local flow verification

Local browser integration verified lead-only confirmation, authenticated consultation intent, explicit post-lead studio entry, WebP upload/session reload, shared-device reset, and a second visitor consultation request. Checks used the actual Worker with ephemeral local SQLite/R2 and rendering disabled. No production data, real appointment, or paid provider call was involved. Deployed-provider and real calendar integration remain unverified.
