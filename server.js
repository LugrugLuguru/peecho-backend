import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CORS (WICHTIG) ---------- */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

/* ---------- JSON ---------- */
app.use(express.json());

/* ---------- TEST ROUTE ---------- */
app.post("/test", (req, res) => {
  console.log("BODY:", req.body);

  res.json({
    ok: true,
    message: "Backend erreichbar",
    received: req.body
  });
});

/* ---------- HEALTH ---------- */
app.get("/", (req, res) => {
  res.send("Backend läuft");
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
