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
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID;

// ---------- Logging ----------
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// ---------- PROBE ENDPOINT ----------
/**
 * This endpoint is meant ONLY for Peecho support diagnostics.
 * It tests OPTIONS + POST and returns all response headers.
 */
app.get("/peecho-probe", async (req, res) => {
  const timestamp = new Date().toISOString();

  if (!PEECHO_API_KEY) {
    return res.status(500).json({ error: "PEECHO_API_KEY missing" });
  }

  const targetUrl = `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications`;

  const payload = {
    title: "API Probe Publication",
    language: "en",
    products: [
      {
        offering_id: Number(PEECHO_OFFERING_ID || 1),
        page_count: 2,
        file_details: {
          interior: {
            url: "https://example.com/dummy.pdf"
          }
        }
      }
    ]
  };

  const results = [];

  // ---- OPTIONS ----
  try {
    const r = await fetch(targetUrl, { method: "OPTIONS" });
    results.push({
      step: "OPTIONS",
      status: r.status,
      statusText: r.statusText,
      allow: r.headers.get("allow"),
      responseHeaders: Object.fromEntries(r.headers.entries())
    });
  } catch (err) {
    results.push({ step: "OPTIONS", error: String(err) });
  }

  // ---- POST ----
  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Authorization": `ApiKey ${PEECHO_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Peecho-API-Probe/1.0"
      },
      body: JSON.stringify(payload)
    });

    const bodyText = await r.text();

    results.push({
      step: "POST",
      status: r.status,
      statusText: r.statusText,
      allow: r.headers.get("allow"),
      responseHeaders: Object.fromEntries(r.headers.entries()),
      bodySnippet: bodyText.slice(0, 800)
    });
  } catch (err) {
    results.push({ step: "POST", error: String(err) });
  }

  res.json({
    timestamp,
    peechoBase: PEECHO_BASE,
    offeringId: PEECHO_OFFERING_ID,
    testedEndpoint: targetUrl,
    results,
    supportHint:
      "POST is rejected with 405 and Allow: GET, HEAD. This indicates server-side method restriction or missing permissions on Peecho test environment."
  });
});

// ---------- HEALTH ----------
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Peecho diagnostic backend running on port ${PORT}`);
});
