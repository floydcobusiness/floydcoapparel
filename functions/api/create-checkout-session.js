// functions/api/create-checkout-session.js
//
// Cloudflare Pages Function — POST /api/create-checkout-session
// Takes a multi-item cart and creates one dynamic Stripe Checkout
// Session with a line item per product/color/size combination.
//
// Required environment variables (Cloudflare Pages → Settings →
// Environment variables → Production + Preview):
//   STRIPE_SECRET_KEY   sk_live_... (or sk_test_... while testing)
//   SITE_URL            e.g. https://floydcoapparel.com
//
// No npm dependencies — talks to the Stripe REST API directly with
// fetch(), which works in the Workers runtime with zero build step.
// API version is pinned to 2026-05-27 (Stripe's current version as of
// writing) on the request itself — see the fetch call below.

const PRODUCT_CATALOG = {
  eagle: {
    name: "America 250 Eagle Tee",
    colors: ["Ivory", "Washed Denim", "White"],
  },
  wtp: {
    name: "We The People 250 Tee",
    colors: ["Pepper", "True Navy", "Black"],
  },
};

const ADULT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const YOUTH_SIZES = ["YM", "YL", "YXL"];
const ALL_SIZES = [...ADULT_SIZES, ...YOUTH_SIZES];
const SURCHARGE_SIZES = new Set(["2XL", "3XL", "4XL"]);

const BASE_PRICE_CENTS = 2800;
const SURCHARGE_CENTS = 200;
const MAX_QTY_PER_LINE = 25;
const MAX_LINE_ITEMS = 30;

function validateAndPrice(item) {
  const product = PRODUCT_CATALOG[item.productId];
  if (!product) throw new Error(`Unknown product: "${item.productId}"`);
  if (!product.colors.includes(item.color)) {
    throw new Error(`"${item.color}" isn't a valid color for ${product.name}`);
  }
  if (!ALL_SIZES.includes(item.size)) {
    throw new Error(`"${item.size}" isn't a valid size`);
  }
  const qty = parseInt(item.qty, 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
    throw new Error(`Invalid quantity for ${product.name}: ${item.qty}`);
  }

  const unitAmount = BASE_PRICE_CENTS + (SURCHARGE_SIZES.has(item.size) ? SURCHARGE_CENTS : 0);

  return {
    price_data: {
      currency: "usd",
      unit_amount: unitAmount,
      product_data: {
        name: `${product.name} — ${item.color} — ${item.size}`,
      },
    },
    quantity: qty,
  };
}

// Converts a nested JS object into Stripe's bracketed form-encoding,
// e.g. { line_items: [{ quantity: 2 }] } -> "line_items[0][quantity]=2"
function toStripeFormParams(obj, params = new URLSearchParams(), prefix = "") {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") {
          toStripeFormParams(v, params, `${fullKey}[${i}]`);
        } else if (v !== undefined && v !== null) {
          params.append(`${fullKey}[${i}]`, v);
        }
      });
    } else if (value !== null && typeof value === "object") {
      toStripeFormParams(value, params, fullKey);
    } else if (value !== undefined && value !== null) {
      params.append(fullKey, value);
    }
  }
  return params;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return jsonError("Cart is empty", 400);
  if (items.length > MAX_LINE_ITEMS) return jsonError("Too many line items", 400);

  let line_items;
  try {
    line_items = items.map(validateAndPrice);
  } catch (err) {
    return jsonError(err.message, 400);
  }

  const siteUrl = env.SITE_URL || "https://floydcoapparel.com";

  const sessionPayload = {
    mode: "payment",
    line_items,
    success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/cart-cancelled`,
    phone_number_collection: { enabled: true },
    billing_address_collection: "auto",
    shipping_address_collection: { allowed_countries: ["US"] },
    shipping_options: [
      {
        shipping_rate_data: {
          display_name: "Local Pickup — Selmer, TN (July 2nd)",
          type: "fixed_amount",
          fixed_amount: { amount: 0, currency: "usd" },
        },
      },
      {
        shipping_rate_data: {
          display_name: "Standard Shipping",
          type: "fixed_amount",
          fixed_amount: { amount: 600, currency: "usd" },
          delivery_estimate: {
            minimum: { unit: "business_day", value: 5 },
            maximum: { unit: "business_day", value: 10 },
          },
        },
      },
    ],
  };

  const params = toStripeFormParams(sessionPayload);

  let stripeRes;
  try {
    stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Pinned explicitly because we're calling the REST API directly
        // instead of through an SDK (which would pin a version itself).
        // Without this, requests silently follow whatever default version
        // is set on the Stripe account, which can change under you.
        "Stripe-Version": "2026-05-27.dahlia",
      },
      body: params,
    });
  } catch {
    return jsonError("Could not reach Stripe. Please try again.", 502);
  }

  const session = await stripeRes.json();

  if (!stripeRes.ok) {
    return jsonError(session.error?.message || "Stripe error", 500);
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
