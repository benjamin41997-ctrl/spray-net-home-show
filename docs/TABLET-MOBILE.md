# Tablet and mobile operation

The two one-page layouts share one private backend:

| Use | URL |
| --- | --- |
| Visitor phone/public QR | https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=mobile |
| Staffed tablet | https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=tablet |
| Staff calendar/export | https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html |

Mobile is the default. See [deployment status](DEPLOYMENT.md) before assuming current source is live. **No Microsoft/Entra access is required** for internal scheduling.

For an installed booth app, use **Install tablet app** in the tablet footer or the browser's home-screen installation menu, then launch its icon. It always starts in tablet mode, requests fullscreen with standalone fallback, and needs internet. Installed apps hide the installation control. [Android/iPad installation steps](INSTALL-APP.md).

## Capture, then schedule

Both initially require only **name and phone**. Email/address are optional for lead capture; **both a valid email and project address are required for consultation booking**, in the form and server. Saving a lead offers scheduling to unlock photos and visualizer. Only the backend-confirmed internal appointment unlocks; a contact preference/copied link does not.

On tablet, **Schedule consultation now** appears before the exclusive rewards message. The button, rewards, visualizer invitation, QR captions, and consultation day/time labels use larger type. The invitation moves its two portfolio examples beside the main panel to preserve room for the larger text. The mobile invitation order and type sizes are unchanged. The tablet studio also uses larger labels and includes Pure white; newly uploaded photos become active automatically.

Appointments are offered **October 26–November 8, 2026**, inclusive, every day in the 8:00 am–7:00 pm Eastern work window. Visitors see a **one-hour consultation** in the picker, confirmation and downloaded calendar. Internal reservations retain **90 minutes plus a 30-minute travel gap**, latest start **5:30 pm**. Staff blocks/app appointments reduce choices. This calendar does not read Outlook, so staff enter outside commitments as blocks. [Calendar instructions](CALENDAR-SETUP.md)

The rendering key is privately connected and an authorized GPT Image 2.5 Sunburst edit completed successfully. Offer: five successful renders per normalized phone/event. Attempt caps: ten per phone/event, 50/day sitewide, and 500/event sitewide. Durable usage survives deletion and recreation of a lead. Booking and provider readiness are separate requirements. Both layouts support native autofill and local address suggestions, with manual entry available.

Address suggestions start immediately at the first eligible prefix. New pages receive results progressively, so the first county's real matches appear while other sources are still loading. A pool of up to 60 real candidates narrows locally, with at most eight choices displayed. Short delays coalesce further network searches. Public GIS results are cached per provider/query at the server edge for ten minutes (empty results for 30 seconds), under hashed query keys without contact fields or credentials. Visitor-local suggestions clear with the tablet reset; shared cache entries contain only public address fields. Older cached pages still receive compatible JSON responses.

## Public and private QR

The public QR uses the current HTTPS page origin/path with ?mode=mobile, without a lead/token. Use it for signage. The standalone [public mobile QR SVG](mobile-qr.svg) encodes the production URL and its rendered SVG decoded independently. Recreate if the final URL changes; test physical prints/displays.

Scanning the public QR does not create a new unique URL or a lead. Separate phone browsers keep their form/pending work isolated; a successful submission creates its own unique lead ID and private token. Unsubmitted forms cannot overwrite another visitor's data. Returning on the same phone/browser resumes its saved project. Only a visitor-specific private QR resumes a particular saved lead; never use that QR as public signage.

The tablet's same QR switches to the visitor's private project immediately after lead submission, preserving #studio=<lead-id>.<visitor-token>. They can continue scheduling on their phone, or open their already-unlocked visualizer after booking. It is **bearer access**, not an unlock flag. Show only its visitor, let them retain it, and clear before the next tablet user. Never publish, batch-export, log, or send its payload to analytics. The page scrubs the fragment and verifies against the trusted configured API.

While scheduling on a tablet, the calendar fills a wider right column. The visitor's private project QR and two project photos occupy the left column; the third photo returns on the lead-entry screen. Dates use seven columns on landscape tablets, and times use seven or eight columns according to screen width. Address/email and the selected-time/confirmation controls share rows. Buttons retain at least 44-pixel touch targets in the short-screen layout. The header Next visitor control is the only reset control; there is no second QR or lower Done/copy-link section. Narrow screens, browser zoom, and the on-screen keyboard can still scroll rather than clipping controls.

