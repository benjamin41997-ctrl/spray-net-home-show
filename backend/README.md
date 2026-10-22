# Private lead and image API

GitHub Pages serves the frontend only. Run this API as a Cloudflare Worker with a D1 database and a **private** R2 bucket. No photo, contact details, administrator token, or image API key belongs in the GitHub repository. This directory contains configuration examples, not deployed infrastructure.

The primary flow is saving a lead for project follow-up and consultation scheduling. The visualizer is an optional post-lead perk: every session, photo, and render route requires the bearer token for an existing saved lead. Selecting a photo or viewing the page does not unlock rendering. Leads can be collected while rendering is disabled and the visualizer can be connected after the show.

An external scheduling link may be offered after the lead is saved. The server records the visitor's consultation preference as `schedule_now` or `contact_me`; this is intent, not an appointment. Opening that scheduler does not confirm an appointment, and this API does not record a booked status or enforce a booking requirement. A future booking-gated offer would need a verified scheduler integration or webhook that confirms the actual appointment; no client-supplied booked flag should unlock it.

## Setup

From this directory, with a current Node.js runtime and Cloudflare account:

```sh
npx wrangler login
npx wrangler d1 create spray-net-home-show
npx wrangler r2 bucket create spray-net-home-show-private
```

Copy the returned D1 database ID into `wrangler.jsonc`. Set `ALLOWED_ORIGINS` to the exact frontend origin, such as `https://yourname.github.io` (no repository path or trailing slash). Remove local development origins from the production configuration. Change `EVENT_ID` for each real event; the server uses it for deduplication and credit allocation. The client-supplied event name is a descriptive label only.

```sh
npx wrangler d1 execute spray-net-home-show --remote --file=schema.sql
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Use separate cryptographically random base64url or hexadecimal secrets, at least 32 characters each. Keep the administrator secret in a password manager. Do not use the example placeholders. Wrangler stores production secrets separately from source files. For local development, copy `.dev.vars.example` to ignored `.dev.vars`, set real random development secrets, initialize the local database using `--local` instead of `--remote`, and run `npx wrangler dev`.

`GET /api/health` must return `ready: true` before public submissions. It checks bindings, configuration, and the lead table. It does not prove cloud account billing, R2 write permissions, or a renderer's account access. Test a complete private submission and export before use.

`schema.sql` initializes a new database. If an earlier development database already contains `leads`, applying `CREATE TABLE IF NOT EXISTS` does not add newly introduced columns. Migrate that database before running the updated Worker:

```sql
ALTER TABLE leads ADD COLUMN consultation_preference TEXT NOT NULL DEFAULT 'contact_me'
  CHECK (consultation_preference IN ('contact_me', 'schedule_now'));
