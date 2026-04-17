import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/api/order", async (req, res) => {
  try {
    const payload = req.body;

    const peechoPayload = {
      ...payload,
      merchant_api_key: process.env.PEECHO_API_KEY
    };

    const response = await fetch("https://test.www.peecho.com/rest/v3/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(peechoPayload)
    });

    const data = await response.text();
    res.status(response.status).send(data);

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => console.log("Server läuft"));
