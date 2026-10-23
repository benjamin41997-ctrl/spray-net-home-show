# Setup and operating guide

The public GitHub Pages frontend and private Cloudflare Worker are separate deployments. D1 holds leads/appointments and private R2 holds photos/results. See [DEPLOYMENT.md](DEPLOYMENT.md) for released capabilities. The new internal scheduler does not require Microsoft/Entra. Local public/config.js remains disconnected; GitHub Actions injects the production API_BASE_URL. No runtime credentials or customer data belongs in public files.

## Current workflow

Visitors submit name/phone, with optional email/address, then book a consultation to unlock the visualizer. A valid email and project address are required at booking. Server availability checks and an authoritative D1 appointment confirm access; a lead/contact preference/redirect cannot unlock it. All photo/media/render endpoints check the booking.

Consultations start **Monday, October 26, 2026** (BOOKING_START_DATE=2026-10-26), run **90 minutes**, **all seven days 8:00 am–7:00 pm Eastern**, with **30-minute travel gaps**. Latest visit start is **5:30 pm**. Actual outside appointments are staff blocks; Outlook placeholders named “BLOCK” are intentionally left bookable, per the user's schedule instructions.

The user's rendering key is configured privately, and an authorized GPT Image 2.5 Sunburst edit completed successfully. Five successful renders per normalized phone/event, ten attempts per phone/event, 50 daily attempts sitewide, and 500 attempts per event sitewide are enforced server-side. Durable usage survives lead deletion; failed requests restore the credit but still count toward attempt caps. RENDER_ENABLED=true enables generation; false pauses it without changing lead capture or scheduling.

## Frontend and modes

- ?mode=mobile is the visitor phone layout and default.
- ?mode=tablet is the staffed kiosk; its single QR opens public mobile capture initially, then the active visitor's private project after submission. Next visitor restores the public QR.
- admin.html is the owner calendar/export page, protected by the existing review-portal account.
- Private project QR/links resume an existing lead. Their #studio= fragment carries bearer access and never bypasses booking checks.

QR generation is entirely local. Keep private QR/links out of logs, analytics, public signage, and third-party QR services. The page scrubs/verifies access fragments using the trusted configured API. Visitors save/scan their private link themselves; no automatic email/SMS delivery exists. [Tablet/mobile routine](TABLET-MOBILE.md)

## Staff access and scheduling

The owner page uses the review portal's existing email/password account and saved Supabase session, with automatic refresh and no inactivity timeout. The Worker verifies each provider token and requires the confirmed OWNER_EMAIL. Temporary connection errors keep the saved sign-in. Explicit sign-out clears this browser's shared review/owner session and aborts private requests. Passwords and ADMIN_TOKEN are never stored in browser storage or public source. Configure SUPABASE_URL, the public SUPABASE_PUBLISHABLE_KEY, and OWNER_EMAIL on the Worker. [Owner access details](OWNER-PORTAL.md)

If a separate local staff-access file is provided, keep it private, outside Git, with its restricted local permissions. It must never be published or copied into the repository. The page itself can be public because the API requires authentication; its URL is not a substitute for a key.

The app does not read/sync Outlook. Add actual outside commitments to staff blocks, while leaving the user's “BLOCK” placeholders bookable. Internal cancellation does not remove an imported Outlook event. Visitors see a one-hour visit; only mobile offers the visitor calendar download. Staff files reserve 120 minutes including travel. Import manually, check the duration, and update both calendars when a real appointment changes. No automatic invitations are sent in internal mode; the owner calendar prepares a confirmation email draft for manual sending. [Calendar instructions](CALENDAR-SETUP.md), [pending automatic confirmation setup](CONFIRMATION-INTEGRATION.md)

## Backend configuration

Existing production resources are already recorded in backend/wrangler.jsonc. Do not recreate them to deploy an update. Public server variables:

| Variable | Intended value/purpose |
| --- | --- |
| ALLOWED_ORIGINS | Exact page origin, without path or trailing slash. |
| EVENT_ID | Stable per-show credit/deduplication boundary. |
| FREE_RENDERS | 5 successful renders per normalized phone/event. |
| PHONE_RENDER_ATTEMPT_LIMIT | 10 attempts per normalized phone/event, including failed requests. |
| DAILY_RENDER_LIMIT | 50 provider attempts per UTC day. |
| EVENT_RENDER_LIMIT | 500 attempts per event sitewide. |
| OPENAI_IMAGE_MODEL | gpt-image-2.5-sunburst |
| LEADS_PER_IP_HOUR | 300 for venue/shared IPs. |
| BOOKING_PROVIDER | internal |
| BOOKING_START_DATE | 2026-10-26 |
| BOOKING_DURATION_MINUTES | 90 |
| BOOKING_BUFFER_MINUTES | 30 |
| BOOKING_WORK_START / BOOKING_WORK_END | 08:00 / 19:00 |
| BOOKING_WORK_DAYS | 0,1,2,3,4,5,6 |
| BOOKING_HORIZON_DAYS | Future slot window. |
| BOOKING_MIN_NOTICE_MINUTES | Minimum lead time before booking. |
| CONSENT_VERSION | Version of contact/photo-use wording. |

