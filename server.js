// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PEECHO_BASE = process.env.PEECHO_BASE || "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID || 0;

// --- kleines Request-Logging ---
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * 🔍 Probe-Endpunkt
 * Testet verschiedene Varianten von /rest/publications
 * ohne echte Bestellung
 */
app.get("/peecho-probe", async (req, res) => {
  try {
    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured" });
    }

    const payload = {
      title: "Probe Publication",
      language: "de",
      products: [
        {
          offering_id: Number(PEECHO_OFFERING_ID) || 1,
          page_count: 2,
          file_details: {
            interior: {
              url: "https://example.com/dummy.pdf"
            }
          }
        }
      ]
    };

    const urls = [
      `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications`,
      `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications/`
    ];

    const headerVariants = [
      {
        name: "Authorization ApiKey",
        headers: {
          "Authorization": `ApiKey ${PEECHO_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      },
      {
        name: "X-Api-Key",
        headers: {
          "X-Api-Key": PEECHO_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      },
      {
        name: "Both",
        headers: {
          "Authorization": `ApiKey ${PEECHO_API_KEY}`,
          "X-Api-Key": PEECHO_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    ];

    const results = [];

    for (const url of urls) {
      for (const hv of headerVariants) {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: hv.headers,
            body: JSON.stringify(payload)
          });

          const text = await r.text();

          results.push({
            url,
            headerVariant: hv.name,
            status: r.status,
            statusText: r.statusText,
            body: text.slice(0, 500)
          });
        } catch (err) {
          results.push({
            url,
            headerVariant: hv.name,
            error: String(err)
          });
        }
      }
    }

    res.json({
      peechoBase: PEECHO_BASE,
      offeringId: PEECHO_OFFERING_ID,
      results
    });

  } catch (err) {
    console.error("Probe error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
