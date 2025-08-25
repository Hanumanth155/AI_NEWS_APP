// /api/gnews.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    // Your secret API key (stored in environment variables)
    const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
    if (!GNEWS_API_KEY) return res.status(500).json({ error: "API key not set" });

    // Replace placeholder token in URL with secret key
    const secureUrl = url.includes("token=")
      ? url.replace(/token=[^&]+/, `token=${GNEWS_API_KEY}`)
      : url.includes("?")
        ? `${url}&token=${GNEWS_API_KEY}`
        : `${url}?token=${GNEWS_API_KEY}`;

    const response = await fetch(secureUrl);
    const data = await response.json();

    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
