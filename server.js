// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch"; // falls du node v18+ nutzt, ist global fetch vorhanden; node-fetch ist trotzdem kompatibel

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// --------------------
// Konfiguration / Env
// --------------------
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_PRODUCT_ID = process.env.PEECHO_PRODUCT_ID || "boek_hc_a4_sta"; // setze das in Render auf deine Test-Product/Offering ID
const PEECHO_BASE = "https://test.www.peecho.com/rest/v3";
const CHECKOUT_RETURN_URL = process.env.CHECKOUT_RETURN_URL || "https://example.com/success";

if (!PEECHO_API_KEY) {
  console.warn("WARN: PEECHO_API_KEY ist nicht gesetzt. API-Calls werden fehlschlagen.");
}

// --------------------
// Hilfsfunktionen
// --------------------

// Download PDF from signed URL (Supabase temporary signed URL)
async function downloadPdfFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PDF download failed (${r.status}): ${t}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

// Upload PDF to Peecho uploadUrl
// Peecho upload URLs usually accept a direct POST/PUT of the PDF (application/pdf).
async function uploadPdfToPeecho(uploadUrl, pdfBuffer) {
  // Some Peecho upload endpoints accept an unauthenticated POST (signed URL).
  // We'll use POST and set content-type application/pdf.
  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      // keine Authorization header hier – uploadUrl ist in der Regel signiert.
      // Falls dein uploadUrl explizit einen Auth-Header verlangt, müsste das angepasst werden.
    },
    body: pdfBuffer
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload to Peecho failed (${r.status}): ${t}`);
  }
  // manche Uploads geben eine JSON-Antwort, manche nur 200/204 — wir ignorieren die Body-Antwort.
  return;
}

// --------------------
// Order endpoint
// --------------------
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, coverUrl, pageCount } = req.body;

    if (!contentUrl) return res.status(400).json({ error: "contentUrl fehlt" });
    if (!coverUrl) return res.status(400).json({ error: "coverUrl fehlt" });

    const pc = Number(pageCount);
    if (!pc || pc < 1) {
      return res.status(400).json({ error: "pageCount fehlt oder ungültig" });
    }

    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "Server nicht konfiguriert: PEECHO_API_KEY fehlt" });
    }

    // 1) Create order at Peecho (OPEN state). We do NOT include files here - we'll upload asynchronously.
    // Endpoint (test): https://test.www.peecho.com/rest/v3/orders/
    const orderCreateBody = {
      // "email" is optional but recommended so the order shows an associated email
      email: "kunde@example.com",
      items: [{
        // Peecho uses product/offering IDs from your account. Passe PEECHO_PRODUCT_ID an.
        productId: PEECHO_PRODUCT_ID,
        quantity: 1,
        // pageCount is accepted for book-like products
        pageCount: pc
      }],
      shipping: {
        address: {
          name: "Max Mustermann",
          line1: "Musterstraße 1",
          postCode: "12345",
          city: "Musterstadt",
          country: "DE"
        }
      }
    };

    const orderRes = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(orderCreateBody)
    });

    const orderJson = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      return res.status(orderRes.status).json({
        error: "Peecho order create failed",
        details: orderJson
      });
    }

    // Expect Peecho to return upload URLs for the item files when creating an order without files.
    // Common path: orderJson.items[0].files.content.uploadUrl and .files.cover.uploadUrl
    const contentUploadUrl = orderJson.items?.[0]?.files?.content?.uploadUrl;
    const coverUploadUrl   = orderJson.items?.[0]?.files?.cover?.uploadUrl;

    if (!contentUploadUrl || !coverUploadUrl) {
      // If the API doesn't return upload URLs, return the whole orderJson for debugging.
      return res.status(500).json({ error: "Upload URLs fehlen", raw: orderJson });
    }

    // 2) Download PDFs from the signed Supabase URLs supplied by the frontend
    const contentBuffer = await downloadPdfFromUrl(contentUrl);
    const coverBuffer   = await downloadPdfFromUrl(coverUrl);

    // 3) Upload PDFs to the Peecho upload URLs
    await uploadPdfToPeecho(contentUploadUrl, contentBuffer);
    await uploadPdfToPeecho(coverUploadUrl, coverBuffer);

    // 4) Create checkout/payment link (setup)
    // Peecho often returns a checkout.setupUrl which needs a POST to create a paymentUrl.
    const setupUrl = orderJson.checkout?.setupUrl;
    if (!setupUrl) {
      return res.status(500).json({ error: "checkout.setupUrl fehlt", raw: orderJson });
    }

    const checkoutRes = await fetch(setupUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        returnUrl: CHECKOUT_RETURN_URL,
        billingAddress: {
          name: "Max Mustermann",
          line1: "Musterstraße 1",
          postCode: "12345",
          city: "Musterstadt",
          country: "DE"
        }
      })
    });

    const checkoutJson = await checkoutRes.json().catch(() => ({}));
    if (!checkoutRes.ok || !checkoutJson.paymentUrl) {
      return res.status(500).json({
        error: "Payment-Link konnte nicht erstellt werden",
        checkoutJson
      });
    }

    // DONE: return order id and checkout url
    return res.json({
      orderId: orderJson.id,
      checkoutUrl: checkoutJson.paymentUrl
    });

  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
