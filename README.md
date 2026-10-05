# Brevo Tag for server Google Tag Manager

The Brevo tag for the server Google Tag Manager (sGTM) container enables seamless integration between your website and Brevo.

**Track page view** - captures every time a user navigates to a new page or reloads the current page. This helps analyze website traffic, user behavior, and engagement.

**Track event** - tracks user interactions with content, such as form submissions, button clicks, or video playbacks.  

**Track link click** - records when users click on hyperlinks within a web page.

**Identify the user** - allows the system to recognize and differentiate individual users who interact with the website. It can be based on a unique identifier, such as a user ID or a cookie.

**Track order** - creates an order or updates its status in Brevo using the [Orders API](https://developers.brevo.com/reference/create-order) (v3 only; the selected API version is ignored). Order fields are set in the **Order Parameters** table. Except for the order ID, any field left unset is filled from the event data:

| Field | Default |
|---|---|
| ID | - (required) |
| Amount | `value` |
| Status | `completed` |
| Products | `items` (GA4 format). Brevo-format products (`productId`, `price`, `quantity`/`quantityFloat`, `variantId`) or a JSON string are also accepted. |
| Created At | Current time |
| Updated At | Current time |

  - Dates must be in UTC `YYYY-MM-DDTHH:mm:ssZ` format. Unix timestamps in seconds or milliseconds are converted automatically.
  - When updating the status of an existing order, set **Created At** to the original creation date so it is not replaced with the current time.
  - Customer identifiers are optional for orders. If the **Email** field is empty, the email (`user_data.email_address` or `user_data.email`) and phone number (`user_data.phone_number`) are read from the event data; hashed values are ignored.
  - The request is not sent if the order ID, amount, status, dates or any product's ID, price or quantity is missing or invalid. The log message names the fields that failed.

**Client Key** - retrieve your Client Key based on the API version you are using:
  - API v2: https://developers.brevo.com/docs/tracker-rest-implementation#authentication
  - API v3: https://developers.brevo.com/docs/getting-started#using-your-api-key-to-authenticate

**Email** - email to identify the user.

**Page** - the name of the page being tracked (e.g., `"Checkout"`).

## Useful resource
- https://stape.io/blog/brevo-tag-for-server-google-tag-manager

## Open Source

Brevo Tag for GTM Server Side is developed and maintained by [Stape Team](https://stape.io/) under the Apache 2.0 license.

### GTM Gallery Status
🟢 [Listed](https://tagmanager.google.com/gallery/#/owners/stape-io/templates/brevo-tag)
