import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({
  origin: "*",
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// ================= TOKEN CACHE =================
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Optional: direktes Bearer-Token (Debug)
  if (process.env.PRINTAPI_BEARER) {
    return process.env.PRINTAPI_BEARER;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.PRINTAPI_CLIENT_ID;
  const clientSecret = process.env.PRINTAPI_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PRINTAPI_CLIENT_ID oder PRINTAPI_CLIENT_SECRET fehlt");
  }

  const r = await fetch("https://test.printapi.nl/v2/oauth", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const json = await r.json();

  if (!r.ok) {
    throw new Error(`OAuth failed (${r.status}): ${JSON.stringify(json)}`);
  }

  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;

  return cachedToken;
}

// ================= ROUTES =================

app.post("/test", (req, res) => {
  res.json({ ok: true, received: req.body });
});

app.post("/print-test", async (req, res) => {
  try {
    const token = await getAccessToken();

    const r = await fetch("https://test.printapi.nl/v2/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: "testkunde@example.com",
        items: [{
          productId: "poster_a4_sta",
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

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text }

    res.json({
      status: r.status,
      response: json
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
