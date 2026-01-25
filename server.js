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
const PEECHO_OFFERING_ID = Number(process.env.PEECHO_OFFERING_ID || 0);

// --- kleines Request-Logging ---
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * ✅ Richtiger Probe-Endpunkt
 * Testet POST /rest/print-jobs (kein echter Kauf)
 */
app.get("/peecho-probe", async (req, res) => {
  try {
    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured" });
    }
    if (!PEECHO_OFFERING_ID) {
      return res.status(500).json({ error: "PEECHO_OFFERING_ID not configured" });
    }

    const url = `${PEECHO_BASE.replace(/\/$/, "")}/rest/print-jobs`;

    const payload = {
      offering_id: PEECHO_OFFERING_ID,
      quantity: 1,
      file_details: {
        interior: {
          // MUSS öffentlich erreichbar sein
          url: "https://example.com/dummy.pdf"
        }
      },
      shipping_address: {
        country: "DE"
      }
    };

    console.log("➡️ Peecho request payload:", payload);

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `ApiKey ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();

    res.json({
      peechoBase: PEECHO_BASE,
      endpoint: "/rest/print-jobs",
      status: r.status,
      statusText: r.statusText,
      body: text.slice(0, 1000)
    });

  } catch (err) {
    console.error("❌ Peecho probe error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
