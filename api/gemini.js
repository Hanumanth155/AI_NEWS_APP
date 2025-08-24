export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      }
    );

    if (!geminiRes.ok) {
      throw new Error("Gemini API Error: " + geminiRes.status);
    }

    const data = await geminiRes.json();
    res.status(200).json(data);
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to call Gemini API" });
  }
}
