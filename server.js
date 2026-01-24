import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PEECHO_API = "https://test.www.peecho.com";
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;

app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body;

    if (!contentUrl || !pageCount) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const payload = {
      title: "Mein Buch",
      description: "A4 Hardcover",
      language: "de",
      currency: "EUR",
      products: [
        {
          offering_id: "BOOK_HARDCOVER_A4",
          page_count: pageCount,
          files: {
            interior: contentUrl
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
      console.error(json);
      return res.status(500).json({
        error: "Peecho order failed",
        details: json
      });
    }

    res.json({
      publicationId: json.id,
      checkoutUrl: `https://test.www.peecho.com/print/${json.id}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000);
