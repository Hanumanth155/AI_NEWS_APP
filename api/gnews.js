export default async function handler(req, res) {
  const API_KEY = process.env.GNEWS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing GNEWS_API_KEY" });

  try {
    const { category = "general", query = "" } = req.query;

    let url = query
      ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&country=us&max=10&token=${API_KEY}`
      : `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=us&max=10&token=${API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
