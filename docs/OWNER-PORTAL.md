# Owner portal

Open `https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html` and use the same email/password as the Spray-Net review portal. An existing review-portal sign-in on this GitHub Pages origin is reused automatically. Password setup/reset remains in the review portal; the owner page links to it and never sends a reset email automatically.

The official Supabase client persists and refreshes the session under the review portal's `spraynet-review-admin` storage key. Reloads, page closure and inactivity do not sign the owner out. Temporary connection failures preserve sign-in and allow retry. Explicit sign-out clears the shared browser session, including other open portal tabs. Passwords and the private operator key are never stored in browser storage. Provider expiry/revocation or clearing browser data can require a new sign-in. [Provider session behavior](https://supabase.com/docs/guides/auth/sessions).

Every owner API request verifies the provider token server-side and requires the confirmed `OWNER_EMAIL`. Local session contents and visitor project tokens do not grant owner access. Configure `SUPABASE_URL`, its public `SUPABASE_PUBLISHABLE_KEY`, and `OWNER_EMAIL` on the Worker. Only the URL/publishable key belong in public config. The separate `ADMIN_TOKEN` remains a private operator/export credential, outside the website login; keep its protected local access file private and outside Git. Search, stage filters and 50-row pages cover all saved leads; CSV export retains its existing import columns.

## Delete a test lead

Each lead card has a **Delete lead** button with a confirmation naming the lead and phone number. This permanently removes that lead, internal booking, photos, visualizations and visit history, revokes its old project link, and frees the phone number for another submission. On a booth tablet, choose **Next visitor** to start again; refreshing a visitor page also clears deleted saved access and opens a new form.

Deletion is refused while a visualization or unresolved booking is running. A linked external Outlook appointment must be cancelled separately before deletion. Global daily rendering-attempt counts are retained, so deleting a lead does not bypass the API spending cap. Private photo/render cleanup is retried from a queue if storage is temporarily unavailable; the dashboard reports pending cleanup. This queue contains object keys and a lead ID, without customer contact details or access tokens.

Apply `backend/migrations/0005_lead_deletion_cleanup.sql` before deploying the deletion API. The cleanup manifest and lead deletion commit in one transaction; incomplete media cleanup cannot keep a phone number blocked or restore old project access.

## Send confirmation from your phone

Open the owner portal on your phone and sign in with your existing review-portal account. Confirmed appointments have **Draft email** and **Draft text** on both the lead card and Calendar card. Each draft includes the customer's first name, saved project address, Eastern date and one-hour customer appointment time.

- **Draft email:** opens your configured email app with the recipient, subject and message. Choose **ben.hessler@spray-net.com** as the sender, review and send. A website mail link cannot choose the From account or authorize that mailbox. If needed, open Outlook yourself and copy the recipient, subject and message below the buttons.
- **Draft text:** opens your phone's messaging app with the customer's number and a prepared confirmation. Send from your personal/default line, or choose the line you want on a dual-SIM phone. The website does not need your personal phone number, a texting API key, or HighLevel editing access.
- **View or copy messages:** shows read-only drafts with copy buttons for the email recipient, subject, message, phone number and text message. If copying is denied, the portal selects the text for manual copying. This also works when a desktop has no SMS handler or a phone handler ignores the message body.

These are manual compose actions: always review and tap Send in your email or messaging app. Opening/copying a draft does not mark it sent, and the portal cannot confirm delivery or see replies. Replies stay in the email account/phone line used to send. No automatic messaging provider or Microsoft Mail.Send authorization is connected. The [future automation setup](CONFIRMATION-INTEGRATION.md) is optional; it is not needed for this manual workflow. Staff Outlook exports retain the longer internal reservation and travel gap.

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
