import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import FormData from "form-data";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "20mb" }));

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================= PRINTAPI TOKEN CACHE =================
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

// ================= HELPERS =================
async function downloadPdfFromSupabase(path) {
  const { data, error } = await supabase
    .storage
    .from("print-files")
    .download(path);

  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Upload a PDF to the PrintAPI uploadUrl using POST multipart/form-data.
 * We include the Authorization header (Bearer token) because PrintAPI requires it.
 */
async function uploadPdfToPrintApi(uploadUrl, pdfBuffer, filename, bearerToken) {
  const form = new FormData();
  form.append("file", pdfBuffer, {
    filename,
    contentType: "application/pdf"
  });

  // Merge form headers and add Authorization
  const headers = {
    ...form.getHeaders(),
    Authorization: `Bearer ${bearerToken}`
  };

  const r = await fetch(uploadUrl, {
    method: "POST",
    body: form,
    headers
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload to PrintAPI failed (${r.status}): ${t}`);
  }
}

// ================= ORDER + PDF UPLOAD =================
app.post("/order-book", async (req, res) => {
  try {
    const { contentPath, coverPath, pageCount } = req.body;

    if (!contentPath) return res.status(400).json({ error: "contentPath fehlt" });
    if (!coverPath) return res.status(400).json({ error: "coverPath fehlt" });

    const pc = Number(pageCount);
    if (!pc || pc < 1) {
      return res.status(400).json({ error: "pageCount fehlt oder ist ungültig" });
    }

    // get token (we will use the same token also for uploads)
    const token = await getAccessToken();

    // 1) Order anlegen
    const orderRes = await fetch("https://test.printapi.nl/v2/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
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

    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(`Order error: ${JSON.stringify(order)}`);

    const contentUploadUrl = order.items?.[0]?.files?.content?.uploadUrl;
    const coverUploadUrl   = order.items?.[0]?.files?.cover?.uploadUrl;

    if (!contentUploadUrl) throw new Error("PrintAPI content uploadUrl fehlt");
    if (!coverUploadUrl) throw new Error("PrintAPI cover uploadUrl fehlt");

    // 2) PDFs aus Supabase laden
    const contentBuffer = await downloadPdfFromSupabase(contentPath);
    const coverBuffer   = await downloadPdfFromSupabase(coverPath);

    // 3) PDFs korrekt zu PrintAPI hochladen (POST multipart/form-data + Authorization)
    await uploadPdfToPrintApi(contentUploadUrl, contentBuffer, "content.pdf", token);
    await uploadPdfToPrintApi(coverUploadUrl, coverBuffer, "cover.pdf", token);

    // 4) Checkout zurückgeben
    res.json({
      orderId: order.id,
      checkoutUrl: order.checkout.setupUrl
    });

  } catch (e) {
    // ausführliche Fehlermeldung im JSON body
    res.status(500).json({ error: e.message });
  }
});

// Produkte debug endpoint (optional)
app.get("/products", async (req, res) => {
  try {
    const token = await getAccessToken();
    const r = await fetch("https://test.printapi.nl/v2/products", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft"));
