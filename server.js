import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

app.use(cors()); // <-- wichtig!
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

    const text = await response.text();
    res.status(response.status).send(text);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000);