ADMIN_TOKEN and RATE_LIMIT_SALT are separate random server secrets. Renderer credentials remain Worker secrets. OPENAI_API_KEY selects the direct image adapter; alternatively RENDER_API_URL plus RENDER_API_KEY selects the HTTPS custom adapter. Incomplete custom settings disable rendering rather than falling back. Never put them in a Pages variable or public file.

## Existing-database migration

Pause writes and record a D1 recovery point before updating an older schema. Inspect schema metadata, then select the applicable migrations; never blindly rerun them.

~~~sh
npx wrangler d1 execute spray-net-home-show --remote --command "PRAGMA table_info(leads);" --config backend/wrangler.jsonc
npx wrangler d1 execute spray-net-home-show --remote --file backend/migrations/0002_phone_identity_booking.sql --config backend/wrangler.jsonc
~~~

0002 is a one-time upgrade for the pre-phone lead schema. It preserves IDs/tokens/media, records unknown legacy capture mode, introduces phone identity and booking tables, and preserves existing legacy phone duplicates. New submits look up normalized phones across legacy/new rows. A fresh current database uses schema.sql instead; do not apply 0002 afterward. CREATE TABLE IF NOT EXISTS alone does not update old columns/constraints.

For an existing upgraded database, add the internal blocked-time table using 0003:

~~~sh
npx wrangler d1 execute spray-net-home-show --remote --file backend/migrations/0003_internal_schedule_blocks.sql --config backend/wrangler.jsonc
~~~

Review recovery state and schema first, and never drop the operating lead table. Fresh current schema.sql already includes the internal table.

Existing databases also need `0007_durable_render_quotas.sql` before deploying the matching Worker. It preserves used renders when increasing the allowance from three to five. The Worker enrolls legacy phone/event usage before a session, render, or owner deletion; the minimal hashed quota records survive deletion of lead/media records. Fresh current schema.sql already includes these quota tables and triggers. See [VISUALIZER.md](VISUALIZER.md) for migration and limit details.

~~~sh
npx wrangler deploy --config backend/wrangler.jsonc
~~~

GET /api/health reports storage/schema readiness and configured capabilities. Test current source plus matching schema; a health flag does not prove render output quality. GitHub main pushes run checks/tests/build and publish only with PUBLISH_PAGES=true. Worker code/schema updates remain separate from Pages publication.

For local Worker development, copy backend/.dev.vars.example to ignored backend/.dev.vars, initialize a local D1 with --local, and run Wrangler separately from npm run dev. Do not reuse production records/keys in screenshots or UI tests.

## CSV and corporate follow-up

Use the admin page's **Download leads CSV** or protected GET /api/admin/leads.csv with the administrator bearer header. Never put that token in a URL/bookmark. Exports include name/contact/address/project fields, capture_mode, consultation_preference, event/consent, remaining credits, and media counts; they exclude visitor access tokens/image bytes.

CSV cells are escaped against spreadsheet formulas. The exact Spray-Network import mapping still needs the official template and synthetic import test. The shorter name/phone form intentionally differs from corporate's full survey: agree how missing fields are completed during follow-up and obtain the needed business-coach process alignment. Follow up within the procedure's 24-hour window.

## Acceptance and privacy

1. Test real mobile/tablet cameras, public/private QR, autofill, and name/phone-only submission.
2. Verify slots cover October 26–November 8 inclusive, use the seven-day 8–7 Eastern work window, last start 5:30, and respect actual blocks/90-minute internal reservations/30-minute gaps. Visitor displays/downloads show one hour. “BLOCK” placeholders stay available.
3. Test retrying the same lost-response booking, competing requests, private-link recovery, and staff cancellation. Unbooked/cancelled leads must remain locked on every media/render route.
4. Test owner password login, saved-session restore/refresh, explicit logout, connection recovery, CSV download, and visitor/staff calendar files. A downloaded calendar is not a live invitation/sync.
5. Check current renderer with one authorized synthetic image request and inspect output before relying on quality. Configured credits/budgets do not prove provider access.
6. Have visitors retain private project links before kiosk reset. Verify delayed responses cannot restore the previous visitor's details.
7. Add business privacy/contact and deletion/retention procedures. No scheduled purge exists; D1/media deletion must be coordinated. Store downloads privately.
8. Check venue connectivity and keep a staffed/Microsoft Form fallback. There is no offline submission queue.

No corporate Microsoft authorization is needed for this internal workflow. The optional future Graph adapter/operator utility is described separately in [CALENDAR-SETUP.md](CALENDAR-SETUP.md); do not run it without a new opt-in and required tenant permission.
