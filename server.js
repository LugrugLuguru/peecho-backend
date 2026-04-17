import express from "express";
import cors from "cors";

const app = express();

const corsOptions = {
  origin: "https://travelbooks.my-board.org",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());
app.options("*", cors(corsOptions));

app.get("/api/countries", async (req, res) => {
  try {
    const apiKey = process.env.PEECHO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "PEECHO_API_KEY fehlt" });
    }

    const url = `https://test.www.peecho.com/rest/v3/countries?merchantApiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Serverfehler" });
  }
});

app.post("/api/order", async (req, res) => {
  try {
    const apiKey = process.env.PEECHO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "PEECHO_API_KEY fehlt" });
    }

    const payload = {
      ...req.body,
      merchant_api_key: apiKey,
    };

    const response = await fetch("https://test.www.peecho.com/rest/v3/order/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Serverfehler" });
  }
});

app.get("/api/order/details", async (req, res) => {
  try {
    const apiKey = process.env.PEECHO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "PEECHO_API_KEY fehlt" });
    }

    const { environment, orderId } = req.query;
    if (!orderId) {
      return res.status(400).json({ error: "orderId fehlt" });
    }

    const baseUrl =
      environment === "https://www.peecho.com"
        ? "https://www.peecho.com"
        : "https://test.www.peecho.com";

    const url = new URL(`${baseUrl}/rest/v3/order/details`);
    url.searchParams.set("merchantApiKey", apiKey);
    url.searchParams.set("orderId", String(orderId));

    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await response.text();
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Serverfehler" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server läuft auf Port ${port}`);
});
