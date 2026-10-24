# Visualization behavior and cost

## Visitor flow

A confirmed consultation is still required. Visitors upload a photo, choose a color and one or more surfaces, then create a preview. The custom-prompt field has been removed; new visitor requests send no free-text instructions. The provider prompt continues to preserve the scene's geometry, fixtures, surroundings, lighting, textures and window glass.

The palette includes **Pure white (`#FFFFFF`)** in addition to the existing six colors. Adding a valid new photo automatically selects it; the next fresh visualization uses that photo. Multiple uploads finish on the last accepted photo, and invalid photos do not change selection. Uploading or selecting a photo never replenishes credits. Render retries still retain their original settings and idempotency key.

Creating an image shows a rotating ring on the busy button and a prominent progress message. Both expose an accessible busy state and clear on success/failure; reduced-motion preferences retain the visible ring/text without rotation. Larger tablet fonts cover headings, color/surface labels, balances, upload guidance and status text. Mobile typography remains unchanged.

Existing pending work remains in tab-scoped storage and retries its original settings/key, including an older custom request, to avoid starting another paid call. The server retains validation and request-hash compatibility for those retries and previously open clients. Old saved images remain available. New requests use only the selected photo, color and surfaces. This UI simplification does not change the model or guarantee a particular provider response time.

Once a newly requested image is downloaded and decoded successfully, the page scrolls to it and opens a large **Your visualization is ready** dialog. It offers **Save image** and **Back to editing**. Saved gallery images have **View larger** and do not trigger a new render or consume another credit. Opening existing history does not automatically show a sequence of popups. Closing/resetting the project clears the popup's private image/download references. Images remain private blob URLs in the browser; no public image URL or third-party preview service is used.

On tablets, a full-width top panel holds the same private QR, photo upload/selectors and color/surface/Create controls. Generated previews share the entire bottom row, automatically getting narrower as the gallery grows from one to five. Each retains its View larger and Save image controls; images use contain sizing to avoid cropping. Two portfolio photos appear below the controls until a generated preview is available. Closing the studio or switching to narrow/mobile restores the original QR/result nodes, preserving handlers and private image cleanup. Browser checks with synthetic media verified no page scroll at 1024×768, 960×600 and portrait 820×1180. No customer records or rendering provider calls were used for those checks.

## Private tablet-to-phone handoff

The tablet retains one QR, in the left column during capture/scheduling and inside the top controls while the studio is open. Before a lead is saved it opens the public mobile form. After submission it switches to that exact visitor's private project link; a booked visitor can open their unlocked visualizer without submitting another lead. Its caption identifies it as private. **Next visitor** clears the active token/QR and restores the public mobile form. There is no second QR section or lower Done control. Links use the existing `#studio=` bearer fragment; the mobile page verifies the token with the private API and never creates a new lead merely by scanning it.

## Durable allowance and spending limits

The allowance is **five successful renders per normalized phone and event**, shared by every browser/device with that project. Pending renders reserve credits atomically; failed renders refund successful-image allowance once, while attempt counters are retained. The client never uses the advertised offer or browser storage as a remaining balance. Both confirmation and studio displays read the authenticated server balance; missing balances keep creation disabled.

`render_quotas` stores a hashed phone/event key and usage counters; `render_quota_leads` associates current lead IDs with it. Deleting a lead removes its contacts, token, media and association but preserves minimal hashed usage. Recreating that phone/event inherits its used allowance instead of replenishing it. Existing completed/pending render history is reconciled conservatively with the ledger, and legacy duplicate-phone leads share a single quota. The owner deletion path enrolls old records before deletion so their remaining history cannot disappear first.

Atomic database triggers enforce **five credits**, **10 total attempts per phone/event**, **50 total attempts per UTC day** across the site, and **500 total attempts per event** across the site. Browser fields, query strings, refreshes, altered local storage, new visitor tokens, different email addresses and concurrent calls cannot raise those limits. Different unverified phone numbers are different identities; the global caps remain in force even when someone supplies invented numbers. These are hard request-count limits, not an exact dollar billing cap; photo/prompt input sizes and provider billing affect actual cost. No automatic retries create new paid requests.

Apply `0007_durable_render_quotas.sql` before deploying the corresponding Worker. It adds accounting tables, replaces reservation/refund triggers and raises the total allowance from three to five while retaining already-used credits. Reapplying it does not reset mapped consumed usage. Account keys and API secrets never belong in these tables or public config.

## Current renderer — verified October 23, 2026

The renderer selects **`gpt-image-2.5-sunburst`**, via OpenAI's Images edits endpoint, with **`quality=low`**, **`size=1024x1024`**, one JPEG output per request. OpenAI recommends Sunburst for editing precision. The former GPT Image 1.5 default is no longer used. No `input_fidelity` parameter is sent. [Model and pricing](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [image edit parameters](https://developers.openai.com/api/reference/resources/images/methods/edit).

One live verification edited the existing public kitchen portfolio photo into warm white upper cabinets and navy lower cabinets. It returned a valid 1024×1024 JPEG, inspected alongside the source. The existing restricted key lacks model-metadata read permission, but its actual image-edit request succeeded; no new credential was connected and no customer record was involved.

The test reported 1,240 image-input tokens, 179 text-input tokens and 196 image-output tokens. At current standard rates ($8, $5 and $30 per million respectively), estimated model-token cost was **$0.016695**, or **about $1.67 for 100 comparable edits**. This is a measured-token estimate, not an invoice or universal per-image price. Other photo/prompt inputs, failed provider attempts, taxes and hosting/storage can change the total. [OpenAI pricing](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).

Automated tests use mocked providers. The one live image request above is the only paid verification request made for this update. Browser layout and physical QR scanning were unavailable in this session; QR payloads/private access and quota enforcement are covered by automated tests and live API checks.
