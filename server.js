// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// --------------------
// PrintAPI OAuth token cache
// --------------------
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const r = await fetch("https://test.printapi.nl/v2/oauth", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.PRINTAPI_CLIENT_ID,
      client_secret: process.env.PRINTAPI_CLIENT_SECRET
    })
  });

  const json = await r.json();
  if (!r.ok) throw new Error(`Token error: ${JSON.stringify(json)}`);

  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

// --------------------
// Download PDF from signed URL
// --------------------
async function downloadPdfFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PDF download failed (${r.status}): ${t}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

// --------------------
// Upload PDF to PrintAPI
// --------------------
async function uploadPdfToPrintApi(uploadUrl, pdfBuffer, bearerToken) {
  const r = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "Authorization": `Bearer ${bearerToken}`
    },
    body: pdfBuffer
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload to PrintAPI failed (${r.status}): ${t}`);
  }
}

// --------------------
// Order endpoint
// --------------------
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, coverUrl, pageCount } = req.body;

    if (!contentUrl) return res.status(400).json({ error: "contentUrl fehlt" });
    if (!coverUrl)   return res.status(400).json({ error: "coverUrl fehlt" });

    const pc = Number(pageCount);
    if (!pc || pc < 1) {
      return res.status(400).json({ error: "pageCount fehlt oder ungültig" });
    }

    // 1) OAuth token
    const token = await getAccessToken();

    // 2) Create order (request PrintAPI to create the order and provide uploadUrls)
    const orderRes = await fetch("https://test.printapi.nl/v2/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        email: "kunde@example.com",
        items: [{
          productId: "boek_hc_a4_sta",
          quantity: 1,
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
      })
    });

    const orderJson = await orderRes.json();
    if (!orderRes.ok) {
      return res.status(orderRes.status).json({ error: orderJson });
    }

    const contentUploadUrl = orderJson.items?.[0]?.files?.content?.uploadUrl;
    const coverUploadUrl   = orderJson.items?.[0]?.files?.cover?.uploadUrl;

    if (!contentUploadUrl || !coverUploadUrl) {
      return res.status(500).json({
        error: "Missing uploadUrl(s)",
        raw: orderJson
      });
    }

    // 3) Download PDFs from signed URLs (from Supabase)
    const contentBuffer = await downloadPdfFromUrl(contentUrl);
    const coverBuffer   = await downloadPdfFromUrl(coverUrl);

    // 4) Upload to PrintAPI (POST application/pdf with Bearer token)
    await uploadPdfToPrintApi(contentUploadUrl, contentBuffer, token);
    await uploadPdfToPrintApi(coverUploadUrl, coverBuffer, token);

    // 5) Create a public checkout link for this order
    // Try POST /v2/checkout with orderId (returns setup/payment URL)
    const checkoutBody = {
      orderId: orderJson.id,
      // optional: set your return/cancel URLs via env or defaults
      returnUrl: process.env.CHECKOUT_RETURN_URL || "https://example.com/success",
      cancelUrl: process.env.CHECKOUT_CANCEL_URL || "https://example.com/cancel"
    };

    const checkoutRes = await fetch("https://test.printapi.nl/v2/checkout", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(checkoutBody)
    });

    let checkoutJson = null;
    try {
      checkoutJson = await checkoutRes.json();
    } catch (err) {
      checkoutJson = null;
    }

    // If POST /v2/checkout succeeded and returned a public URL, return it
    if (checkoutRes.ok) {
      const checkoutUrl = checkoutJson?.paymentUrl || checkoutJson?.setupUrl || checkoutJson?.url || null;
      if (checkoutUrl) {
        return res.json({ orderId: orderJson.id, checkoutUrl });
      }
      // fallback: continue to fetch the order to look for checkout info
    }

    // Fallback: GET the full order and look for checkout.paymentUrl or checkout.setupUrl
    const orderFetch = await fetch(`https://test.printapi.nl/v2/orders/${orderJson.id}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });
    const fullOrderJson = await orderFetch.json();

    const fallbackCheckoutUrl =
      fullOrderJson?.checkout?.paymentUrl ||
      fullOrderJson?.checkout?.setupUrl ||
      fullOrderJson?.checkout?.url ||
      null;

    if (fallbackCheckoutUrl) {
      return res.json({ orderId: orderJson.id, checkoutUrl: fallbackCheckoutUrl });
    }

    // Nothing returned: give a helpful error payload (includes raw responses for debugging)
    return res.status(500).json({
      error: "Backend hat keine checkoutUrl zurückgegeben",
      orderId: orderJson.id,
      orderResponse: orderJson,
      checkoutAttempt: checkoutJson,
      fullOrder: fullOrderJson
    });

  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
