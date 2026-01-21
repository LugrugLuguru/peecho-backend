import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Backend läuft");
});

app.post("/test", async (req, res) => {
  try {
    if (!process.env.PRINTAPI_API_KEY) {
      return res.status(500).json({
        error: "PRINTAPI_API_KEY missing in env"
      });
    }

    const r = await fetch("https://test.printapi.nl/v2/me", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTAPI_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const text = await r.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "PrintAPI returned non-JSON",
        raw: text
      });
    }

    res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      data: json
    });

  } catch (err) {
    res.status(500).json({
      error: "Server exception",
      message: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf", PORT);
});
