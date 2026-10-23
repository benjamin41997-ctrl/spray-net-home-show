# Owner portal

Open `https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html` and use the same email/password as the Spray-Net review portal. An existing review-portal sign-in on this GitHub Pages origin is reused automatically. Password setup/reset remains in the review portal; the owner page links to it and never sends a reset email automatically.

The official Supabase client persists and refreshes the session under the review portal's `spraynet-review-admin` storage key. Reloads, page closure and inactivity do not sign the owner out. Temporary connection failures preserve sign-in and allow retry. Explicit sign-out clears the shared browser session, including other open portal tabs. Passwords and the private operator key are never stored in browser storage. Provider expiry/revocation or clearing browser data can require a new sign-in. [Provider session behavior](https://supabase.com/docs/guides/auth/sessions).

Every owner API request verifies the provider token server-side and requires the confirmed `OWNER_EMAIL`. Local session contents and visitor project tokens do not grant owner access. Configure `SUPABASE_URL`, its public `SUPABASE_PUBLISHABLE_KEY`, and `OWNER_EMAIL` on the Worker. Only the URL/publishable key belong in public config. The separate `ADMIN_TOKEN` remains a private operator/export credential, outside the website login; keep its protected local access file private and outside Git. Search, stage filters and 50-row pages cover all saved leads; CSV export retains its existing import columns.

## Delete a test lead

Each lead card has a **Delete lead** button with a confirmation naming the lead and phone number. This permanently removes that lead, internal booking, photos, visualizations and visit history, revokes its old project link, and frees the phone number for another submission. On a booth tablet, choose **Next visitor** to start again; refreshing a visitor page also clears deleted saved access and opens a new form.

Deletion is refused while a visualization or unresolved booking is running. A linked external Outlook appointment must be cancelled separately before deletion. Global daily rendering-attempt counts are retained, so deleting a lead does not bypass the API spending cap. Private photo/render cleanup is retried from a queue if storage is temporarily unavailable; the dashboard reports pending cleanup. This queue contains object keys and a lead ID, without customer contact details or access tokens.

Deleting a lead also preserves minimal hashed phone/event render usage. Re-registering the same phone does **not** restore used credits or failed-attempt budget. The current allowance is five total successful images, with 10 attempts per phone/event, 50 site-wide attempts per UTC day and 500 per event. The same allowance follows the visitor's personalized tablet QR to their phone. The single QR returns to public capture when staff choose Next visitor. [Quota and handoff details](VISUALIZER.md).

Apply `backend/migrations/0005_lead_deletion_cleanup.sql` before deploying the deletion API. The cleanup manifest and lead deletion commit in one transaction; incomplete media cleanup cannot keep a phone number blocked or restore old project access.

## Weekly calendar

The [Calendar view](https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html?view=calendar) opens a Monday–Sunday time grid. Previous/next week, Today and Go to date navigate the private schedule. A `date=YYYY-MM-DD` URL parameter can open a particular week directly. All dates and times are Eastern, including the November clock change. The server reads the selected week, including historical entries and multi-day blocks, rather than filtering only upcoming appointments in the browser.

Blue blocks show the full internal consultation reservation (normally 90 minutes), amber striped blocks show the reserved travel gap (normally 30 minutes), gray shows unavailable time, and yellow shows pending consultations. A full-day closure appears under the day heading. Overlapping items use separate columns. The calendar scrolls vertically for additional hours and horizontally on phones.

