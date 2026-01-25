import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PEECHO_BASE = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID;

// Endpoint für Publications (Checkout-Flow)
// Dokumentation: POST /rest/publications erstellt ein Product Listing
// Danach kann man zu /print/{id} redirecten für Checkout
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    if (!contentUrl || !pageCount) {
      return res.status(400).json({ error: "Missing fields: contentUrl and pageCount required" });
    }

    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured" });
    }

    if (!PEECHO_OFFERING_ID) {
      return res.status(500).json({ error: "PEECHO_OFFERING_ID not configured" });
    }

    // Laut API v3 Dokumentation: Product listing-publication
    // Create a product listing that users can order via the Peecho Checkout
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

    // -- WICHTIG: Zusätzliche Header für bessere Kompatibilität:
    //  - Accept: application/json
    //  - X-Api-Key: fallback header falls Peecho diese Variante erwartet
    //  - User-Agent: einige APIs verlangen expliziten UA
    const peechoUrl = `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications/`; // trailing slash added
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
      // credentials not needed for server-to-server
    });

    const text = await r.text();
    console.log("Peecho response status:", r.status);
    console.log("Peecho response body:", text);

    if (!r.ok) {
      return res.status(r.status).json({
        error: "Peecho publication creation failed",
        status: r.status,
        body: text,
        hint: "Check API key and offering_id in environment variables (and that the API supports /rest/publications/). See Peecho API v3 doc."
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

    // Dokumentation: Nach Erstellung zu /print/{ID} für Checkout
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
