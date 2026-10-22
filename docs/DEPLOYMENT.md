# Production deployment

Website: https://benjamin41997-ctrl.github.io/spray-net-home-show/

API: https://spray-net-home-show-api.spray-net-south-charlotte.workers.dev

The repository and frontend are public. Visitor contacts, photos, and completed images remain in the dedicated D1 database and private R2 bucket. Provider/API credentials are never part of the public build.

## Current state

- Lead submission, consultation intent, private photo upload/read, and protected CSV export verified on the deployed API with disposable test data; test records and media were removed.
- Image generation disabled. No provider key was transferred and no paid rendering request was made. Three credits are reserved per registered email/event for use after enabling the provider.
- No live appointment calendar connected. Requests await the team's confirmation.
- Event ID: home-show-2026-10. Change the server event ID for the next real show.
- Shared-IP lead limit: 300/hour, to support booth devices/hotspots. Global rendering attempt cap: 50/day once enabled.

## Administration

Cloudflare OAuth can administer/export the D1 database using Wrangler. The API admin credential is stored only as a Worker secret; rotate ADMIN_TOKEN through Wrangler when a new authenticated API export session is required, and keep the chosen value in an appropriate password manager. Do not commit admin tokens, visitor tokens, or exported leads.

GitHub Pages deployment uses repository variables PUBLISH_PAGES=true and API_BASE_URL=https://spray-net-home-show-api.spray-net-south-charlotte.workers.dev. Changes to main run checks/tests and publish dist.
