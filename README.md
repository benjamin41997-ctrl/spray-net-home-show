# Spray-Net home show lead capture

A quick name-and-phone lead form for Spray-Net South Charlotte, with separate tablet-kiosk and mobile layouts sharing one private backend. Visitors can then book a consultation in the app's internal calendar. Only a confirmed server appointment unlocks photos and the five-render visualizer. **No corporate Microsoft/Entra connection is required.**

The public [source repository](https://github.com/benjamin41997-ctrl/spray-net-home-show) and [Pages address](https://benjamin41997-ctrl.github.io/spray-net-home-show/) use a dedicated Cloudflare lead API/D1/private R2. See [deployment status](docs/DEPLOYMENT.md) for release verification. Local public/config.js stays disconnected for previews; the production build receives API_BASE_URL from GitHub Actions. The rendering key is configured privately, and generation is enabled after a successful authorized live image test.

## Visitor and staff flow

1. Submit just a name and phone. Email/project address are optional, and no photo or appointment is needed to save the lead.
2. After saving, choose a consultation time and provide the required email and project address. The server confirms it in the internal calendar before unlocking the visualizer.
3. Consultations are offered **October 26–November 8, 2026**, **every day 8:00 am–7:00 pm Eastern**. The customer sees a **one-hour** visit; internally the scheduler reserves **90 minutes** plus a **30-minute travel buffer**. The latest visit starts at **5:30 pm**. Staff blocks and existing app bookings remove unavailable times.
4. The tablet's single QR opens the mobile form before submission, then switches to the active visitor's private project. A booked visitor can scan it to access the visualizer on their phone. Phones remember their own saved project. Staff use the top **Next visitor** button to clear the private QR and restore public capture; there is no second QR, copy-link section or lower Done button.

Use [mobile mode](https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=mobile), [tablet mode](https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=tablet), and [owner portal](https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html) for owner scheduling/export. The owner page reuses the review portal's email/password account and saved session, with automatic refresh and no inactivity timeout. It supports consultations, blocked time, cancellation, private CSV export, Outlook calendar-file downloads, and prepared email/text confirmations. [Owner sign-in and manual sending](docs/OWNER-PORTAL.md)

The internal calendar does not read/sync Outlook or automatically send messages. Confirmed appointments have **Draft email**, **Draft text**, and copyable messages on owner lead and calendar cards. Use the portal on a phone to send from your personal line; choose the Spray-Net sender in your email app. Opening a draft does not send it or record delivery. Staff must block outside commitments manually. Mobile visitors can download a one-hour .ics appointment; staff can download the longer internal reservation with 30 minutes added for travel and import it into Outlook manually. Edits/cancellations do not synchronize. See [calendar setup](docs/CALENDAR-SETUP.md).

Both contact forms support native browser autofill and local address suggestions using public NCOneMap, York County SC, and Lancaster County SC data. Only name and phone are required for a lead; address and email have no extra label. A selected address saves its city, state, and ZIP as separate CRM fields. Suggestions need no paid API account or key, and manual entry always works. See [address coverage and sources](docs/ADDRESS-AUTOCOMPLETE.md).

The visualizer uses photo, color and surface choices, with no custom-prompt field. New results open in a large Save image/Back to editing preview. Saved results can be viewed larger without spending another credit. [Visualizer behavior and current cost estimate](docs/VISUALIZER.md).

The tablet studio keeps the QR and portfolio/project images on the left and compact color/surface/Create controls on the right. Saved preview history scrolls within the left column. Browser checks with synthetic media verified one-screen layouts at 1024×768 and 960×600; mobile retains its original media placement.

The site installs as a tablet app, with branded home-screen icons and a public `?mode=tablet` launch. Use **Install tablet app** in the tablet footer, or the browser's installation menu. Supported devices use fullscreen, with standalone web-app view as a fallback. No customer data or app shell is cached by its service worker; internet is still required. [Installation steps](docs/INSTALL-APP.md).

Private project links carry a lead bearer token in the #studio= fragment. Anyone with one has that project's access; it is not a public marketing link or unlock flag. The page scrubs/verifies it and the server checks booking status. The tablet's existing QR displays this private handoff while a visitor is active. No automatic project-link email/SMS or magic-link service is included.

## Local development

Use Node.js 22.13 or newer; Node 24 is recommended. No frontend/test dependency installation is required.

~~~sh
npm run dev
npm run check
npm test
npm run build
~~~

The preview at http://localhost:4173 serves public/ and does not emulate live saves. The build copies assets to dist/ and accepts an absolute HTTPS API_BASE_URL override. Tests use synthetic records/mocked providers; they do not create real bookings, send messages, or spend rendering credits.

## Included

- One-page tablet/mobile capture with optional email/address, autofill hints, and retry-safe lead identity.
- Internal availability/booking, staff blocks/cancellation, and confirmed-booking checks on all studio/media operations.
- Local SVG public/private project QR generation, private HTTPS access, tab recovery, and shared-device reset.
- Private JPEG/PNG/WebP uploads up to 10 MB, color/surface choices, completed-image download, and failed-image retrieval.
- Five successful renders per normalized phone/event, durable atomic credit/attempt limits, and server-only image credentials. Failed renders restore visitor credit; attempts remain counted because charges may occur.
- Protected CSV export, exact-origin CORS, private R2, and no customer data or runtime secrets in public assets.
- GitHub checks/build/Pages workflow gated by PUBLISH_PAGES=true; Worker migrations/deployments remain separate.

Follow [SETUP.md](docs/SETUP.md), [tablet/mobile operation](docs/TABLET-MOBILE.md), and [calendar setup](docs/CALENDAR-SETUP.md). Asset provenance is in [MEDIA-SOURCES.md](docs/MEDIA-SOURCES.md).

## Before the show

Complete migration/deployment, staff access setup, outside-commitment blocks, and physical phone/tablet checks. Keep any separately supplied staff-access file private/outside Git and never publish it. The upgraded image model passed a live generation test. The allowance is five successful renders per normalized phone/event, with ten attempts per phone/event, 50 attempts/day sitewide, and 500 attempts/event sitewide.

The shortened form differs from the corporate procedure. Agree how missing CRM fields are completed during follow-up, obtain/test the exact Spray-Network import mapping, and follow up within the procedure's 24-hour window. Network loss is not an offline save; retain a staffed/Microsoft Form fallback.
