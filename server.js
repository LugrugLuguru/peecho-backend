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
const SUPABASE_BUCKET = "uploads";

const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_BASE = "https://test.www.peecho.com";
const OFFERING_ID = Number(process.env.PEECHO_OFFERING_ID);

/* ===== CLIENTS ===== */
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* ===== CORS ===== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* ===== ROUTE ===== */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    /* === 1. Upload to Supabase Storage === */
    const storagePath = `uploads/${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    const buffer = fs.readFileSync(file.path);

    const { error: uploadError } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf"
      });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase
      .storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = publicData.publicUrl;

    /* === 2. Upload PDF to Peecho === */
    const form = new FormData();
    form.append("file", fs.createReadStream(file.path), file.originalname);
    form.append("file_type", "pdf");
    form.append("print_intent", "book");
    form.append("offering_id", OFFERING_ID);

    const auth = "Basic " + Buffer.from(`${PEECHO_API_KEY}:`).toString("base64");

    const peechoFileRes = await fetch(`${PEECHO_BASE}/rest/v3/files/`, {
      method: "POST",
      headers: { Authorization: auth },
      body: form
    });

    const peechoFileText = await peechoFileRes.text();
    if (!peechoFileRes.ok) {
      return res.status(500).json({
        error: "Peecho file upload failed",
        details: peechoFileText
      });
    }

    const peechoFile = JSON.parse(peechoFileText);

    /* === 3. Create Order === */
    const orderRes = await fetch(`${PEECHO_BASE}/rest/v3/orders/`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currency: "EUR",
        item_details: [
          {
            item_reference: "travelbook",
            offering_id: OFFERING_ID,
            quantity: 1,
            file_details: {
              file_id: peechoFile.id
            }
          }
        ]
      })
    });

    const orderText = await orderRes.text();
    if (!orderRes.ok) {
      return res.status(500).json({
        error: "Order creation failed",
        details: orderText
      });
    }

    fs.unlinkSync(file.path);

    res.json({
      success: true,
      supabaseFile: publicUrl,
      peechoFile,
      order: JSON.parse(orderText)
    });

  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
