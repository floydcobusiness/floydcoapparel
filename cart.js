/* ============================================================
   Floyd & Co. Apparel — Multi-Item Cart
   ------------------------------------------------------------
   Drop-in, dependency-free cart for the America 250 pre-order.
   No framework, no build step — works directly in index.html.

   Requires on the page:
   1. Each product card wrapped in an element with
      data-product-id="eagle" or data-product-id="wtp"
   2. Inside that card: a .cart-color-select, .cart-size-select,
      .cart-qty-input, and .add-to-cart-btn
   3. A cart drawer + toggle button (markup in INTEGRATION_GUIDE.md)

   Keep PRODUCT_NAMES / SURCHARGE_SIZES / BASE_PRICE in sync with
   functions/api/create-checkout-session.js — that file is the
   source of truth for pricing (this copy is for *display* only;
   the server always re-validates and re-prices before charging).
   ============================================================ */

(function () {
  const CART_KEY = "floydco_cart_v1";
  const CHECKOUT_ENDPOINT = "/api/create-checkout-session";

  const PRODUCT_NAMES = {
    eagle: "America 250 Eagle Tee",
    wtp: "We The People 250 Tee",
  };
  const SURCHARGE_SIZES = new Set(["2XL", "3XL", "4XL"]);
  const BASE_PRICE = 28;
  const SURCHARGE = 2;
  const MAX_QTY = 25;

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  function unitPrice(size) {
    return BASE_PRICE + (SURCHARGE_SIZES.has(size) ? SURCHARGE : 0);
  }

  function makeId() {
    return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
  }

  function addItem(productId, color, size, qty) {
    const cart = loadCart();
    const existing = cart.find(
      (i) => i.productId === productId && i.color === color && i.size === size
    );
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    } else {
      cart.push({ id: makeId(), productId, color, size, qty: Math.min(MAX_QTY, qty) });
    }
    saveCart(cart);
    renderCart();
    openDrawer();
  }

  function removeItem(id) {
    saveCart(loadCart().filter((i) => i.id !== id));
    renderCart();
  }

  function updateQty(id, qty) {
    const cart = loadCart();
    const item = cart.find((i) => i.id === id);
    if (item) {
      item.qty = Math.max(1, Math.min(MAX_QTY, qty));
      saveCart(cart);
      renderCart();
    }
  }

  function subtotal() {
    return loadCart().reduce((sum, i) => sum + unitPrice(i.size) * i.qty, 0);
  }

  function renderCart() {
    const cart = loadCart();
    const list = document.getElementById("cart-items");
    const countBadge = document.getElementById("cart-count");
    const subtotalEl = document.getElementById("cart-subtotal");
    const checkoutBtn = document.getElementById("cart-checkout-btn");
    const emptyMsg = document.getElementById("cart-empty-msg");
    if (!list) return;

    list.innerHTML = "";

    if (emptyMsg) emptyMsg.style.display = cart.length === 0 ? "block" : "none";

    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-line";
      row.innerHTML = `
        <div class="cart-line-info">
          <strong>${PRODUCT_NAMES[item.productId] || item.productId}</strong>
          <span>${item.color} · ${item.size}</span>
        </div>
        <div class="cart-line-controls">
          <input type="number" min="1" max="${MAX_QTY}" value="${item.qty}" data-id="${item.id}" class="cart-qty-edit" aria-label="Quantity" />
          <span class="cart-line-price">$${(unitPrice(item.size) * item.qty).toFixed(2)}</span>
          <button type="button" data-id="${item.id}" class="cart-remove-btn" aria-label="Remove this item">&times;</button>
        </div>
      `;
      list.appendChild(row);
    });

    if (countBadge) countBadge.textContent = String(cart.reduce((n, i) => n + i.qty, 0));
    if (subtotalEl) subtotalEl.textContent = `$${subtotal().toFixed(2)}`;
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;

    list.querySelectorAll(".cart-remove-btn").forEach((btn) =>
      btn.addEventListener("click", () => removeItem(btn.dataset.id))
    );
    list.querySelectorAll(".cart-qty-edit").forEach((input) =>
      input.addEventListener("change", () => updateQty(input.dataset.id, parseInt(input.value, 10)))
    );
  }

  function openDrawer() {
    document.getElementById("cart-drawer")?.classList.add("open");
    document.getElementById("cart-backdrop")?.classList.add("open");
  }
  function closeDrawer() {
    document.getElementById("cart-drawer")?.classList.remove("open");
    document.getElementById("cart-backdrop")?.classList.remove("open");
  }

  async function checkout() {
    const cart = loadCart();
    if (cart.length === 0) return;

    const checkoutBtn = document.getElementById("cart-checkout-btn");
    const originalLabel = checkoutBtn ? checkoutBtn.textContent : "";
    if (checkoutBtn) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Redirecting to secure checkout…";
    }

    try {
      const res = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((i) => ({
            productId: i.productId,
            color: i.color,
            size: i.size,
            qty: i.qty,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (err) {
      alert(`Checkout couldn't start: ${err.message}. Please try again, or text us if it keeps happening.`);
      if (checkoutBtn) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = originalLabel;
      }
    }
  }

  function init() {
    document.querySelectorAll(".add-to-cart-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-product-id]");
        if (!card) return;
        const productId = card.dataset.productId;
        const color = card.querySelector(".cart-color-select")?.value;
        const size = card.querySelector(".cart-size-select")?.value;
        const qty = parseInt(card.querySelector(".cart-qty-input")?.value || "1", 10);
        if (!color || !size || !qty || qty < 1) {
          alert("Pick a color, size, and quantity first.");
          return;
        }
        addItem(productId, color, size, qty);
      });
    });

    document.getElementById("cart-toggle-btn")?.addEventListener("click", openDrawer);
    document.getElementById("cart-close-btn")?.addEventListener("click", closeDrawer);
    document.getElementById("cart-backdrop")?.addEventListener("click", closeDrawer);
    document.getElementById("cart-checkout-btn")?.addEventListener("click", checkout);

    renderCart();
  }

  document.addEventListener("DOMContentLoaded", init);

  // Exposed for debugging in the browser console if needed.
  window.FloydCart = { loadCart, addItem, removeItem, updateQty, subtotal };
})();
