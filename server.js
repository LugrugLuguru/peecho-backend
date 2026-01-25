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
 * 🔍 Verbesserte Probe-Endpunkt
 * - testet mehrere mögliche Pfade
 * - führt zuerst OPTIONS aus (um Allow-Header zu sehen)
 * - versucht anschließend POST mit mehreren Header-Varianten
 * - gibt Status, Allow-Header, Response-Header und Body (gekürzt) zurück
 */
app.get("/peecho-probe", async (req, res) => {
  try {
    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured" });
    }

    // Minimal gültiges payload (klein, nur für Probe)
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

    // Mögliche Pfad-Varianten, die wir probeweise testen
    const paths = [
      "/rest/publications",
      "/rest/publications/",
      "/rest/orders",
      "/rest/order",
      "/rest/orders/",
      "/rest/order/",
      "/rest/print-jobs",
      "/rest/print-jobs/",
      "/rest/print_jobs",
      "/rest/print_jobs/",
      "/rest/create-order",
      "/rest/create_order",
      "/rest/publication",
      "/rest/publication/"
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

    // Helper: safe header->object
    const headersToObject = (headers) => {
      const obj = {};
      try {
        for (const [k, v] of headers.entries()) obj[k] = v;
      } catch (e) { /* ignore */ }
      return obj;
    };

    // Probe: für jeden Pfad OPTIONS (um Allow) + POST (mit Variants)
    for (const p of paths) {
      const url = `${PEECHO_BASE.replace(/\/$/, "")}${p}`;
      const entry = { url, probes: [] };

      // 1) OPTIONS (häufig zeigt Allow: POST, GET, ...)
      try {
        const opt = await fetch(url, {
          method: "OPTIONS",
          headers: {
            "Accept": "application/json"
          }
        });
        entry.probes.push({
          step: "OPTIONS",
          status: opt.status,
          statusText: opt.statusText,
          allow: opt.headers.get("allow") || opt.headers.get("Allow") || null,
          responseHeaders: headersToObject(opt.headers)
        });
      } catch (err) {
        entry.probes.push({ step: "OPTIONS", error: String(err) });
      }

      // 2) POST mit verschiedenen Header-Varianten
      for (const hv of headerVariants) {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: hv.headers,
            body: JSON.stringify(payload)
          });

          const text = await r.text().catch(() => "");
          entry.probes.push({
            step: `POST (${hv.name})`,
            status: r.status,
            statusText: r.statusText,
            responseHeaders: headersToObject(r.headers),
            bodySnippet: text ? text.slice(0, 800) : ""
          });
        } catch (err) {
          entry.probes.push({
            step: `POST (${hv.name})`,
            error: String(err)
          });
        }
      }

      // 3) zusätzlich versuchen wir eine GET (manchmal 405 vs 200 unterscheidet)
      try {
        const g = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
        const txt = await g.text().catch(() => "");
        entry.probes.push({
          step: "GET",
          status: g.status,
          statusText: g.statusText,
          responseHeaders: headersToObject(g.headers),
          bodySnippet: txt ? txt.slice(0, 800) : ""
        });
      } catch (err) {
        entry.probes.push({ step: "GET", error: String(err) });
      }

      results.push(entry);
    }

    res.json({
      peechoBase: PEECHO_BASE,
      offeringId: PEECHO_OFFERING_ID,
      timestamp: new Date().toISOString(),
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
