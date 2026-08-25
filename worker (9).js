export default {
  async fetch(request, env, ctx) {
    // Allow this site to be embedded inside another website (Schedule Lab)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Chat API endpoint - Aura calls this to get AI replies
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const userMessage = body.message || "";

        const geminiRes = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY, // set this in Cloudflare Variables & Secrets
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: userMessage }] }],
              systemInstruction: {
                parts: [{ text: "Tum Aura ho, ek friendly AI assistant jo Hinglish mein natural, chhote jawab deta hai." }]
              }
            })
          }
        );
        const data = await geminiRes.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf karo, jawab nahi mil paya.";

        return new Response(JSON.stringify({ reply }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ reply: "Error: " + err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Any other request (e.g. if someone opens the worker URL directly)
    const resp = new Response("Aura AI backend is running.", {
      headers: corsHeaders
    });
    // Explicitly allow embedding in an iframe from any site
    resp.headers.set("Content-Security-Policy", "frame-ancestors *");
    return resp;
  }
};
