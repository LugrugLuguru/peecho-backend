// server.js (probe-ready)
// Vollständige Datei — ersetze deine aktuelle server.js damit oder ergänze nur den /peecho-probe handler.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PEECHO_BASE = process.env.PEECHO_BASE || "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID || 0;

// --- kleines Request-Logger-Middleware ---
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// --- Probe endpoint ---
// Ruft Peecho mit verschiedenen Header-/URL-Varianten auf und gibt die Ergebnisse zurück.
app.get("/peecho-probe", async (req, res) => {
  try {
    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured in env" });
    }

    const payload = {
      title: "Probe - should not create production order",
      language: "de",
      // Minimal product entry; this is only for probing endpoints — no charge in test env.
      products: [
        {
          offering_id: Number(PEECHO_OFFERING_ID) || 1,
          page_count: 2,
          file_details: { interior: { url: "https://example.com/dummy.pdf" } }
        }
      ]
    };

    const urls = [
      `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications`,    // no trailing slash
      `${PEECHO_BASE.replace(/\/$/, "")}/rest/publications/`    // trailing slash
    ];

    const headerVariants = [
      { name: "Authorization-ApiKey", headers: { "Authorization": `ApiKey ${PEECHO_API_KEY}`, "Content-Type":"application/json", "Accept":"application/json" } },
      { name: "X-Api-Key", headers: { "X-Api-Key": PEECHO_API_KEY, "Content-Type":"application/json", "Accept":"application/json" } },
      { name: "Both", headers: { "Authorization": `ApiKey ${PEECHO_API_KEY}`, "X-Api-Key": PEECHO_API_KEY, "Content-Type":"application/json", "Accept":"application/json" } }
    ];

    const results = [];

    for (const url of urls) {
      for (const hv of headerVariants) {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: hv.headers,
            body: JSON.stringify(payload),
            // set a short timeout by manual abort if you want (not here)
          });

          const text = await r.text();
          results.push({
            url,
            headerVariant: hv.name,
            status: r.status,
            statusText: r.statusText,
            bodySnippet: text ? (text.length > 800 ? text.slice(0,800) + "…(truncated)" : text) : ""
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

    // Zusätzliche Info: zeige die exact used PEECHO_BASE and offering id
    res.json({ probeAt: new Date().toISOString(), peechoBase: PEECHO_BASE, offeringId: PEECHO_OFFERING_ID, results });
  } catch (err) {
    console.error("Probe error:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok", now: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Probe backend running on port ${PORT}`));
