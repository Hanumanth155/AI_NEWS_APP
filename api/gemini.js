// /api/gemini.js
export default async function handler(req, res) {
  try {
    const body = await req.json();
    const { prompt } = body;

    const apiKey = process.env.GEMINI_API_KEY; // 🔒 store in env vars
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY not set" });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Failed to fetch AI response", details: error.message });
  }
}
