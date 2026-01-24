// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// --------------------
// Config (ENV)
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_PRODUCT_ID = process.env.PEECHO_PRODUCT_ID; // musst du in Render setzen
const PEECHO_BASE = "https://test.www.peecho.com/rest/v3";
const CHECKOUT_RETURN_URL =
  process.env.CHECKOUT_RETURN_URL || "https://example.com/success";

if (!PEECHO_API_KEY) {
  console.warn("⚠️ WARN: PEECHO_API_KEY ist nicht gesetzt");
}
if (!PEECHO_PRODUCT_ID) {
  console.warn("⚠️ WARN: PEECHO_PRODUCT_ID ist nicht gesetzt");
}

// --------------------
// Helpers
async function safeText(res) {
  const text = await res.text().catch(() => "");
  return text ?? "";
}
async function safeJson(res) {
  const text = await safeText(res);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _rawText: text };
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

async function putPdfToUrl(uploadUrl, pdfBuffer, method = "PUT") {
  const r = await fetch(uploadUrl, {
    method,
    headers: {
      "Content-Type": "application/pdf"
    },
    body: pdfBuffer
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload to Peecho (uploadUrl) failed (${r.status}): ${t}`);
  }
  return;
}

// --------------------
// Healthcheck
app.get("/", (req, res) => {
  res.send("peecho-backend alive ✅");
});

// --------------------
// Try creating order using different payload shapes.
// 1) items[].file_details [{url, name, contentType}]
// 2) items[].files [{url, name, contentType}]
// 3) create order without files (async flow) and use uploadUrl returned by Peecho
// Returns: { orderJson, methodUsed: "file_details"|"files"|"async", uploadUrl? }
async function createPeechoOrderWithFallback(contentUrl, pageCount) {
  // common order base
  const baseOrder = {
    email: "kunde@example.com",
    items: [
      {
        productId: PEECHO_PRODUCT_ID,
        quantity: 1,
        pageCount: pageCount
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
  };

  // attempt 1: file_details
  try {
    const body1 = JSON.parse(JSON.stringify(baseOrder));
    body1.items[0].file_details = [
      {
        url: contentUrl,
        name: "book.pdf",
        contentType: "application/pdf"
      }
    ];

    const res1 = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body1)
    });

    const json1 = await safeJson(res1);
    if (res1.ok) {
      return { orderJson: json1, methodUsed: "file_details" };
    } else {
      // keep trying — but record the error
      console.warn("peecho create order (file_details) failed:", res1.status, json1);
    }
  } catch (e) {
    console.warn("peecho create order (file_details) exception:", String(e));
  }

  // attempt 2: try items[].files (alternate shape)
  try {
    const body2 = JSON.parse(JSON.stringify(baseOrder));
    body2.items[0].files = [
      {
        url: contentUrl,
        name: "book.pdf",
        contentType: "application/pdf"
      }
    ];

    const res2 = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body2)
    });

    const json2 = await safeJson(res2);
    if (res2.ok) {
      return { orderJson: json2, methodUsed: "files" };
    } else {
      console.warn("peecho create order (files) failed:", res2.status, json2);
    }
  } catch (e) {
    console.warn("peecho create order (files) exception:", String(e));
  }

  // attempt 3: create order WITHOUT files (async), then use returned uploadUrl to PUT.
  try {
    const body3 = JSON.parse(JSON.stringify(baseOrder));
    // leave file_details empty => asynchronous flow
    const res3 = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body3)
    });

    const json3 = await safeJson(res3);
    if (!res3.ok) {
      console.warn("peecho create order (async) failed:", res3.status, json3);
      return { orderJson: json3, methodUsed: "failed", status: res3.status };
    }

    // try to extract uploadUrl (some Peecho deployments provide per-item upload URLs)
    const uploadUrl = json3.items?.[0]?.files?.file?.uploadUrl
      || json3.items?.[0]?.files?.content?.uploadUrl
      || json3.items?.[0]?.files?.cover?.uploadUrl
      || null;

    return { orderJson: json3, methodUsed: "async", uploadUrl };
  } catch (e) {
    console.warn("peecho create order (async) exception:", String(e));
    return { orderJson: { error: String(e) }, methodUsed: "failed", status: 500 };
  }
}

// --------------------
// Order endpoint: receives contentUrl (signed supabase url) + pageCount
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    if (!contentUrl) return res.status(400).json({ error: "contentUrl fehlt" });
    const pc = Number(pageCount);
    if (!pc || pc < 1) return res.status(400).json({ error: "pageCount fehlt/ungültig" });
    if (!PEECHO_API_KEY || !PEECHO_PRODUCT_ID) {
      return res.status(500).json({ error: "Server misconfigured: PEECHO_API_KEY oder PEECHO_PRODUCT_ID fehlt" });
    }

    // 1) Try to create order (prefer creating with file_details so Peecho fetches the file itself)
    const createResult = await createPeechoOrderWithFallback(contentUrl, pc);

    if (createResult.methodUsed === "failed") {
      return res.status(createResult.status || 500).json({
        error: "Peecho order failed (all attempts)",
        details: createResult.orderJson
      });
    }

    const orderJson = createResult.orderJson;
    const methodUsed = createResult.methodUsed;

    // If Peecho accepted file_details/files, we don't need to upload the file — Peecho will fetch/process it.
    if (methodUsed === "file_details" || methodUsed === "files") {
      // proceed to checkout setup if available
      const setupUrl = orderJson.checkout?.setupUrl;
      if (!setupUrl) {
        // return order for debugging
        return res.status(200).json({
          orderId: orderJson.id,
          info: "Order created but no checkout.setupUrl returned",
          raw: orderJson
        });
      }

      // create checkout (POST to setupUrl)
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
          error: "Payment-Link konnte nicht erstellt werden (file_details/files)",
          raw: checkoutJson
        });
      }

      return res.json({
        orderId: orderJson.id,
        checkoutUrl: checkoutJson.paymentUrl
      });
    }

    // methodUsed === "async": Peecho created order without files. We must upload file(s) ourselves.
    const uploadUrl = createResult.uploadUrl;
    if (!uploadUrl) {
      // Maybe Peecho expects us to call a dedicated endpoint to set files asynchronously.
      // Return the created order so you can inspect json in the client.
      return res.status(500).json({
        error: "Peecho created order in async mode but did not return an uploadUrl (inspect orderJson)",
        raw: orderJson
      });
    }

    // 2) Download the PDF from contentUrl
    const pdfBuffer = await downloadPdfFromUrl(contentUrl);

    // 3) Upload (PUT) the PDF to uploadUrl
    // Some providers require PUT, others POST — try PUT first, fallback to POST.
    try {
      await putPdfToUrl(uploadUrl, pdfBuffer, "PUT");
    } catch (ePut) {
      // fallback to POST
      await putPdfToUrl(uploadUrl, pdfBuffer, "POST");
    }

    // 4) After upload, try to create the checkout (setupUrl)
    const setupUrl = orderJson.checkout?.setupUrl;
    if (!setupUrl) {
      return res.status(500).json({
        error: "checkout.setupUrl fehlt nach async upload",
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
        error: "Payment-Link konnte nicht erstellt werden (async upload)",
        raw: checkoutJson
      });
    }

    // Success
    return res.json({
      orderId: orderJson.id,
      checkoutUrl: checkoutJson.paymentUrl
    });

  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: String(e) });
  }
});

// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
