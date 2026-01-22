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

// ================= PRINTAPI TOKEN =================
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
  if (!r.ok) throw new Error(JSON.stringify(json));

  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

// ================= HELPERS =================
async function downloadPdf(path) {
  const { data, error } = await supabase
    .storage
    .from("print-files")
    .download(path);

  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

async function uploadPdf(uploadUrl, buffer, filename) {
  const form = new FormData();
  form.append("file", buffer, {
    filename,
    contentType: "application/pdf"
  });

  const r = await fetch(uploadUrl, {
    method: "POST",
    body: form,
    headers: form.getHeaders() // ❗ KEIN Authorization
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upload to PrintAPI failed (${r.status}): ${t}`);
  }
}

// ================= ORDER =================
app.post("/order-book", async (req, res) => {
  try {
    const { contentPath, coverPath, pageCount } = req.body;

    if (!contentPath) throw new Error("contentPath fehlt");
    if (!coverPath) throw new Error("coverPath fehlt");

    const pc = Number(pageCount);
    if (!pc || pc < 1) throw new Error("pageCount ungültig");

    const token = await getAccessToken();

    // 1️⃣ Order anlegen
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
    if (!orderRes.ok) throw new Error(JSON.stringify(order));

    const contentUrl = order.items[0].files.content.uploadUrl;
    const coverUrl   = order.items[0].files.cover.uploadUrl;

    // 2️⃣ PDFs laden
    const contentPdf = await downloadPdf(contentPath);
    const coverPdf   = await downloadPdf(coverPath);

    // 3️⃣ Uploads (STABIL)
    await uploadPdf(contentUrl, contentPdf, "content.pdf");
    await uploadPdf(coverUrl, coverPdf, "cover.pdf");

    // 4️⃣ Checkout
    res.json({
      orderId: order.id,
      checkoutUrl: order.checkout.setupUrl
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================= DEBUG =================
app.get("/products", async (req, res) => {
  try {
    const token = await getAccessToken();
    const r = await fetch("https://test.printapi.nl/v2/products", {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server läuft"));
