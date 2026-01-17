// server.js — diagnostic version: tries Basic and Bearer, returns full responses for both
import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import FormData from "form-data";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const app = express();
const upload = multer({ dest: "tmp/" });

/* ===== ENV (trim key!!) ===== */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "uploads";

let PEECHO_API_KEY = process.env.PEECHO_API_KEY ?? "";
if (typeof PEECHO_API_KEY === "string") PEECHO_API_KEY = PEECHO_API_KEY.trim();

const PEECHO_BASE = (process.env.PEECHO_BASE || "https://test.www.peecho.com").replace(/\/$/, "");
const OFFERING_ID = Number(process.env.PEECHO_OFFERING_ID || "6884792");

/* ===== clients ===== */
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ===== CORS ===== */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* helper to mask key for logs */
function maskKey(key) {
  if (!key) return null;
  if (key.length <= 10) return key.slice(0, 3) + "...";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

/* attempt upload with given headers; returns { ok, status, statusText, headers, text } */
async function attemptFileUpload(peechoUrl, form, headers) {
  try {
    const res = await fetch(peechoUrl, {
      method: "POST",
      headers,
      body: form
    });
    const text = await res.text();
    const hdrs = {};
    res.headers.forEach((v, k) => (hdrs[k] = v));
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: hdrs,
      text: text
    };
  } catch (e) {
    return { ok: false, status: 0, statusText: String(e), headers: {}, text: "" };
  }
}

app.post("/upload-pdf", upload.single("file"), async (req, res) => {
  const tmpPath = req?.file?.path;
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded (field 'file')" });

    // 1) Supabase backup (best-effort)
    const storagePath = `pdfs/${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
    const buffer = fs.readFileSync(file.path);
    let publicUrl = null;
    try {
      const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(storagePath, buffer, { contentType: "application/pdf" });
      if (!uploadError) {
        const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath);
        publicUrl = data?.publicUrl ?? null;
      } else {
        console.warn("Supabase upload error (non-fatal):", uploadError);
      }
    } catch (e) {
      console.warn("Supabase upload exception (non-fatal):", String(e));
    }

    // Prepare form for Peecho (file + file_type)
    const form = new FormData();
    form.append("file", fs.createReadStream(file.path));
    form.append("file_type", "pdf");

    const peechoFileEndpoint = `${PEECHO_BASE}/rest/v3/files/upload`;

    // Build headers for form (boundary)
    const formHeaders = form.getHeaders ? form.getHeaders() : {};

    // 1) Try Basic Auth
    const basicAuth = "Basic " + Buffer.from(`${PEECHO_API_KEY}:`).toString("base64");
    const headersBasic = { ...formHeaders, Authorization: basicAuth };

    console.log("Attempting Peecho file upload (Basic). Endpoint:", peechoFileEndpoint);
    console.log("Peecho masked key:", maskKey(PEECHO_API_KEY));
    console.log("Form headers keys:", Object.keys(formHeaders));

    const resultBasic = await attemptFileUpload(peechoFileEndpoint, form, headersBasic);

    // If Basic returned a non-OK and specifically a 401/405, try Bearer as a diagnostic step
    let resultBearer = null;
    if (!resultBasic.ok) {
      // recreate form stream for second request (FormData streams can't be reused reliably)
      const form2 = new FormData();
      form2.append("file", fs.createReadStream(file.path));
      form2.append("file_type", "pdf");
      const form2Headers = form2.getHeaders ? form2.getHeaders() : {};
      const headersBearer = { ...form2Headers, Authorization: `Bearer ${PEECHO_API_KEY}` };

      console.log("Basic failed (status:", resultBasic.status, "). Attempting Peecho file upload (Bearer) for diagnostics.");
      resultBearer = await attemptFileUpload(peechoFileEndpoint, form2, headersBearer);
    }

    // Cleanup tmp file now (we keep supabase backup even if peecho fails)
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) { console.warn("tmp unlink fail:", e); }

    // If Basic succeeded, parse JSON and proceed to order
    if (resultBasic.ok) {
      let peechoFileJson;
      try { peechoFileJson = JSON.parse(resultBasic.text); } catch (e) {
        return res.status(502).json({ error: "Peecho returned non-JSON", details: resultBasic.text, resultBasic });
      }

      // Create order using Basic auth (use same basicAuth)
      const orderUrl = `${PEECHO_BASE}/rest/v3/orders`;
      const orderBody = {
        currency: "EUR",
        item_details: [
          {
            item_reference: "travelbook",
            offering_id: OFFERING_ID,
            quantity: 1,
            file_details: { file_id: peechoFileJson.id, file_type: "pdf" }
          }
        ]
      };

      const orderRes = await fetch(orderUrl, {
        method: "POST",
        headers: { Authorization: basicAuth, "Content-Type": "application/json" },
        body: JSON.stringify(orderBody)
      });
      const orderText = await orderRes.text();
      const orderHdrs = {};
      orderRes.headers.forEach((v, k) => (orderHdrs[k] = v));

      if (!orderRes.ok) {
        return res.status(502).json({
          error: "Order creation failed",
          uploadResult: resultBasic,
          order: { status: orderRes.status, statusText: orderRes.statusText, headers: orderHdrs, details: orderText }
        });
      }

      let orderJson;
      try { orderJson = JSON.parse(orderText); } catch (e) {
        return res.status(502).json({ error: "Order returned non-JSON", details: orderText });
      }

      return res.json({
        success: true,
        supabaseFile: publicUrl,
        peechoFile: peechoFileJson,
        order: orderJson,
        debug: { uploadBasic: resultBasic, uploadBearer: resultBearer }
      });
    }

    // If Basic failed, return diagnostic object with both attempts
    return res.status(502).json({
      error: "Peecho file upload failed (both attempts)",
      uploadBasic: resultBasic,
      uploadBearer: resultBearer
    });

  } catch (err) {
    try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { console.warn("cleanup fail:", e); }
    console.error("Unhandled server error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
