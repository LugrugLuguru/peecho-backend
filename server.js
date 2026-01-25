// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer(); // speichert Datei im memory (buffer)

const PEECHO_BASE = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dpdcgpbckdmohuffimwe.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Prüfe wichtige ENV beim Start
if (!PEECHO_API_KEY) console.warn("⚠️ PEECHO_API_KEY not configured");
if (!PEECHO_OFFERING_ID) console.warn("⚠️ PEECHO_OFFERING_ID not configured");
if (!SUPABASE_SERVICE_KEY) console.warn("⚠️ SUPABASE_SERVICE_KEY not configured");

// Supabase Admin-Client (service role key)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

app.post("/order-book", upload.single("contentFile"), async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] /order-book called (multipart upload)`);

    const file = req.file;
    const pageCount = Number(req.body?.pageCount);

    if (!file) {
      return res.status(400).json({ error: "Missing file (contentFile)" });
    }
    if (!pageCount || pageCount < 1) {
      return res.status(400).json({ error: "Missing or invalid pageCount" });
    }
    if (!SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: "SUPABASE_SERVICE_KEY not configured on server" });
    }
    if (!PEECHO_API_KEY) {
      return res.status(500).json({ error: "PEECHO_API_KEY not configured on server" });
    }
    if (!PEECHO_OFFERING_ID) {
      return res.status(500).json({ error: "PEECHO_OFFERING_ID not configured on server" });
    }

    // Generiere eindeutigen Pfad (optional: user-id einfügen falls du auth anbindest)
    const contentPath = `${crypto.randomUUID()}/${file.originalname || "upload.pdf"}`;

    console.log("Uploading to Supabase storage at:", contentPath);

    // Upload buffer mit Service Key
    const { error: upErr } = await supabaseAdmin.storage
      .from("print-files")
      .upload(contentPath, file.buffer, {
        contentType: file.mimetype || "application/pdf",
        upsert: false
      });

    if (upErr) {
      console.error("Supabase upload error:", upErr);
      return res.status(500).json({ error: "Supabase upload failed", detail: upErr });
    }

    // Erstelle temporäre signed URL (1 Stunde)
    const expiresInSec = 60 * 60;
    const { data: signedData, error: signErr } = await supabaseAdmin.storage
      .from("print-files")
      .createSignedUrl(contentPath, expiresInSec);

    if (signErr) {
      console.error("createSignedUrl error:", signErr);
      return res.status(500).json({ error: "createSignedUrl failed", detail: signErr });
    }

    const contentUrl = signedData?.signedUrl;
    if (!contentUrl) {
      return res.status(500).json({ error: "No signedUrl returned from Supabase" });
    }

    // Jetzt Peecho Publication erstellen (wie vorher)
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
