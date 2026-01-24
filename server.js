// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "GET"] }));
app.use(express.json({ limit: "30mb" }));

// Config / env
const PEECHO_BASE = process.env.PEECHO_BASE_URL || "https://test.www.peecho.com"; // Test by default
const PEECHO_API_KEY = process.env.PEECHO_API_KEY;
const PEECHO_API_SCHEME = process.env.PEECHO_API_SCHEME || "ApiKey"; // ApiKey is default; allow override (Bearer)
const PEECHO_OFFERING_ID = process.env.PEECHO_OFFERING_ID || ""; // set via env to the offering for A4 hardcover
const CHECKOUT_RETURN_URL = process.env.CHECKOUT_RETURN_URL || "https://example.com/success";

if (!PEECHO_API_KEY) {
  console.error("ERROR: Missing PEECHO_API_KEY env variable.");
  // don't crash here — but API calls will fail with clear message
}

// Helper: read response text safely
async function tryParseJson(res) {
  const txt = await res.text().catch(() => "");
  try {
    return { json: JSON.parse(txt), text: txt };
  } catch {
    return { json: null, text: txt };
  }
}

/**
 * POST /order-book
 * Body: { contentUrl: "...", pageCount: 28 }
 * Returns JSON: { orderId, checkoutUrl } on success
 */
app.post("/order-book", async (req, res) => {
  try {
    const { contentUrl, pageCount } = req.body ?? {};
    if (!contentUrl) return res.status(400).json({ error: "Missing fields", details: "contentUrl is required" });
    const pc = Number(pageCount) || undefined;

    // Build publication payload (minimal but valid)
    // We create a product listing (publication) which opens the Peecho checkout at /print/{id}
    const payload = {
      title: "A4 Hardcover - Bestellung (Test)",
      // offeringId must be set in env — this selects the product/format in Peecho dashboard
      offeringId: PEECHO_OFFERING_ID || undefined,
      // files: Peecho accepts file descriptors; fileUrl is enough for test mode here
      files: [
        {
          fileUrl: contentUrl,
          // role is optional; keep it explicit
          role: "content",
          // pageCount is optional — include if provided
          ...(pc ? { pageCount: pc } : {})
        }
      ],
      // optional: return URL after checkout (Peecho uses /print/{id} but checkout supports returnUrl during creation for some flows)
      // Not all endpoints accept returnUrl here but we'll include as "checkoutReturnUrl" only if provided by env
      ...(CHECKOUT_RETURN_URL ? { checkoutReturnUrl: CHECKOUT_RETURN_URL } : {})
    };

    console.log("Creating Peecho publication (test):", { PEECHO_BASE, offeringId: PEECHO_OFFERING_ID });

    const apiUrl = `${PEECHO_BASE}/rest/v3/publications`;
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      Authorization: `${PEECHO_API_SCHEME} ${PEECHO_API_KEY}`
    };

    const pubRes = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const parsed = await tryParseJson(pubRes);
    console.log("Peecho publication response status:", pubRes.status, "raw:", parsed.text);

    if (!pubRes.ok) {
      return res.status(pubRes.status).json({
        error: "Peecho publication creation failed",
        status: pubRes.status,
        body: parsed.json ?? parsed.text
      });
    }

    // Expecting an ID in the response (could be id or publicationId). Try common fields.
    const pubJson = parsed.json ?? {};
    const pubId = pubJson.id || pubJson.publicationId || pubJson._id;

    if (!pubId) {
      // Return full answer for debugging
      return res.status(500).json({
        error: "Peecho publication created but no id returned",
        raw: pubJson
      });
    }

    // Build checkout URL (as documented: https://test.www.peecho.com/print/{ID})
    const checkoutUrl = `${PEECHO_BASE.replace(/\/$/, "")}/print/${pubId}`;

    return res.json({ orderId: pubId, checkoutUrl, rawPublication: pubJson });

  } catch (e) {
    console.error("order-book error:", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server läuft auf ${PORT}`));
