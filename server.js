// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// --- Middlewares ---
app.use(cors()); // einfache CORS-Unterstützung (preflight etc.)
app.use(express.json({ limit: "10mb" })); // body parser, etwas großzügiger
// Einfaches Request-Logging für Debugging:
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} -> ${req.method} ${req.originalUrl}`);
  // show a subset of headers we care about (avoid dumping secrets)
  const headersToLog = (({ host, origin, referer, "user-agent": ua, "content-type": ct }) => ({
    host, origin, referer, "user-agent": ua, "content-type": ct
  }))(req.headers);
  console.log("[REQ-HEADERS]", headersToLog);
  next();
});

const PEECHO_BASE = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID;

// Preflight/OPTIONS für order-book explizit beantworten (sorgt für saubere CORS-Preflights)
app.options("/order-book", cors());

// Fallback: wenn andere Methoden auf /order-book ankommen, geben wir eine informative 405
app.all("/order-book", (req, res, next) => {
  if (req.method !== "POST") {
    res.set("Allow", "POST, OPTIONS");
    return res.status(405).json({
      error: "Method Not Allowed on /order-book",
      allowed: ["POST", "OPTIONS"],
      receivedMethod: req.method
    });
  }
  next();
});

// Endpoint für Publications (Checkout-Flow)
app.post("/order-book", async (req, res) => {
  try {
    console.log("[/order-book] Handling POST");

    const { contentUrl, pageCount } = req.body;
    console.log("[/order-book] body:", { pageCount, contentUrl: !!contentUrl });

    if (!contentUrl || !pageCount) {
      return res.status(400).json({ error: "Missing fields: contentUrl and pageCount required" });
    }

    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured" });
    }

    if (!PEECHO_OFFERING_ID) {
      return res.status(500).json({ error: "PEECHO_OFFERING_ID not configured" });
    }

    const payload = {
      title: "A4 Hardcover Test",
      language: "de",
      products: [
        {
          offering_id: Number(PEECHO_OFFERING_ID),
          page_count: Number(pageCount),
          file_details: {
            interior: {
              url: contentUrl
            }
          }
        }
      ]
    };

    console.log("Sending to Peecho:", JSON.stringify(payload, null, 2));
    console.log("Using API Key:", PEECHO_API_KEY ? "***" + PEECHO_API_KEY.slice(-4) : "MISSING");

    const peechoUrl = `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications/`;
    const r = await fetch(peechoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `ApiKey ${PEECHO_API_KEY}`,
        "X-Api-Key": PEECHO_API_KEY,
        "User-Agent": "peecho-integration/1.0 (+https://your-app.example)"
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    console.log("Peecho response status:", r.status);
    console.log("Peecho response body:", text);

    if (!r.ok) {
      return res.status(r.status).json({
        error: "Peecho publication creation failed",
        status: r.status,
        body: text,
        hint: "Check API key and offering_id in environment variables (and that the API supports /rest/publications/). See Peecho API docs."
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "Invalid JSON response from Peecho",
        body: text
      });
    }

    res.json({
      orderId: json.id,
      checkoutUrl: `${PEECHO_BASE.replace(/\/$/, "")}/print/${json.id}`
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Peecho TEST backend running on port ${PORT}`)
);
