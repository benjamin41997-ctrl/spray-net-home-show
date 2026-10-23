# Visualization behavior and cost

## Visitor flow

A confirmed consultation is still required. Visitors upload a photo, choose one or more surfaces and a default color, and may add up to 1,000 characters of custom refinishing instructions. Specific requested colors/finishes take precedence over the default color within the selected surfaces. The provider prompt continues to preserve the scene's geometry, fixtures, surroundings, lighting, textures and window glass. Instructions are optional and may be left blank.

The browser sends instructions with the authenticated rendering request. The API validates their type, length and control characters before reserving a credit, and includes normalized instructions in the request hash. An unchanged retry reuses the existing render; changing instructions requires a new request key. Empty instructions preserve the pre-update hash so an old pending request can finish without another paid call. A custom render is labeled **Custom preview** in saved history; raw instructions are not stored in the database. Pending work remains in the visitor's tab-scoped storage for retries and the chosen photo/instructions are sent to the configured rendering provider.

Once a newly requested image is downloaded and decoded successfully, the page scrolls to it and opens a large **Your visualization is ready** dialog. It offers **Save image** and **Back to editing**. Saved gallery images have **View larger** and do not trigger a new render or consume another credit. Opening existing history does not automatically show a sequence of popups. Closing/resetting the project clears the popup's private image/download references. Images remain private blob URLs in the browser; no public image URL or third-party preview service is used.

## Current renderer — verified October 23, 2026

The deployed configuration selects **`gpt-image-1.5`**, via OpenAI's Images edits endpoint, with **`quality=low`**, **`size=1024x1024`**, one JPEG output per request. The model/quality were not changed for this update. `input_fidelity` is omitted; the documented default on this model is low. [Model pricing](https://developers.openai.com/api/docs/models/gpt-image-1.5), [image edit parameters](https://developers.openai.com/api/reference/resources/images/methods/edit).

At current published standard rates:

- Low-quality 1024×1024 image output: **$0.009 per image**, or **$0.90 for 100 outputs**.
- Input image tokens: **$8 per million**.
- Input text tokens: **$5 per million**.

Total cost includes the input photo and prompt. As an explicit example, 1,000 image-input tokens and 300 text-input tokens per render gives `100 × ($0.009 + 1,000 × $8/1,000,000 + 300 × $5/1,000,000) = $1.85`. A rough $2–$3 budget for 100 under similar input assumptions is an estimate, not measured billing or an upper bound. Actual input tokens, retries that reach the provider, taxes and hosting/storage can change the total. The API currently discards provider token-usage fields, so this update makes no claim to have measured real per-render billing. [Cost components](https://developers.openai.com/api/docs/guides/image-generation#calculating-costs).

OpenAI lists GPT Image 1.5 for shutdown on **December 1, 2026**. It remains configured for the current show; future use beyond that date requires a tested migration. [Official deprecation schedule](https://developers.openai.com/api/docs/deprecations).

The existing allowance remains three successful renders per normalized phone/event and 50 provider attempts per UTC day. This update's automated tests mock the provider; no billable render is run to verify these changes. Browser layout verification was unavailable in this session.
