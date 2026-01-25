import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PEECHO_BASE = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID;

/* ---------------- PDF UPLOAD ---------------- */

app.post("/upload-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const userId = req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const filePath = `${userId}/content-${crypto.randomUUID()}.pdf`;

    const supabaseUploadUrl =
      `${SUPABASE_URL}/storage/v1/object/print-files/${filePath}`;

    const r = await fetch(supabaseUploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/pdf",
        "x-upsert": "false"
      },
      body: req.file.buffer
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ error: "Supabase upload failed", details: t });
    }

    // Signed URL
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/print-files/${filePath}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ expiresIn: 3600 })
      }
    );

    const signed = await signRes.json();

    res.json({
      contentUrl: signed.signedURL
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- PEECHO ORDER ---------------- */

app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    const payload = {
      title: "A4 Hardcover Test",
      language: "de",
      products: [
        {
          offering_id: Number(PEECHO_OFFERING_ID),
          page_count: Number(pageCount),
          file_details: {
            interior: { url: contentUrl }
          }
        }
      ]
    };

    const r = await fetch(`${PEECHO_BASE}/rest/publications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PEECHO_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const json = await r.json();

    if (!r.ok) {
      return res.status(r.status).json(json);
    }

    res.json({
      orderId: json.id,
      checkoutUrl: `${PEECHO_BASE}/print/${json.id}`
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () =>
  console.log("✅ Backend running on port 3000")
);
