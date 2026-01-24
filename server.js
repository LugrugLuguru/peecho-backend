// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "50mb" }));

// --------------------
// Env / Config
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_PRODUCT_ID = process.env.PEECHO_PRODUCT_ID;
const PEECHO_BASE = "https://test.www.peecho.com/rest/v3";
const CHECKOUT_RETURN_URL =
  process.env.CHECKOUT_RETURN_URL || "https://example.com/success";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Admin supabase client (Service Role Key) — used for backend uploads and signed URL creation
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
} else {
  console.warn("⚠️ SUPABASE_URL or SUPABASE_SERVICE_KEY not set — backend upload endpoint will fail.");
}

if (!PEECHO_API_KEY) console.warn("⚠️ PEECHO_API_KEY not set.");
if (!PEECHO_PRODUCT_ID) console.warn("⚠️ PEECHO_PRODUCT_ID not set.");

// --------------------
// Multer (in-memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB max

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
// Endpoint: Backend upload fallback (frontend -> backend -> supabase storage)
app.post("/upload-via-backend", upload.single("file"), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ error: "Supabase admin client not configured" });
    if (!req.file) return res.status(400).json({ error: "No file provided" });

    const userId = req.body.userId || "anonymous";
    const filename = req.file.originalname || "upload.pdf";
    const ext = filename.split(".").pop() || "pdf";
    const path = `${userId}/content-${cryptoRandomId()}.${ext}`;

    // Upload buffer to Supabase storage (bucket: print-files)
    const { error: upErr } = await supabaseAdmin.storage.from("print-files").upload(path, req.file.buffer, {
      contentType: req.file.mimetype || "application/pdf",
      upsert: false
    });

    if (upErr) {
      console.error("Supabase admin upload error:", upErr);
      return res.status(500).json({ error: "Supabase upload failed", details: upErr });
    }

    // Create signed URL (1 hour)
    const expiresIn = 60 * 60;
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from("print-files").createSignedUrl(path, expiresIn);
    if (signErr) {
      console.error("Signed URL error:", signErr);
      return res.status(500).json({ error: "Signed URL creation failed", details: signErr });
    }

    return res.json({ path, contentUrl: signed?.signedUrl });
  } catch (e) {
    console.error("/upload-via-backend error:", e);
    return res.status(500).json({ error: String(e) });
  }
});

function cryptoRandomId() {
  // simple random id (node global available)
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return (Date.now().toString(36) + Math.random().toString(36).substring(2, 10));
}

// --------------------
// Peecho order helpers (same robust create with fallbacks)
async function createPeechoOrderWithFallback(contentUrl, pageCount) {
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
    if (res1.ok) return { orderJson: json1, methodUsed: "file_details" };
    console.warn("peecho create order (file_details) failed:", res1.status, json1);
  } catch (e) {
    console.warn("peecho create order (file_details) exception:", String(e));
  }

  // attempt 2: items[].files
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
    if (res2.ok) return { orderJson: json2, methodUsed: "files" };
    console.warn("peecho create order (files) failed:", res2.status, json2);
  } catch (e) {
    console.warn("peecho create order (files) exception:", String(e));
  }

  // attempt 3: async (no files), then expect uploadUrl back
  try {
    const res3 = await fetch(`${PEECHO_BASE}/orders/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(baseOrder)
    });

    const json3 = await safeJson(res3);
    if (!res3.ok) {
      console.warn("peecho create order (async) failed:", res3.status, json3);
      return { orderJson: json3, methodUsed: "failed", status: res3.status };
    }

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
// Order endpoint (unchanged flow but uses helpers)
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    if (!contentUrl) return res.status(400).json({ error: "contentUrl fehlt" });
    const pc = Number(pageCount);
    if (!pc || pc < 1) return res.status(400).json({ error: "pageCount fehlt/ungültig" });
    if (!PEECHO_API_KEY || !PEECHO_PRODUCT_ID) {
      return res.status(500).json({ error: "Server misconfigured: PEECHO_API_KEY oder PEECHO_PRODUCT_ID fehlt" });
    }

    const createResult = await createPeechoOrderWithFallback(contentUrl, pc);

    if (createResult.methodUsed === "failed") {
      return res.status(createResult.status || 500).json({
        error: "Peecho order failed (all attempts)",
        details: createResult.orderJson
      });
    }

    const orderJson = createResult.orderJson;
    const methodUsed = createResult.methodUsed;

    if (methodUsed === "file_details" || methodUsed === "files") {
      const setupUrl = orderJson.checkout?.setupUrl;
      if (!setupUrl) {
        return res.status(200).json({
          orderId: orderJson.id,
          info: "Order created but no checkout.setupUrl returned",
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
        body: JSON.stringify({ returnUrl: CHECKOUT_RETURN_URL })
      });

      const checkoutJson = await safeJson(checkoutRes);
      if (!checkoutRes.ok || !checkoutJson.paymentUrl) {
        return res.status(500).json({
          error: "Payment-Link konnte nicht erstellt werden (file_details/files)",
          raw: checkoutJson
        });
      }

      return res.json({ orderId: orderJson.id, checkoutUrl: checkoutJson.paymentUrl });
    }

    // async flow:
    const uploadUrl = createResult.uploadUrl;
    if (!uploadUrl) {
      return res.status(500).json({ error: "Peecho async order: uploadUrl fehlt", raw: orderJson });
    }

    const pdfBuffer = await downloadPdfFromUrl(contentUrl);

    try {
      await putPdfToUrl(uploadUrl, pdfBuffer, "PUT");
    } catch (ePut) {
      await putPdfToUrl(uploadUrl, pdfBuffer, "POST");
    }

    const setupUrl = orderJson.checkout?.setupUrl;
    if (!setupUrl) {
      return res.status(500).json({ error: "checkout.setupUrl fehlt nach async upload", raw: orderJson });
    }

    const checkoutRes = await fetch(setupUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ returnUrl: CHECKOUT_RETURN_URL })
    });

    const checkoutJson = await safeJson(checkoutRes);
    if (!checkoutRes.ok || !checkoutJson.paymentUrl) {
      return res.status(500).json({ error: "Payment-Link konnte nicht erstellt werden (async upload)", raw: checkoutJson });
    }

    return res.json({ orderId: orderJson.id, checkoutUrl: checkoutJson.paymentUrl });
  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: String(e) });
  }
});

// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
