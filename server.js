import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PEECHO_API = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;

// ✅ CHECKOUT = PUBLICATION
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, coverUrl, pageCount } = req.body;

    if (!contentUrl || !coverUrl || !pageCount) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // 🔹 A4 Hardcover Book (Beispiel – MUSS zu deinem Account passen!)
    const offeringId = "BOOK_HARDCOVER_A4";

    const payload = {
      title: "Mein A4 Hardcover Buch",
      description: "Gedruckt über Peecho API",
      language: "de",
      currency: "EUR",
      products: [
        {
          offering_id: offeringId,
          page_count: pageCount,
          files: {
            interior: contentUrl,
            cover: coverUrl
          }
        }
      ]
    };

    const r = await fetch(`${PEECHO_API}/publication/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PEECHO_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const json = await r.json();

    if (!r.ok) {
      console.error("Peecho error:", json);
      return res.status(500).json({
        error: "Peecho publication failed",
        details: json
      });
    }

    const publicationId = json.id;
    const checkoutUrl = `https://test.www.peecho.com/print/${publicationId}`;

    res.json({
      publicationId,
      checkoutUrl
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", details: e.message });
  }
});

app.listen(3000, () => {
  console.log("✅ Peecho backend running on port 3000");
});
