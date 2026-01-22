// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// Supabase client (service role)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Token cache
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
  tokenExpiresAt = Date.now() + (json.expires_in * 1000);
  return cachedToken;
}

async function downloadPdfFromSupabase(path) {
  const { data, error } = await supabase
    .storage
    .from("print-files")
    .download(path);

  if (error) throw new Error(`Supabase download error: ${error.message || JSON.stringify(error)}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Upload raw PDF to the PrintAPI uploadUrl.
 * Must use POST + Content-Type: application/pdf + Authorization: Bearer TOKEN
 * Retries once on 500 (transient).
 */
async function uploadPdfToPrintApi(uploadUrl, pdfBuffer, filename, bearerToken) {
  const doUpload = async () => {
    const r = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "Authorization": `Bearer ${bearerToken}`
      },
      body: pdfBuffer
    });
    return r;
  };

  let r = await doUpload();
  if (r.ok) return; // success

  // if server error, retry once
  if (r.status >= 500 && r.status < 600) {
    // small retry
    r = await doUpload();
    if (r.ok) return;
  }

  // still failed -> read body
  const text = await r.text().catch(() => "");
  throw new Error(`Upload to PrintAPI failed (${r.status}): ${text}`);
}

app.post("/order-book", async (req, res) => {
  try {
    const { contentPath, coverPath, pageCount } = req.body;

    if (!contentPath) return res.status(400).json({ error: "contentPath fehlt" });
    if (!coverPath) return res.status(400).json({ error: "coverPath fehlt" });
    const pc = Number(pageCount);
    if (!pc || pc < 1) return res.status(400).json({ error: "pageCount fehlt oder ungültig" });

    // 1) get token
    const token = await getAccessToken();

    // 2) create order
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
          productId: "boek_hc_a4_sta", // benutze die ProductId aus /products wenn nötig
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
      // forward API error
      return res.status(orderRes.status).json({ error: orderJson });
    }

    const contentUploadUrl = orderJson.items?.[0]?.files?.content?.uploadUrl;
    const coverUploadUrl   = orderJson.items?.[0]?.files?.cover?.uploadUrl;
    if (!contentUploadUrl || !coverUploadUrl) {
      return res.status(500).json({ error: "Missing uploadUrl(s) in PrintAPI response", raw: orderJson });
    }

    // 3) download PDFs from Supabase
    const contentBuffer = await downloadPdfFromSupabase(contentPath);
    const coverBuffer = await downloadPdfFromSupabase(coverPath);

    // 4) upload to PrintAPI (POST raw PDF + Authorization Bearer TOKEN)
    await uploadPdfToPrintApi(contentUploadUrl, contentBuffer, "content.pdf", token);
    await uploadPdfToPrintApi(coverUploadUrl, coverBuffer, "cover.pdf", token);

    // 5) return checkout
    return res.json({ orderId: orderJson.id, checkoutUrl: orderJson.checkout.setupUrl });

  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/products", async (req, res) => {
  try {
    const token = await getAccessToken();
    const r = await fetch("https://test.printapi.nl/v2/products", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const json = await r.json();
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
