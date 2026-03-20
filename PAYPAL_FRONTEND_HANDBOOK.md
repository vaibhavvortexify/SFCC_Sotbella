# PayPal Frontend Handbook

## Purpose

This document explains exactly how the frontend should integrate PayPal against the current SFCC backend.

Important: this PayPal flow follows the existing Stripe pattern in this project.

It is **not** a "PayPal button before SFCC order creation" flow.

The actual flow is:

1. Create basket and add `PAYPAL` payment instrument.
2. Create SFCC order.
3. Backend creates the PayPal order and stores `paypalOrderId` on the SFCC order payment instrument.
4. Frontend fetches that stored PayPal order ID.
5. Frontend opens PayPal JS SDK and approves the payment.
6. Frontend calls backend capture API.
7. Backend captures and finalizes the SFCC order.

## API Base

Base host:

```text
https://dyp4l3dm.api.commercecloud.salesforce.com
```

Base path:

```text
/custom/custom-data/v1/organizations/f_ecom_blxz_002
```

Required query param on every call:

```text
siteId=sotbella_uae
```

All calls require a Shopper token with scope:

```text
c_headless_custom
```

## Frontend Responsibilities

The frontend team is responsible for:

1. Adding `PAYPAL` as the basket payment method in the normal checkout flow.
2. Creating the SFCC order before rendering/using PayPal approval.
3. Calling `paypalConfig` to get SDK configuration.
4. Calling `paypalOrder` to get the stored `paypalOrderId`.
5. Using PayPal JS SDK `createOrder()` to return that existing `paypalOrderId`.
6. Calling `paypalCapture` inside `onApprove`.
7. Handling cancel, pending, and error states in the UI.

The frontend team is **not** responsible for:

1. Creating PayPal orders directly on the client.
2. Capturing PayPal directly from the client.
3. Finalizing SFCC orders on the client.

## Required Sequence

### Step 1: Add payment instrument to basket

During checkout, add the basket payment instrument with:

```json
{
  "paymentMethodId": "PAYPAL",
  "amount": <remaining order amount>
}
```

Important:
- The payment method must be exactly `PAYPAL`.
- If the basket is using split payment with wallet, the backend will preserve wallet and recreate the non-wallet instrument.

### Step 2: Create the SFCC order

Use the normal existing order creation flow already used by checkout.

Expected backend behavior:
- SFCC order is created in `CREATED`
- backend creates a PayPal order
- PayPal order ID is stored against the SFCC order payment instrument

### Step 3: Fetch PayPal SDK config

Call:

```http
GET /paypalConfig?siteId=sotbella_in
Authorization: Bearer <shopper_token>
```

Example response:

```json
{
  "success": true,
  "clientId": "<paypal-client-id>",
  "currency": "USD",
  "intent": "capture",
  "components": "buttons",
  "commit": true,
  "sdkBaseUrl": "https://www.paypal.com/sdk/js"
}
```

Notes:
- Frontend should treat the returned `currency` as authoritative.
- At the moment backend is returning `USD`.

### Step 4: Fetch PayPal order details

Call:

```http
POST /paypalOrder?siteId=sotbella_in
Authorization: Bearer <shopper_token>
Content-Type: application/json
```

Body:

```json
{
  "orderNo": "00000106",
  "orderToken": "<sfcc-order-token>"
}
```

Example success response:

```json
{
  "success": true,
  "orderNo": "00000106",
  "orderToken": "<sfcc-order-token>",
  "currencyCode": "USD",
  "orderAmount": 120.0,
  "paypalOrderId": "9VX9668391951645P",
  "paypalOrderStatus": "PAYER_ACTION_REQUIRED",
  "paypalCaptureId": "",
  "paypalCaptureStatus": ""
}
```

Frontend must use `paypalOrderId` from this response.

### Step 5: Load PayPal JS SDK

Use the config response to load:

```text
https://www.paypal.com/sdk/js?client-id=<clientId>&currency=<currency>&intent=capture&components=buttons&commit=true
```

Reference:
- https://developer.paypal.com/sdk/js/configuration/

### Step 6: Render PayPal button

The frontend should return the existing backend-created PayPal order ID from `createOrder`.

Example shape:

```js
paypal.Buttons({
  createOrder() {
    return paypalOrderId;
  },
  async onApprove(data) {
    // call backend capture API
  },
  onCancel() {
    // shopper closed or cancelled approval
  },
  onError(err) {
    // show failure UI
  }
}).render('#paypal-button-container');
```

Important:
- `createOrder()` should **not** call PayPal create-order APIs from the browser.
- It should just return the stored `paypalOrderId` received from `paypalOrder`.

### Step 7: Capture on approval

Inside `onApprove`, call:

```http
POST /paypalCapture?siteId=sotbella_in
Authorization: Bearer <shopper_token>
Content-Type: application/json
```

Body:

```json
{
  "orderNo": "00000106",
  "orderToken": "<sfcc-order-token>",
  "paypalOrderId": "9VX9668391951645P"
}
```

Example success response:

