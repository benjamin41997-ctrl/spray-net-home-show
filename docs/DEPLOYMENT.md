# Production deployment

Website: https://benjamin41997-ctrl.github.io/spray-net-home-show/

API: https://spray-net-home-show-api.spray-net-south-charlotte.workers.dev

The repository and frontend are public. Visitor contacts, photos, and completed images remain in the dedicated D1 database and private R2 bucket. Provider/API credentials are never part of the public build.

## Current verification

The matching database migrations and internal booking Worker are deployed. Production checks passed for name/phone-only capture, the October 26 start date, confirmed internal booking, retries without duplicate appointments, privately authenticated photo upload/read, staff schedule and CSV access, and immediate studio revocation after cancellation. The disposable test lead, reservation, and photo were removed. These checks made no paid rendering request.

The frontend source provides one-page tablet/mobile capture, staff administration/CSV, a public mobile-form QR, and confirmed-booking studio access. Tablet confirmation has one top Next visitor control and no second QR, copy-link section or lower Done control. GitHub Actions checks, tests, builds, and publishes this source when it is pushed to main.

Event ID is home-show-2026-10. Change it for the next real show. The shared-IP lead limit is 300/hour, to support booth devices/hotspots; the global rendering cap is 50 attempts per UTC day.

No corporate Microsoft/Entra connection is required. Availability begins Monday, October 26, 2026, all seven days 8:00 am–7:00 pm Eastern, with 90-minute visits, a 30-minute travel gap, and latest visit start 5:30 pm. Twenty-five actual outside events from the user's calendar screenshots were saved privately as staff blocks using the user-approved durations. Outlook placeholders named “BLOCK” intentionally stay bookable. Meeting details are not in this public repository.

Internal booking is authoritative for this app and does not read/sync Outlook or send invitations. The staff page can download appointments with 30 minutes added for travel for manual Outlook import. Changes/cancellations must be updated manually in the other calendar. See [calendar setup](CALENDAR-SETUP.md).

The owner Calendar tab offers a Monday–Sunday time grid with week navigation, a date picker, separate consultation/travel/unavailable colors and clickable details with addresses/directions. The protected schedule endpoint accepts `week=YYYY-MM-DD` (a Monday) and reads the seven Eastern calendar days, including past records and DST boundaries. It includes a prior-week record only when its travel gap carries into the selected week. The old no-query upcoming schedule response remains available. This update needs no database migration and does not change booking durations, availability or messages.

Live authenticated, read-only checks passed for the weeks of October 19, October 26 and November 2. Responses retained `no-store`, invalid non-Monday week input returned 400, and unauthenticated schedule access returned 401. The calendar model successfully laid out all three responses without writing records. Automated tests cover Eastern/DST week bounds, week filtering, overnight/full-day blocks, overlapping event lanes, map URL encoding, click/auth guards and the single tablet QR/reset controls. Browser layout verification was unavailable in this session.

Confirmed lead and calendar cards provide manual **Draft email**, **Draft text**, and copyable message previews. Drafts include the one-hour customer appointment in Eastern Time; texts can be sent from the owner's personal phone line, and the owner selects the Spray-Net sender in their email app. The email includes the user-supplied **Home Show Deal** cabinet savings tiers, without a visualizer line, rescheduling invitation or site-added signature. The SMS also omits rescheduling text.

Apply additive migration `0006_confirmation_drafts.sql` before the updated Worker. Compose clicks save separate email/SMS first-open timestamps for the current booking transaction, turning buttons gray with **Email drafted**/**Text drafted** labels. The authenticated endpoint rejects stale or unconfirmed bookings and idempotently handles retries. Owner lead and calendar reads return the markers; visitor session responses omit them. Markers survive refresh/device changes, and deleting a lead cascades its markers. These controls do not send messages or record delivery. No HighLevel access or messaging credential is required. Actual app handoff/sending depends on the owner's device; no real email or SMS was sent for this update. See [owner instructions](OWNER-PORTAL.md#send-confirmation-from-your-phone).

The migration and Worker are deployed. Live authenticated owner reads verified draft metadata and `no-store` responses; the new write route rejected an absent synthetic booking with 409 and unauthenticated writes with 401. Those checks changed no customer records and sent no messages. All 190 automated tests passed, including separate/idempotent channel markers, stale booking rejection, fresh markers after a new booking transaction, deletion cleanup, shared-view updates, failed-save feedback and sign-out guards.

The renderer key is server-only and connected with user approval. After fixing a Cloudflare redirect-mode incompatibility, an authorized live image request completed successfully and returned a usable JPEG. The test consumed exactly one visitor credit, cancellation revoked access, and its temporary online lead, booking, and images were removed. Generation is enabled with RENDER_ENABLED=true. Three successful renders per normalized phone/event and 50 daily attempts remain the configured limits. Earlier local-runtime failures occurred before the image provider was contacted.

Local address suggestions are deployed from NCOneMap, York County SC, and Lancaster County SC, without paid API credentials. Live searches returned the actual Belmont address with city/state/ZIP. Only name and phone are required for initial lead capture; email and address are required before booking. The contact and booking forms keep native browser autocomplete enabled. Selected address parts are saved atomically with a booking, and manual edits clear stale parts. See [source coverage and usage](ADDRESS-AUTOCOMPLETE.md).

Owner access reuses the review portal's email/password account and persistent Supabase session. The Worker verifies tokens against the configured provider and requires the confirmed OWNER_EMAIL. Public config includes only the provider URL and publishable key. The separate operator ADMIN_TOKEN and protected local access file remain private/outside Git; no access value belongs in these deployment notes.

## Administration

Cloudflare OAuth can administer/export the D1 database using Wrangler. The API admin credential is stored only as a Worker secret; rotate ADMIN_TOKEN through Wrangler when a new authenticated API export session is required, and keep the chosen value in an appropriate password manager. Do not commit admin tokens, visitor tokens, or exported leads.

GitHub Pages deployment uses repository variables PUBLISH_PAGES=true and API_BASE_URL=https://spray-net-home-show-api.spray-net-south-charlotte.workers.dev. Changes to main run checks/tests and publish dist.