Click a consultation or its travel gap to see customer contact/location details, one-hour customer time, the longer staff reservation, directions, email/text drafts and cancellation. **Route from previous consultation** uses the most recent earlier confirmed consultation with an address on that Eastern day, when available. Directions open Google Maps only when clicked; there is no automatic routing lookup or live drive-time estimate. [Google Maps URL behavior](https://developers.google.com/maps/documentation/urls/get-started).

Click an unavailable block to inspect its private note or remove it. Expand **Manage consultations & unavailable time** below the grid to add blocks or use the detailed list. This view includes website bookings and saved staff blocks; it does not read or synchronize Outlook. Staff must continue adding outside commitments.

## Send confirmation from your phone

Open the owner portal on your phone and sign in with your existing review-portal account. Confirmed appointments have **Draft email** and **Draft text** on both the lead card and Calendar card. Each draft includes the customer's first name, saved project address, appointment date and start time. Times are calculated using America/New_York internally, but the messages include no end time, duration or timezone label.

- **Draft email:** opens your configured email app with the recipient, subject and message. Choose **ben.hessler@spray-net.com** as the sender, review and send. A website mail link cannot choose the From account or authorize that mailbox. If needed, open Outlook yourself and copy the recipient, subject and message below the buttons.
- **Draft text:** opens your phone's messaging app with the customer's number and a prepared confirmation. Send from your personal/default line, or choose the line you want on a dual-SIM phone. The website does not need your personal phone number, a texting API key, or HighLevel editing access.
- **View or copy messages:** shows read-only drafts with copy buttons for the email recipient, subject, message, phone number and text message. If copying is denied, the portal selects the text for manual copying. This also works when a desktop has no SMS handler or a phone handler ignores the message body.

Clicking **Draft email** or **Draft text** saves a separate first-open timestamp with the current consultation. After saving, that button turns gray and reads **Email drafted** or **Text drafted**, with the saved Eastern time below. The buttons stay clickable to reopen drafts. Markers are shared by the lead list, calendar list and appointment detail dialog, and persist across refreshes and devices after the next portal load/refresh. A new booking transaction starts unmarked; deleting a lead deletes its markers. A failed marker save restores the original label and displays an error so it is not mistaken for a saved action. Copy buttons do not mark drafts opened.

These are manual compose actions: always review and tap Send in your email or messaging app. **Drafted records a compose click, not verified sending or delivery.** The portal cannot see replies; they stay in the email account/phone line used to send. No automatic messaging provider or Microsoft Mail.Send authorization is connected. The [future automation setup](CONFIRMATION-INTEGRATION.md) is optional; it is not needed for this manual workflow. Staff Outlook exports retain the longer internal reservation and travel gap.

Email confirmations include the **Home Show Deal** on kitchen cabinet refinishing: $250 off $3,000–$4,999; $500 off $5,000–$6,999; $750 off $7,000–$8,999; $1,000 off $9,000+. They include no visualizer offer, rescheduling invitation or added signature; the owner's email app manages their custom signature. SMS confirmations also omit the rescheduling line.

Apply `backend/migrations/0006_confirmation_drafts.sql` before deploying the corresponding Worker. Its additive table stores only a lead ID, booking transaction ID, channel and server timestamp. An authenticated, idempotent owner POST verifies the current confirmed booking before recording a marker. The browser keeps this small write alive during mail/SMS app handoff; stale responses cannot repaint a signed-out portal.

Draft data is created only from the private, authenticated owner response. No contact data is sent to a draft-generation service, and visitor access tokens are excluded from the messages. Opening a draft passes the recipient and content to the app chosen by the owner; copying uses the device clipboard.

## Lead progress

- **Lead received:** contact form was saved.
- **Scheduling started:** the visitor chose to schedule but has no confirmed booking.
- **Booking pending:** a booking is still being confirmed.
- **Consultation booked:** the database has a confirmed consultation, which unlocks the visualizer.
- **Photos uploaded:** a booked visitor has a ready uploaded photo.
- **Visualizations created:** a booked visitor has at least one completed render.
- **Consultation cancelled:** cancellation takes precedence over prior media activity and relocks access.

Stages are derived from saved records. Upload and render totals remain visible even if a consultation is later cancelled. A failed or pending render is not counted as completed. These are website progress stages, not Spray-Network sales or job-completion statuses.

## Visits

An authenticated visit is recorded when the saved-project page is shown, including the initial successful submission and reopening a private link or saved session. A fresh page load creates a new random visit ID; retries with the same ID count once. Moving between steps on that page, background session checks and owner-portal reads do not add visits. On the booth tablet, Next visitor clears the recorder and generates a fresh ID. A failed tracking request never blocks lead submission, scheduling or image access.

Last project open is the server time of the latest recorded visit. It is not a continuous online/presence indicator. No visitor IP address, browser fingerprint, third-party analytics identifier or extra tracking cookie is stored. No earlier visits are backfilled. The portal shows when tracking began; legacy leads display zero recorded visits and no last-open time until they return.

Migration `backend/migrations/0004_owner_activity.sql` adds visit records and the tracking start timestamp without modifying existing leads, tokens, bookings, photos or renders. Apply it before deploying the new API. Queries use authenticated primary D1 sessions and no-store responses.
