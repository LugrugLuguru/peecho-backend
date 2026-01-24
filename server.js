import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PEECHO_BASE = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID;

app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    if (!contentUrl || !pageCount) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const payload = {
      title: "A4 Hardcover Test",
      language: "de",
      products: [
        {
          offering_id: PEECHO_OFFERING_ID,
          page_count: pageCount,
          files: {
            interior: contentUrl
          }
        }
      ]
    };

    const r = await fetch(`${PEECHO_BASE}/rest/publications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `ApiKey ${PEECHO_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();

    if (!r.ok) {
      console.error("Peecho error:", text);
      return res.status(500).json({
        error: "Peecho publication creation failed",
        status: r.status,
        body: text
      });
    }

    const json = JSON.parse(text);

    res.json({
      orderId: json.id,
      checkoutUrl: `${PEECHO_BASE}/print/${json.id}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("✅ Peecho TEST backend running")
);