```json
{
  "success": true,
  "orderNo": "00000106",
  "paypalOrderId": "9VX9668391951645P",
  "paypalOrderStatus": "COMPLETED",
  "paypalCaptureId": "3GG27961A6636732P",
  "paypalCaptureStatus": "COMPLETED",
  "orderStatus": "NEW",
  "paymentStatus": "PAID"
}
```

Frontend success behavior:
- treat the order as paid when `success: true` and capture status is final
- redirect to confirmation page
- persist order confirmation details using existing checkout logic

## State Handling

### Before approval

Possible response from `paypalCapture` before approval:

```json
{
  "success": true,
  "orderNo": "00000106",
  "paypalOrderId": "9VX9668391951645P",
  "paypalOrderStatus": "PAYER_ACTION_REQUIRED",
  "paypalCaptureId": "",
  "paypalCaptureStatus": "PAYER_ACTION_REQUIRED",
  "orderStatus": "CREATED",
  "paymentStatus": "NOTPAID"
}
```

Frontend meaning:
- shopper has not approved in PayPal yet
- do not show confirmation page
- keep shopper on payment step

### Approved and completed

Expected:
- `paypalCaptureStatus = COMPLETED`
- `paymentStatus = PAID`

Frontend meaning:
- order is finalized
- send shopper to order confirmation

### Pending

Possible:
- `paypalCaptureStatus = PENDING`

Frontend meaning:
- payment is not fully finalized yet
- show "payment pending" messaging
- do not assume failure

Backend has recovery paths through webhook and reconciliation job.

### Cancelled by shopper

If shopper cancels PayPal approval:
- use `onCancel` in the SDK
- do not call `paypalCapture`
- optionally call existing order cancellation API if the product decision is to discard the created SFCC order

Existing backend cancellation API:
- [cancelOrder.js](/Users/vaibhavchauhan/Downloads/build790b4a9afe757ff1feb52003c47a1cc071fbc5f3%202/app_sotbella_headless/cartridge/rest-apis/custom-data/cancelOrder.js)

### Mismatch or invalid order

If frontend sends the wrong `paypalOrderId` to `paypalCapture`, backend will reject it.

Frontend meaning:
- show generic payment error
- allow retry from checkout if appropriate

## Error Handling Contract

Frontend should handle these cases:

1. `paypalConfig` fails
   Show "PayPal temporarily unavailable".

2. `paypalOrder` fails with no payment instrument found
   This means the order was not created with `PAYPAL`.

3. `paypalCapture` returns 404
   No PayPal order exists for the SFCC order.

4. `paypalCapture` returns 409
   PayPal order ID does not match the backend order.

5. `paypalCapture` returns 422
   PayPal order exists but cannot yet be finalized.

6. `paypalCapture` returns 502
   PayPal gateway retrieval failed.

## Frontend Checklist

The frontend implementation should ensure:

1. PayPal button is shown only after SFCC order creation succeeds.
2. `paymentMethodId` sent to basket is exactly `PAYPAL`.
3. `paypalOrder` is called before rendering approval flow.
4. `paypalOrderId` from backend is reused in SDK `createOrder()`.
5. `paypalCapture` is called only after shopper approval.
6. shopper cancel is handled cleanly.
7. pending state is supported.
8. duplicate capture clicks are prevented.

## Suggested Frontend Pseudocode

```js
async function initPayPal(orderNo, orderToken, accessToken) {
  const config = await getPayPalConfig(accessToken);
  const order = await getPayPalOrder(orderNo, orderToken, accessToken);

  const script = document.createElement('script');
  script.src =
    `${config.sdkBaseUrl}?client-id=${encodeURIComponent(config.clientId)}` +
    `&currency=${encodeURIComponent(config.currency)}` +
    `&intent=${encodeURIComponent(config.intent)}` +
    `&components=${encodeURIComponent(config.components)}` +
    `&commit=${encodeURIComponent(String(config.commit))}`;

  script.onload = function () {
    paypal.Buttons({
      createOrder() {
        return order.paypalOrderId;
      },
      async onApprove() {
        const capture = await capturePayPalOrder({
          orderNo,
          orderToken,
          paypalOrderId: order.paypalOrderId
        }, accessToken);

        if (!capture.success) {
          throw new Error('PayPal capture failed');
        }

        window.location.href = `/order-confirmation/${orderNo}`;
      },
      onCancel() {
        // keep shopper on payment step or call cancel order API
      },
      onError(error) {
        console.error(error);
      }
    }).render('#paypal-button-container');
  };

  document.head.appendChild(script);
}
```

## Current Backend Constraints

These are important for frontend expectations:

1. Currency from `paypalConfig` is currently hardcoded to `USD`.
2. Backend creates the PayPal order during SFCC order creation.
3. Frontend cannot start from PayPal first and create SFCC order later in the current design.
4. Webhook and reconciliation job may update the final state after the shopper leaves the page.

## Hand-off Summary

Frontend team should implement this exact sequence:

1. Add `PAYPAL` as payment method on basket.
2. Create SFCC order.
3. Call `paypalConfig`.
4. Call `paypalOrder`.
5. Load PayPal SDK.
6. Return backend `paypalOrderId` from `createOrder`.
7. Call `paypalCapture` from `onApprove`.
8. Handle success, pending, cancel, and error states.

