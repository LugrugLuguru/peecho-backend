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

    const r = await fetch(`${PEECHO_BASE}/rest/publications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PEECHO_API_KEY   // ✅ KORREKT
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    console.log("Peecho response status:", r.status);
    console.log("Peecho response body:", text);

    if (!r.ok) {
      return res.status(r.status).json({
        error: "Peecho publication creation failed",
        status: r.status,
        body: text
      });
    }

    const json = JSON.parse(text);

    res.json({
      orderId: json.id,
      checkoutUrl: `${PEECHO_BASE}/print/${json.id}`
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
