// /api/gemini.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: "API key not set" });

    const apiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GEMINI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gemini-1.5-flash-latest",
        input: prompt
      })
    });

    const data = await apiRes.json();

    // Adjust depending on API response structure
    const text = data.output?.[0]?.content?.[0]?.text || "";
    res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to call Gemini API" });
  }
}
