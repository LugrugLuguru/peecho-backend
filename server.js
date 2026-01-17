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

/* =======================================================
   MAIN ROUTE
   ======================================================= */
app.post("/upload-pdf", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    /* ===== 1. Upload to Supabase ===== */
    const storagePath = `pdfs/${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    const buffer = fs.readFileSync(file.path);

    const { error } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf"
      });

    if (error) throw error;

    const { data } = supabase
      .storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = data.publicUrl;

    /* ===== 2. Upload PDF to Peecho (FIXED ENDPOINT) ===== */
    const form = new FormData();
    form.append("file", fs.createReadStream(file.path), file.originalname);
    form.append("file_type", "pdf");

    const peechoRes = await fetch(
      `${PEECHO_BASE}/rest/v3/files/upload/`,
      {
        method: "POST",
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${PEECHO_API_KEY}`
        },
        body: form
      }
    );

    const peechoText = await peechoRes.text();

    if (!peechoRes.ok) {
      return res.status(500).json({
        error: "Peecho file upload failed",
        status: peechoRes.status,
        details: peechoText
      });
    }

    const peechoFile = JSON.parse(peechoText);

    /* ===== 3. Create Order ===== */
    const orderRes = await fetch(
      `${PEECHO_BASE}/rest/v3/orders/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PEECHO_API_KEY}`,
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
      }
    );

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
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

/* ===== START ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
