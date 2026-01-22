import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST"] }));
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

// ================= ORDER + PDF UPLOAD =================
app.post("/order-book", async (req, res) => {
  try {
    const { supabasePath } = req.body;
    if (!supabasePath) {
      return res.status(400).json({ error: "supabasePath fehlt" });
    }

    const token = await getAccessToken();

    // 1️⃣ Order erstellen (DIN A4 Hardcover Buch)
    const orderRes = await fetch("https://test.printapi.nl/v2/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: "kunde@example.com",
        items: [{
          productId: "book_a4_hc", // DIN A4 Hardcover
          quantity: 1
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

    const uploadUrl =
      order.items[0].files.content.uploadUrl;

    // 2️⃣ PDF aus Supabase laden
    const { data, error } = await supabase
      .storage
      .from("print-files")
      .download(supabasePath);

    if (error) throw error;

    const pdfBuffer = Buffer.from(await data.arrayBuffer());

    // 3️⃣ PDF zu PrintAPI hochladen
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBuffer
    });

    if (!uploadRes.ok) {
      throw new Error("PDF Upload fehlgeschlagen");
    }

    // 4️⃣ Checkout zurückgeben
    res.json({
      orderId: order.id,
      checkoutUrl: order.checkout.setupUrl
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft"));
