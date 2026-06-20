// functions/api/stripe-webhook.js
//
// Cloudflare Pages Function — POST /api/stripe-webhook
//
// ⚠️ MERGE NOTE: project notes describe an existing webhook that already
// verifies Stripe's signature, creates a Wave invoice via GraphQL, and
// fires a Meta Purchase event via CAPI. This file is a fresh scaffold for
// the *new* part — pulling a full multi-item order off a dynamic Checkout
// Session — since the existing file wasn't available to edit directly.
// Drop your existing Wave + Meta CAPI code into the two marked spots below
// rather than replacing the whole file.
//
// Required environment variables:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET   (from Stripe Dashboard → Webhooks → this endpoint)
//   WAVE_API_KEY            (already in use — keep as-is)
//   META_CAPI_TOKEN         (already in use — keep as-is)
//   META_PIXEL_ID           (already in use — keep as-is)

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expectedSig = [...new Uint8Array(sigBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedSig === signature;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const payload = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  const isValid = await verifyStripeSignature(payload, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Dynamic line items aren't included on the event payload itself —
    // fetch them in a follow-up call.
    const lineItemsRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items?limit=100`,
      {
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-05-27",
        },
      }
    );
    const lineItemsData = await lineItemsRes.json();

    const order = {
      sessionId: session.id,
      customerEmail: session.customer_details?.email,
      customerPhone: session.customer_details?.phone,
      shippingMethod: session.shipping_cost?.shipping_rate_id || null,
      amountTotalCents: session.amount_total,
      items: (lineItemsData.data || []).map((li) => ({
        description: li.description, // e.g. "We The People 250 Tee — Graphite — XL"
        quantity: li.quantity,
        amountSubtotalCents: li.amount_subtotal,
      })),
    };

    // ---- MERGE POINT 1: WAVE INVOICE ----
    // Replace with your existing GraphQL mutation, looping `order.items`
    // into Wave invoice line items instead of a single line.
    // await createWaveInvoice(order, env);

    // ---- MERGE POINT 2: META CAPI PURCHASE EVENT ----
    // Replace with your existing CAPI call. order.amountTotalCents / 100
    // is the purchase value; order.items gives content_ids/quantities
    // if you're sending content data.
    // await fireMetaPurchaseEvent(order, env);

    console.log("Order captured:", JSON.stringify(order));
  }

  return new Response("ok", { status: 200 });
}
