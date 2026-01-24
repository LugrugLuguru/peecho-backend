// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// --------------------
// Konfiguration
// --------------------
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_PRODUCT_ID = process.env.PEECHO_PRODUCT_ID || "boek_hc_a4_sta";
const PEECHO_BASE = "https://test.www.peecho.com/rest/v3";
const CHECKOUT_RETURN_URL =
  process.env.CHECKOUT_RETURN_URL || "https://example.com/success";

if (!PEECHO_API_KEY) {
  console.warn("⚠️ PEECHO_API_KEY ist nicht gesetzt");
}

// --------------------
// Helpers
// --------------------
async function downloadPdfFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PDF download failed (${r.status}): ${t}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

async function uploadPdfToPeecho(uploadUrl, pdfBuffer) {
  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf"
    },
    body: pdfBuffer
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload to Peecho failed (${r.status}): ${t}`);
  }
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
      return res.status(400).json({ error: "pageCount ungültig" });
    }

    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY fehlt" });
    }

    // 1) Order anlegen
    const orderRes = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        email: "kunde@example.com",
        items: [
          {
            productId: PEECHO_PRODUCT_ID,
            quantity: 1,
            pageCount: pc
          }
        ],
        shipping: {
          address: {
            name: "Max Mustermann",
            line1: "Musterstraße 1",
            postCode: "12345",
            city: "Musterstadt",
            country: "DE"
          }
        }
      })
    });

    const orderJson = await orderRes.json();
    if (!orderRes.ok) {
      return res.status(orderRes.status).json(orderJson);
    }

    const contentUploadUrl =
      orderJson.items?.[0]?.files?.content?.uploadUrl;
    const coverUploadUrl =
      orderJson.items?.[0]?.files?.cover?.uploadUrl;

    if (!contentUploadUrl || !coverUploadUrl) {
      return res.status(500).json({
        error: "Upload URLs fehlen",
        raw: orderJson
      });
    }

    // 2) PDFs laden
    const contentBuffer = await downloadPdfFromUrl(contentUrl);
    const coverBuffer = await downloadPdfFromUrl(coverUrl);

    // 3) PDFs hochladen
    await uploadPdfToPeecho(contentUploadUrl, contentBuffer);
    await uploadPdfToPeecho(coverUploadUrl, coverBuffer);

    // 4) Checkout Setup
    const setupUrl = orderJson.checkout?.setupUrl;
    if (!setupUrl) {
      return res.status(500).json({
        error: "checkout.setupUrl fehlt",
        raw: orderJson
      });
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

    const checkoutJson = await checkoutRes.json();
    if (!checkoutRes.ok || !checkoutJson.paymentUrl) {
      return res.status(500).json({
        error: "Payment-Link konnte nicht erstellt werden",
        checkoutJson
      });
    }

    return res.json({
      orderId: orderJson.id,
      checkoutUrl: checkoutJson.paymentUrl
    });
  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server läuft auf Port ${PORT}`)
);
