import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ====================
// MIDDLEWARE
// ====================
app.use(cors());
app.use(express.json());

// ====================
// TEST ROUTE
// ====================
app.post("/test", async (req, res) => {
  try {
    const response = await fetch(
      "https://test.printapi.nl/v2/me",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${process.env.PRINTAPI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    res.json({
      success: true,
      printapi_response: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ====================
// SERVER START
// ====================
app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
