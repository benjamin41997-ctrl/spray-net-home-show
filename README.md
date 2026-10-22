# Spray-Net home show lead capture

A mobile-first lead and consultation-request form for Spray-Net South Charlotte, with an optional private photo color studio after submission. Saving a lead by itself or saving a lead with a consultation request both unlock the same three-render allowance. Visitors can return later to add photos and explore colors once the private API and rendering provider are configured. The visitor pays nothing; the business pays its rendering and hosting providers.

The source is stored in the public [benjamin41997-ctrl/spray-net-home-show](https://github.com/benjamin41997-ctrl/spray-net-home-show) repository. The production page is [Spray-Net home show](https://benjamin41997-ctrl.github.io/spray-net-home-show/). Its dedicated Cloudflare Worker stores leads in D1 and photos in a private R2 bucket. GitHub repository variables set `PUBLISH_PAGES=true` and the public `API_BASE_URL` for production builds. Local `public/config.js` keeps an empty API origin for a disconnected design preview. Image generation is disabled pending provider-key and billing approval. A live booking calendar is not connected; consultation requests are saved for team follow-up.

## Visitor flow

1. Choose a service and approximate project timeline. No photo is needed at the booth.
2. Enter contact details and the project address, then choose **Submit my project** or **Submit & request a consultation**. Either saves the lead and unlocks the private studio.
3. The confirmation screen prioritizes arranging a consultation. A consultation request records a follow-up preference; it does not reserve a calendar slot or confirm an appointment. A verified booking-calendar link can be configured separately.
4. Copy the private studio link to save for later, or open the optional studio immediately. Photos can only be added after the lead is saved. A public booth QR opens the lead form, not an unlocked studio.

Private studio links require the eventual HTTPS page URL. The link's fragment carries the saved lead ID and visitor bearer token; anyone with the link can access that project's photos and visualizations. The app scrubs the fragment from the address bar and verifies the token against the API from trusted site configuration. Save the copied link privately and transfer it to the visitor's phone before clearing a shared booth device. The application does not send email, SMS, or an email magic link. Its `sessionStorage` recovery covers the current browser tab, not automatic access on another device.

## Run locally

Use Node.js 22.13 or newer (Node 24 is recommended). There are no frontend or test package dependencies to install.

```sh
npm run dev
```

Open http://localhost:4173. The server is local-only and serves `public/`; it does not emulate successful submissions or rendering.

```sh
npm run check
npm test
npm run build
```

`check` verifies JavaScript syntax, referenced local HTML/CSS/module assets, and obvious committed credentials. Tests exercise contact mapping, upload constraints, private-media URL confinement, lead validation, private media authorization, CSV escaping, and server-side render limits using Node's in-memory SQLite. These checks do not replace testing against deployed Cloudflare services and the selected rendering provider.

`build` copies `public/` to `dist/`. Set `API_BASE_URL` to an absolute HTTPS API origin to override only `apiBase` in the generated public config. An empty value keeps preview mode. Secrets are never copied from environment variables into the site.

## What is included

- Responsive project, contact, and consent flow with mobile autofill hints; separate consultation confirmation and optional studio screens.
- Two submission choices with the same studio access, plus a consultation request action after a lead-only submission.
- Private HTTPS studio resume links and current-tab session recovery; no automated delivery or identity-verification email.
- Optional saved-contact picker when the visitor's browser supports it and the visitor approves sharing. Other devices use autofill/manual entry.
- Photo uploads behind a saved lead, with up to three photos shown in the studio, each JPEG/PNG/WebP and at most 10 MB.
- Color selection, surface selection, private image retrieval, and downloadable completed visualizations.
- A Cloudflare Worker API with D1 lead records and private R2 photos/renders.
- Three successful renders per normalized email and server-defined event. Database triggers reserve credits and the daily attempt budget atomically. Failed renders restore visitor credit; daily attempts remain counted because provider costs can still occur.
- Exact-origin CORS, bearer-protected sessions/media, server-only provider credentials, retry-safe lead/render requests, lead creation throttling, and administrator CSV export including consultation preference.
- GitHub build/test workflow using official actions; Pages artifact upload and deployment remain gated by `PUBLISH_PAGES == 'true'`.

## Connect and publish

Follow [docs/SETUP.md](docs/SETUP.md) for configuration and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the current production URLs and verified capabilities. Public repository visibility and GitHub Pages deployment were explicitly approved.

All frontend assets use relative paths for GitHub project Pages. Branding and existing portfolio asset provenance are recorded in [docs/MEDIA-SOURCES.md](docs/MEDIA-SOURCES.md).

## Before the home show

The form keeps name, email, phone, project address, and service interest. The provided corporate procedure allows event-detail changes and asks franchisees to consult their business coach for other customization. Confirm the alternative collection flow against that procedure before using it for real leads. The export is a useful administrative CSV, but an exact Spray-Network import mapping still needs a sample import template; no unverified import compatibility is claimed.

Set the actual show label and stable backend event ID, add a business privacy contact/policy and retention procedure, and connect and test the API. Keep `bookingUrl` empty until a real consultation calendar is verified; a generic quote-request page is not confirmed scheduling. After publication is authorized and a live HTTPS URL is verified, generate its public booth QR. Test on actual iPhone/Android devices and booth Wi-Fi. Have each visitor save their private studio link before using the finish/clear-device control on a shared booth device. Follow up within the corporate procedure's 24-hour window after the show ends.

Photo uploads and generation are online features. A network outage does not save a lead offline. Keep the existing Microsoft Form or a staffed capture process available as the operational fallback.
