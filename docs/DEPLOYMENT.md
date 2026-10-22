# Production deployment

Website: https://benjamin41997-ctrl.github.io/spray-net-home-show/

API: https://spray-net-home-show-api.spray-net-south-charlotte.workers.dev

The repository and frontend are public. Visitor contacts, photos, and completed images remain in the dedicated D1 database and private R2 bucket. Provider/API credentials are never part of the public build.

## Current verification

The matching database migrations and internal booking Worker are deployed. Production checks passed for name/phone-only capture, the October 26 start date, confirmed internal booking, retries without duplicate appointments, privately authenticated photo upload/read, staff schedule and CSV access, and immediate studio revocation after cancellation. The disposable test lead, reservation, and photo were removed. These checks made no paid rendering request.

The frontend source provides one-page tablet/mobile capture, staff administration/CSV, local QR handoff, and confirmed-booking studio access. GitHub Actions checks, tests, builds, and publishes this source when it is pushed to main.

Event ID is home-show-2026-10. Change it for the next real show. The shared-IP lead limit is 300/hour, to support booth devices/hotspots; the global rendering cap is 50 attempts per UTC day.

No corporate Microsoft/Entra connection is required. Availability begins Monday, October 26, 2026, all seven days 8:00 am–7:00 pm Eastern, with 90-minute visits, a 30-minute travel gap, and latest visit start 5:30 pm. Twenty-five actual outside events from the user's calendar screenshots were saved privately as staff blocks using the user-approved durations. Outlook placeholders named “BLOCK” intentionally stay bookable. Meeting details are not in this public repository.

Internal booking is authoritative for this app and does not read/sync Outlook or send invitations. The staff page can download appointments with 30 minutes added for travel for manual Outlook import. Changes/cancellations must be updated manually in the other calendar. See [calendar setup](CALENDAR-SETUP.md).

The renderer key is server-only and connected with user approval. After fixing a Cloudflare redirect-mode incompatibility, an authorized live image request completed successfully and returned a usable JPEG. The test consumed exactly one visitor credit, cancellation revoked access, and its temporary online lead, booking, and images were removed. Generation is enabled with RENDER_ENABLED=true. Three successful renders per normalized phone/event and 50 daily attempts remain the configured limits. Earlier local-runtime failures occurred before the image provider was contacted.

Local address suggestions are deployed from NCOneMap, York County SC, and Lancaster County SC, without paid API credentials. Live searches returned the actual Belmont address with city/state/ZIP. Only name and phone are marked Required; the contact and booking forms keep native browser autocomplete enabled. Selected address parts are saved atomically with a booking, and manual edits clear stale parts. See [source coverage and usage](ADDRESS-AUTOCOMPLETE.md).

Staff access uses the separate administrator key, entered only in the admin page and held in tab memory. A separately supplied local access file must remain private/outside Git and must never be published. No access value belongs in these deployment notes.

## Administration

Cloudflare OAuth can administer/export the D1 database using Wrangler. The API admin credential is stored only as a Worker secret; rotate ADMIN_TOKEN through Wrangler when a new authenticated API export session is required, and keep the chosen value in an appropriate password manager. Do not commit admin tokens, visitor tokens, or exported leads.

GitHub Pages deployment uses repository variables PUBLISH_PAGES=true and API_BASE_URL=https://spray-net-home-show-api.spray-net-south-charlotte.workers.dev. Changes to main run checks/tests and publish dist.
