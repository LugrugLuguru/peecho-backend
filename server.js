import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * HTML direkt ausliefern
 */
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>PrintAPI Test</title>
</head>
<body>
  <h1>PrintAPI Verbindung testen</h1>
  <button onclick="test()">Test starten</button>
  <pre id="out">Warte…</pre>

  <script>
    async function test() {
      const out = document.getElementById("out");
      out.textContent = "Sende Anfrage…";

      const res = await fetch("/test", { method: "POST" });
      const data = await res.json();

      out.textContent = JSON.stringify(data, null, 2);
    }
  </script>
</body>
</html>
  `);
});

/**
 * API-Test
 */
app.post("/test", async (req, res) => {
  try {
    const r = await fetch("https://test.printapi.nl/v2/me", {
      headers: {
        Authorization: `Bearer ${process.env.PRINTAPI_API_KEY}`
      }
    });

    const data = await r.json();

    res.json({
      ok: r.ok,
      status: r.status,
      data
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf", PORT);
});
