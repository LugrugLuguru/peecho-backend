// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// --------------------
// Config
// --------------------
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_PRODUCT_ID = process.env.PEECHO_PRODUCT_ID; // MUSS gesetzt sein
const PEECHO_BASE = "https://test.www.peecho.com/rest/v3";
const CHECKOUT_RETURN_URL =
  process.env.CHECKOUT_RETURN_URL || "https://example.com/success";

// --------------------
// Helpers
// --------------------
async function safeJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

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
    method: "PUT", // ⬅️ Peecho erwartet PUT
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
// Healthcheck
// --------------------
app.get("/", (req, res) => {
  res.send("peecho-backend alive ✅");
});

// --------------------
// Order endpoint
// --------------------
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    if (!contentUrl) {
      return res.status(400).json({ error: "contentUrl fehlt" });
    }

    const pc = Number(pageCount);
    if (!pc || pc < 1) {
      return res.status(400).json({ error: "pageCount ungültig" });
    }

    if (!PEECHO_API_KEY || !PEECHO_PRODUCT_ID) {
      return res.status(500).json({
        error: "PEECHO_API_KEY oder PEECHO_PRODUCT_ID fehlt"
      });
    }

    // 1️⃣ Order anlegen (Buch = 1 Datei!)
    const orderRes = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
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

    const orderJson = await safeJson(orderRes);
    if (!orderRes.ok) {
      return res.status(orderRes.status).json({
        error: "Peecho order failed",
        details: orderJson
      });
    }

    // ⬅️ WICHTIG: NUR EINE DATEI
    const uploadUrl = orderJson.items?.[0]?.files?.file?.uploadUrl;
    if (!uploadUrl) {
      return res.status(500).json({
        error: "uploadUrl fehlt (Peecho erwartet genau eine Datei)",
        raw: orderJson
      });
    }

    // 2️⃣ PDF laden
    const pdfBuffer = await downloadPdfFromUrl(contentUrl);

    // 3️⃣ PDF hochladen
    await uploadPdfToPeecho(uploadUrl, pdfBuffer);

    // 4️⃣ Checkout erzeugen
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
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        returnUrl: CHECKOUT_RETURN_URL
      })
    });

    const checkoutJson = await safeJson(checkoutRes);
    if (!checkoutRes.ok || !checkoutJson.paymentUrl) {
      return res.status(500).json({
        error: "Checkout fehlgeschlagen",
        raw: checkoutJson
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
