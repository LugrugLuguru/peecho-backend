import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["POST", "GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// ✅ Test-Route (die du gerade benutzt hast)
app.post("/test", (req, res) => {
  res.json({
    ok: true,
    message: "Backend erreichbar",
    received: req.body
  });
});

// 🔴 PRINTAPI TEST
app.post("/print-test", async (req, res) => {
  try {
    const PRINTAPI_KEY = process.env.PRINTAPI_KEY;
    if (!PRINTAPI_KEY) {
      return res.status(500).json({ error: "PRINTAPI_KEY fehlt" });
    }

    const r = await fetch("https://test.printapi.nl/v2/orders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PRINTAPI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: "testkunde@example.com",
        items: [{
          productId: "poster_a4_sta",
          quantity: 1
        }],
        shipping: {
          address: {
            name: "Max Mustermann",
            line1: "Musterstraße 1",
            postCode: "12345",
            city: "Musterstadt",
            country: "DE"
          }
        }
      })
    });

    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text }

    res.json({
      status: r.status,
      response: json
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
