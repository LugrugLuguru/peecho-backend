import express from "express";
import cors from "cors";

const app = express();

app.use(cors({
  origin: "https://travelbooks.my-board.org",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Preflight für alle Routen
app.options("*", cors());

// Bestellung anlegen
app.post("/api/order", async (req, res) => {
  try {
    const peechoPayload = {
      ...req.body,
      merchant_api_key: process.env.PEECHO_API_KEY
    };

    const response = await fetch("https://test.www.peecho.com/rest/v3/order/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(peechoPayload)
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Order-Details abrufen
app.get("/api/order/details", async (req, res) => {
  try {
    const { environment, orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({ error: "orderId fehlt" });
    }

    const baseUrl =
      environment === "https://www.peecho.com"
        ? "https://www.peecho.com"
        : "https://test.www.peecho.com";

    const apiKey = process.env.PEECHO_API_KEY;

    const url =
      `${baseUrl}/rest/v3/order/details` +
      `?merchantApiKey=${encodeURIComponent(apiKey)}` +
      `&orderId=${encodeURIComponent(orderId)}`;

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server läuft auf Port 3000");
});


app.get("/api/countries", async (req, res) => {
  try {
    const apiKey = process.env.PEECHO_API_KEY;

    const url = `https://test.www.peecho.com/rest/v3/countries?merchantApiKey=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    const text = await response.text();
    res.status(response.status).send(text);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
