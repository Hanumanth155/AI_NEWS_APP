export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing url param" });
  }

  try {
    const response = await fetch(`${url}&apikey=${process.env.GNEWS_API_KEY}`);
    const data = await response.json();

    res.status(200).json(data);
  } catch (error) {
    console.error("GNews Error:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
}
