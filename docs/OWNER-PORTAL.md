# Owner portal

Open `https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html` and enter the existing staff access key. The protected local access file is outside the public repository at `../home-show-staff-access.txt`. Never publish that file, put the key in a URL, or send it to visitors.

The key remains in tab memory, clears on sign-out/navigation, and expires after ten minutes without activity. Both dashboard and calendar require this key. Visitor project tokens cannot access owner records. Search, stage filters and 50-row pages cover all saved leads; CSV export retains its existing import columns.

## Delete a test lead

Each lead card has a **Delete lead** button with a confirmation naming the lead and phone number. This permanently removes that lead, internal booking, photos, visualizations and visit history, revokes its old project link, and frees the phone number for another submission. On a booth tablet, choose **Next visitor** to start again; refreshing a visitor page also clears deleted saved access and opens a new form.

Deletion is refused while a visualization or unresolved booking is running. A linked external Outlook appointment must be cancelled separately before deletion. Global daily rendering-attempt counts are retained, so deleting a lead does not bypass the API spending cap. Private photo/render cleanup is retried from a queue if storage is temporarily unavailable; the dashboard reports pending cleanup. This queue contains object keys and a lead ID, without customer contact details or access tokens.

Apply `backend/migrations/0005_lead_deletion_cleanup.sql` before deploying the deletion API. The cleanup manifest and lead deletion commit in one transaction; incomplete media cleanup cannot keep a phone number blocked or restore old project access.

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