The tablet visualizer uses a full-width top panel with upload at the top of the left column and larger uploaded-photo selectors below, beside colors and surface choices. Its QR stays on the saved-project screen; choose Back to reach the personalized phone handoff. Generated previews fill the bottom row, sharing its width equally as images are added up to five. Each keeps View larger and Save image controls; the result dialog is unchanged. Two portfolio photos occupy the bottom row until the first generated image is available. The entry screen keeps its three-photo row. Mobile and narrow layouts retain media in the normal studio order. Closing/resetting the studio restores the original result node without copying it.

On either consultation screen, **These times don’t work for me** flags the existing lead for a scheduling call. The visitor sees “I’ll reach out to schedule a convenient time.” It works without the address/email needed to confirm a specific time, survives reopening, and keeps the visualizer locked. Refresh can reopen available times; a later confirmed booking clears the callback request. Staff still manually choose Next visitor on the tablet.

Browser layout checks using synthetic example photos passed at 1024×768 and 960×600, including three uploaded-photo controls and five saved previews: page height matched the viewport and Create remained visible. One, three and five generated images adapt to the shared bottom row. A portrait tablet at 820×1180 also fit without horizontal or page overflow. Mobile at 390×844 keeps photos/results in their original homes without horizontal overflow. Zoom and smaller windows may still need natural scrolling.

QR generation uses the local MIT encoder: DOM SVG, black/white, medium error correction, four-module white margin. No URL/token goes to a QR service. Keep codes square, preserve margins, and do not cover modules with logos.

On mobile, the thank-you and home-show rewards invitation lead to a large scheduling button, with the visualizer benefit below it. The project-link section is hidden. The browser remembers only the private lead ID/token and configured API origin in local storage, so returning in another tab works without re-entering contact details. Contact data and pending request payloads remain tab-scoped. Kiosks never read/write this persistent mobile access. Clearing browser data removes saved access; storage does not transfer access between devices.

No automatic project-link email/text or appointment email is sent. The owner calendar can prepare a confirmation email in the owner's email app for review and sending from ben.hessler@spray-net.com. Automatic sending requires an authorized sending connection; the proposed HighLevel workflow needs account-admin setup because the current workflow screen is view-only. See [confirmation integration](CONFIRMATION-INTEGRATION.md). Only the mobile visitor page offers a **one-hour** .ics appointment download; the tablet does not show/create this download. Staff calendar exports preserve the internal reservation and travel gap.

Visualizer surfaces allow multiple selections: Cabinets, Siding, Fascia, Gutters and downspouts, Windows, Front door, Garage door and frame. The selected color applies to all chosen visible surfaces in a single request, using one render credit. Window glass is preserved. Existing single-surface pending requests remain retryable.

## Shared tablet routine

1. Open tablet mode; confirm event label, connection, and public QR.
2. Capture name/phone with the visitor, or offer their phone through the public QR.
3. After capture, offer consultation scheduling now, or the personalized QR for visitors who prefer completing the flow on their own phone.
4. After a tablet booking, have them scan their private project QR before staff clears the tablet with the header next-visitor control. Verify the blank form and no previous private QR/photos. The tablet does not reset automatically.
5. Keep a staffed fallback for network failure. A preview/timeout is not proof of a saved lead/booking.

Owner access uses the same email/password and saved session as the review portal. It persists across reloads, page closure and inactivity; explicit sign-out clears the shared session on this browser. Keep the separate operator key and any private access files outside Git/public output and visitor forms. Downloaded CSV/calendar files still need private handling.

Next-visitor/Done actions are bound only in tablet mode and are disabled/hidden on mobile. **Neither version has an inactivity reset.** Staff must manually reset the tablet after each visitor. Manual reset clears the tablet session, removes private URL fragments, explicitly retains ?mode=tablet, and restores the tablet entry layout. Tablet and mobile tab storage use separate keys, even when switching modes in the same browser tab. Resetting the tablet does not delete a saved lead or erase a phone's saved project.

## Verification

Run node --test tests/qr.test.mjs for reference matrices, fragment preservation, accepted schemes, DOM SVG, and quiet zones. Public/synthetic private matrices decoded independently with the existing jsQR library; no customer token used.

QR permits HTTPS or loopback-only HTTP for development. A phone scanning localhost reaches itself, so cross-device tests need an authorized HTTPS page. Private links require HTTPS.

Test actual iPhone/Android cameras, brightness/size, keyboard autofill, required/optional fields, pending retries, cancellation relocking, and reset with delayed requests. Block outside commitments before opening real slots. Staff Outlook downloads add 30 minutes travel; imports never sync later edits/cancellations.
