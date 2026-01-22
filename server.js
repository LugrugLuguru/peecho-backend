import express from "express";
import fetch from "node-fetch";
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

// ============ Token Cache & Helper ============
let cachedToken = null;
let tokenExpiresAt = 0; // unix ms

async function getAccessToken() {
  // If user provided a ready-made bearer token in env (quick debug)
  if (process.env.PRINTAPI_BEARER) {
    return process.env.PRINTAPI_BEARER;
  }

  // reuse cached token when not expired (keep 60s buffer)
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.PRINTAPI_CLIENT_ID;
  const clientSecret = process.env.PRINTAPI_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Weder PRINTAPI_BEARER noch PRINTAPI_CLIENT_ID/PRINTAPI_CLIENT_SECRET gesetzt");
  }

  const tokenUrl = "https://test.printapi.nl/v2/oauth";

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { errorText: text }; }

  if (!r.ok) {
    const errMsg = json && json.error ? `${json.error}: ${json.error_description || ""}` : JSON.stringify(json);
    throw new Error(`Token request failed (${r.status}): ${errMsg}`);
  }

  if (!json.access_token || !json.expires_in) {
    throw new Error("Token response enthält kein access_token/expires_in: " + JSON.stringify(json));
  }

  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in * 1000);

  return cachedToken;
}

// ✅ Test-Route (die du gerade benutzt hast)
app.post("/test", (req, res) => {
  res.json({
    ok: true,
    message: "Backend erreichbar",
    received: req.body
  });
});

// 🔴 PRINTAPI TEST (verwendet OAuth-Token)
app.post("/print-test", async (req, res) => {
  try {
    // Hol Access-Token (oder verwende PRINTAPI_BEARER)
    const token = await getAccessToken();

    const apiUrl = "https://test.printapi.nl/v2/orders";

    const orderPayload = {
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
    };

    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(orderPayload)
    });

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text }

    res.json({
      status: r.status,
      response: json
    });

  } catch (e) {
    // ausführliche Fehlermeldung (hilft bei Debugging)
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
