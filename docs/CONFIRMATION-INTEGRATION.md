# Home-show consultation confirmations

## Current state

The website confirms appointments in its own private calendar. Email is required for booking. The owner portal provides **Draft email**, **Draft text**, and copyable messages on confirmed lead and calendar cards. The owner can send email from their Spray-Net mailbox and texts from their personal cell without corporate workflow access. See the [manual sending steps](OWNER-PORTAL.md#send-confirmation-from-your-phone).

Automatic email and SMS delivery are **not connected**. No mailbox, text provider, workflow URL, or CRM integration credential is configured in the API. Opening or copying a draft never sends it or proves delivery. The setup below is an optional future automation path, not a prerequisite for manual sending.

The supplied HighLevel/Spray-Network screenshot shows **View-only mode — you can explore the list but you cannot make changes**. It lists an existing Appointment Reminder workflow. Its trigger and delivery actions have not been inspected or verified. A website booking does not automatically create a HighLevel appointment or enroll anyone in that workflow.

## Optional future request to the Spray-Network/HighLevel admin

Please enable the appropriate workflow editing permission for Ben Hessler's South Charlotte location, or create a draft workflow named **Home Show — Confirmed Consultation** with:

1. An **Inbound Webhook** trigger that accepts a confirmed appointment from our home-show website.
2. A **Create/Update Contact** action mapping the customer's name, email and phone. Use the intended South Charlotte location and preserve existing contact communication preferences/DND settings.
3. An email confirmation sent from **ben.hessler@spray-net.com**, with replies going to that mailbox. Please confirm that address is authorized in the location's email sending configuration; setting a display name alone is insufficient.
4. A consultation-confirmation text through our **existing location phone number**, respecting the location's consent and opt-out settings. No new Twilio account or phone-number purchase is requested.
5. One-hour visitor-facing appointment times in **America/New_York**. The website's longer internal reservation/travel gap must not appear in customer messages.
6. Confirmation of whether the Inbound Webhook premium trigger is enabled and what execution/messaging charges apply to this location.

Keep the workflow unpublished until the server connection and synthetic test are reviewed. Provide the webhook URL through a secure channel; it is a credential and must not be pasted into the public repository, public configuration, or issue tracker. No broad CRM administrator token is needed for an inbound-webhook-only design.

## Website integration to implement after the connection is supplied

These fields are the proposed contract, not an already active integration:

| Field | Example / meaning |
| --- | --- |
| event | consultation_confirmed |
| event_id | Stable unique booking transaction ID, for duplicate control |
| first_name / last_name | Customer contact fields |
| email / phone | Required booking email and saved phone |
| project_address | Saved project address |
| consultation_start / consultation_end | UTC timestamps, one-hour customer visit |
| consultation_date / consultation_time | Human-readable Eastern date and time |
| time_zone | America/New_York |
| source | Home show website |

The sender must fire only after authoritative booking confirmation, never after lead capture or clicking a schedule button. Booking retries must not send duplicate confirmations. Delivery acceptance should be distinguished from an actual delivered email/text. Failures must retain the saved appointment and be visible for staff follow-up. Contact data belongs only in the private API and the approved HighLevel workflow; visitor access tokens and photo/render data must not be sent.

## Draft message content

Email subject: **Your Spray-Net consultation is confirmed**

Hi [first name], your Spray-Net South Charlotte consultation is confirmed for [date], [start time]–[end time] Eastern Time at [project address]. We look forward to discussing your project and exclusive home-show rewards. Reply to this email if you need to change your appointment. — Ben Hessler, Spray-Net South Charlotte

Text: **Hi [first name], your Spray-Net South Charlotte consultation is confirmed for [date] at [start time] Eastern Time. Reply if you need to change your appointment. — Ben**

## Official references

- [HighLevel inbound webhook workflow setup](https://help.gohighlevel.com/support/solutions/articles/48001237383-how-to-use-the-inbound-webhook-workflow-premium-trigger)
- [HighLevel sub-account user roles and permissions](https://help.gohighlevel.com/support/solutions/articles/155000002544)
- [HighLevel phone-number settings](https://help.gohighlevel.com/support/solutions/articles/155000003226-how-to-purchase-a-phone-number-in-a-sub-account)
- [Office 365 Outlook connector](https://learn.microsoft.com/en-us/connectors/office365/) — Power Automate is an alternative email route if the corporate account can authorize it; it does not supply HighLevel SMS access.
