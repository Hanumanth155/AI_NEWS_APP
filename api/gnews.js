// /api/gnews.js
export default async function handler(req, res) {
  try {
    const { query, lang = "en" } = req.query;

    const apiKey = process.env.GNEWS_API_KEY; // 🔒 store in env vars
    if (!apiKey) {
      return res.status(500).json({ error: "GNEWS_API_KEY not set" });
    }

    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(
      query || "latest"
    )}&lang=${lang}&max=10&apikey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to fetch news", details: error.message });
  }
}