```

Run this once only after confirming the column is absent, and back up any database containing real leads first. New databases need only `schema.sql`.

## Enable real renders

Two adapters are available. Both send only the photo and visual settings to the provider, not the contact form data.

**OpenAI Images:** set the production `OPENAI_API_KEY` secret with `npx wrangler secret put OPENAI_API_KEY`. The adapter uses the official [`POST /v1/images/edits`](https://developers.openai.com/api/reference/resources/images/methods/edit) API, multipart `image[]`, `gpt-image-1.5` by default, one low-quality 1024 × 1024 JPEG. `OPENAI_IMAGE_MODEL` is configurable. OpenAI API access and billing are separate from ChatGPT/Codex subscriptions. No paid image calls are made by the included tests.

**Your existing API:** set both `RENDER_API_URL` and `RENDER_API_KEY` through Wrangler secrets. An HTTPS custom URL takes precedence over OpenAI. Incomplete custom API configuration disables rendering instead of silently switching to another provider. The adapter sends:

```json
{
  "image_base64": "<JPEG, PNG, or WebP bytes encoded as base64>",
  "mime_type": "image/jpeg",
  "color_name": "Warm white",
  "color_hex": "#F2EFE5",
  "surface": "siding"
}
```

It expects JSON `{ "image_base64": "...", "mime_type": "image/jpeg" }`. PNG and WebP output are also accepted. Arbitrary returned image URLs are deliberately unsupported; the server never fetches a provider-supplied URL. Adapt `callRenderer` if your actual API uses a different documented contract.

`renderAvailable: false` means the visitor's lead and photo can be saved but the app must not claim to generate an image. A preview is a visual concept; the provider may alter details or approximate the requested paint color.

## API contract

Every error is JSON `{ "error": { "code": "CODE", "message": "Safe visitor-facing message" } }`. All responses use `Cache-Control: no-store`. CORS accepts only configured exact origins; it is not a substitute for bearer authentication.

| Route | Authentication | Result |
| --- | --- | --- |
| `GET /api/health` | None | `{ready,renderAvailable,freeRenders}` |
| `POST /api/leads` | None; IP limit applies | `{id,token,remainingRenders,consultationPreference}` |
| `POST /api/leads/:id/consultation` | Visitor bearer | `{consultationPreference:"schedule_now"}`; records intent only |
| `GET /api/leads/:id/session` | Visitor bearer | `{id,remainingRenders,consultationPreference,photos,renders}`; no contact fields |
| `POST /api/leads/:id/photos` | Visitor bearer | Multipart `photo`; `{id,url}` |
| `GET /api/leads/:id/photos/:photoId` | Visitor bearer | Private image bytes |
| `POST /api/leads/:id/renders` | Visitor bearer + `Idempotency-Key` | `{id,status,imageUrl?,remainingRenders,error?}` |
| `GET /api/leads/:id/renders/:renderId` | Visitor bearer | Same render metadata |
| `GET /api/leads/:id/renders/:renderId/image` | Visitor bearer | Private result bytes |
| `GET /api/admin/leads.csv` | Separate administrator bearer | Formula-protected CSV |

Lead JSON: `firstName`, `lastName`, `email`, `phone`, `address`, `city`, two-letter `state`, US `zip`, `service`, optional `timeline`, `notes`, `event`, and `contactConsent: true`. Consent time and a configurable consent-text version are recorded. The server stores SHA-256 hashes of visitor bearer tokens, never their cleartext value.

`consultationPreference` accepts only `schedule_now` or `contact_me`, defaulting to `contact_me` when omitted by an older client. It is persisted as `consultation_preference`, returned in the creation response and authenticated session, and included in the administrator CSV. Both choices save a lead and unlock the same post-lead visualizer allowance. Neither proves a consultation has been booked. Preference is part of the validated lead payload and therefore part of the idempotency hash; changing it while retrying the same submission is rejected.

After a lead-only submission, `POST /api/leads/:id/consultation` with JSON `{ "consultationPreference": "schedule_now" }` and the saved lead's bearer records a later consultation request without creating another lead. Repeating this request has the same result, does not change render credits or daily attempts, and never contacts the image provider. The frontend can offer a real configured scheduler link only after this request succeeds. Without a configured scheduler it should explain that the team will arrange the consultation; no booking is confirmed by this endpoint.

For loss-safe initial submission, generate a random 32-byte base64url token in the visitor's browser and a UUID request key **before sending**. Retain them while retrying. Send `X-Lead-Token` and `Idempotency-Key` headers together. The exact same validated payload, token, and key returns the original lead and remaining budget. A different token can never claim the existing email/event record. Without both headers, a new lead gets a server-generated token and cannot recover a lost response. Already registered users without their session need staff assistance; there is no insecure email-only account recovery.

Upload JPEG, PNG, or WebP files up to 10 MiB. File magic must match MIME. The server permits eight distinct photos per lead and deduplicates identical bytes so upload retries reuse the same photo ID. Photos become visible in session metadata only after R2 confirms the write. A failed write can be retried with the same file.

Render JSON: `{photoId,colorName,colorHex,surface}`. Use a new UUID `Idempotency-Key` for a new render and retain it while retrying the same render. Successful synchronous calls return 201. Concurrent retries may return 202 with `status: "pending"`; poll the metadata route. A failed recorded request returns `status: "failed"`; use a fresh key to explicitly try again. A reused key with changed settings returns 409.

All media URLs are relative API paths. Resolve them against the configured API origin, fetch with `Authorization: Bearer <visitor token>`, then use a blob URL to display/download. Never put visitor tokens in query strings. Keep visitor sessions scoped to a tab on a shared booth device and provide a clear reset between visitors.

## Quotas and failure behavior

- Three free successful previews per normalized email and server event by default. This is an email-based allowance, not verified human identity; different emails can obtain separate allowances.
- A database trigger atomically reserves both a visitor credit and one global daily attempt. Concurrent requests cannot overspend those configured counters.
- The default global cap is **50 attempts per UTC day**, across all visitors and events. It is an attempt cap, not a guaranteed dollar budget. Configure provider account spending controls separately.
- Upstream errors restore the visitor credit once. Global attempts are never refunded because a timed-out request can still incur provider charges.
- Render requests time out at 90 seconds by default. A session refresh or render request recovers interrupted pending records older than five minutes, preventing lost credits. A provider may still finish an aborted operation, so the attempt remains counted.
- Lead creation defaults to 30 attempts per IP per hour; `LEADS_PER_IP_HOUR` can be tuned for a booth using a shared hotspot. Only salted hashes of IP/hour buckets are stored. A zero value disables new lead submissions; a zero daily limit disables render attempts.
- Missing database, R2, configuration, or provider credentials never produces a fake successful submission or image. Existing leads remain saved if an upload or image call fails.

## Export and retention

CSV includes standard contact/service fields plus consultation preference, event, consent, timestamps and photo/render counts. It does **not** claim an exact Spray-Network import schema: verify and map columns against a real import template before the show. A leading apostrophe protects formula-like cells; account for that marker when mapping an international phone number. Export refuses more than 10,000 leads rather than silently truncating.

The administrator endpoint has no password-entry web page; use an authenticated request from a trusted local tool. Do not paste the secret into a public page or URL. Administrator export contains private contact details.

Data currently remains in D1/R2 until an operator deletes it; automatic retention, contact verification, consent withdrawal tooling, and integration with Microsoft Forms/Spray-Network are not implemented. Set an appropriate retention schedule and access policy before collecting live data. Delete associated R2 photo/result objects as well as D1 records when fulfilling deletion requests. Keep Cloudflare request/body logging disabled or appropriately redacted; the Worker itself logs no PII or secrets.

## Verification

From the project root with Node.js 24 or newer:

```sh
node --test tests/backend.test.mjs
```

Tests use real in-memory SQLite to execute the schema/triggers, an in-memory R2 mock, and mocked renderer fetches. They cover ownership, CORS, consent, deduplication, retry recovery, concurrent quota reservation, refunds, daily caps, private media, CSV injection, and both renderer contracts. An integration test explicitly checks every consultation/session/photo/render route before registration, with no bearer, with a forged bearer, and with a different saved lead's bearer, and confirms rejected requests cause no provider calls or allowance consumption. Consultation tests cover invalid choices, both initial preferences, authenticated repeat requests, persistence, recovery, and export without fake booking status or render charges. The OpenAI adapter test also checks that an interior cabinet request uses a general surface-refinishing prompt. A real deployed Worker/R2/OpenAI end-to-end smoke test is still required after provisioning.
