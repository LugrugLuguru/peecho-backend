import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const app = express();
const upload = multer({ dest: "tmp/" });

/* ===== ENV ===== */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "uploads";

const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_BASE = process.env.PEECHO_BASE || "https://test.www.peecho.com";
const OFFERING_ID = Number(process.env.PEECHO_OFFERING_ID || "6884792");

/* ===== CLIENTS ===== */
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ===== CORS ===== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* =======================================================
   MAIN ROUTE: matches your HTML (POST /upload-pdf)
   - expects field name "file" (FormData)
   - 1) save to Supabase (backup)
   - 2) upload to Peecho (multipart, minimal fields)
   - 3) create order at Peecho
   ======================================================= */
app.post("/upload-pdf", upload.single("file"), async (req, res) => {
  const tmpPath = req?.file?.path;
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded (field name 'file')" });
    }

    // === 1) Upload to Supabase Storage (backup) ===
    const storagePath = `pdfs/${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    const buffer = fs.readFileSync(file.path);

    const { error: uploadError } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, buffer, { contentType: "application/pdf" });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      throw uploadError;
    }

    const { data: publicData } = supabase
      .storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = publicData?.publicUrl ?? null;

    console.log("Supabase publicUrl:", publicUrl);

    // debug: ensure PEECHO_API_KEY available
    console.log("Using Peecho key present:", !!PEECHO_API_KEY);

    // === 2) Upload file to Peecho (multipart) ===
    // Use minimal required fields: file + file_type (do not include offering_id here)
    const form = new FormData();
    form.append("file", fs.createReadStream(file.path), file.originalname);
    form.append("file_type", "pdf");

    // Merge form headers (boundary) with Authorization
    const formHeaders = form.getHeaders();
    const peechoFileUrl = `${PEECHO_BASE.replace(/\/$/, "")}/rest/v3/files/`;

    console.log("POST file to Peecho URL:", peechoFileUrl);
    console.log("Peecho request headers preview:", Object.keys(formHeaders));

    const peechoFileRes = await fetch(peechoFileUrl, {
      method: "POST",
      headers: {
        ...formHeaders,
        Authorization: `Bearer ${PEECHO_API_KEY}`
      },
      body: form
    });

    const peechoFileText = await peechoFileRes.text();
    console.log("Peecho file upload status:", peechoFileRes.status, peechoFileRes.statusText);
    console.log("Peecho file upload content-type:", peechoFileRes.headers.get("content-type"));
    // if not ok, return detailed debug info (truncated) to help diagnose
    if (!peechoFileRes.ok) {
      console.error("Peecho file upload failed, raw response:", peechoFileText);
      return res.status(502).json({
        error: "Peecho file upload failed",
        status: peechoFileRes.status,
        statusText: peechoFileRes.statusText,
        headers: Object.fromEntries(peechoFileRes.headers.entries()),
        details: peechoFileText ? (peechoFileText.length > 4000 ? peechoFileText.slice(0, 4000) : peechoFileText) : ""
      });
    }

    let peechoFile;
    try {
      peechoFile = JSON.parse(peechoFileText);
    } catch (e) {
      console.error("Peecho file returned non-JSON:", peechoFileText);
      return res.status(502).json({
        error: "Peecho returned non-JSON for file upload",
        details: peechoFileText
      });
    }

    // Ensure we have ID from Peecho
    if (!peechoFile?.id) {
      console.error("Peecho file response missing id:", peechoFile);
      return res.status(502).json({
        error: "Peecho file response missing id",
        details: peechoFile
      });
    }

    // === 3) Create order at Peecho ===
    const orderUrl = `${PEECHO_BASE.replace(/\/$/, "")}/rest/v3/orders/`;
    const orderBody = {
      currency: "EUR",
      item_details: [
        {
          item_reference: "travelbook",
          offering_id: OFFERING_ID,
          quantity: 1,
          file_details: {
            file_id: peechoFile.id,
            file_type: "pdf"
          }
        }
      ]
    };

    console.log("Creating order at Peecho, offering:", OFFERING_ID);
    const orderRes = await fetch(orderUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PEECHO_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(orderBody)
    });

    const orderText = await orderRes.text();
    console.log("Peecho order status:", orderRes.status, orderRes.statusText);

    if (!orderRes.ok) {
      console.error("Order creation failed, body:", orderText);
      return res.status(502).json({
        error: "Order creation failed",
        status: orderRes.status,
        statusText: orderRes.statusText,
        details: orderText ? (orderText.length > 4000 ? orderText.slice(0,4000) : orderText) : ""
      });
    }

    let orderJson;
    try {
      orderJson = JSON.parse(orderText);
    } catch (e) {
      console.error("Order returned non-JSON:", orderText);
      return res.status(502).json({ error: "Order returned non-JSON", details: orderText });
    }

    // cleanup temp file
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) { console.warn("Could not unlink tmp file:", e); }

    // success
    return res.json({
      success: true,
      supabaseFile: publicUrl,
      peechoFile,
      order: orderJson
    });

  } catch (err) {
    console.error("Unhandled exception:", err);
    // try cleanup tmp file
    try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { console.warn("cleanup fail:", e); }
    return res.status(500).json({ error: String(err) });
  }
});

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
