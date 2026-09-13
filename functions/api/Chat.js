// Cloudflare Pages Function — Schedule Lab repo ke andar hi backend chalta hai
// (Worker se convert kiya gaya, isliye ek hi repo mein sab kuch)
// URL: https://scheduleapp.sheduletimer.workers.dev/api/chat

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
  };

  // Secret password check — ye extra suraksha layer hai
  const appSecret = request.headers.get("X-App-Secret");
  if (!env.APP_SECRET || appSecret !== env.APP_SECRET) {
    return new Response(JSON.stringify({ reply: null, debug: "Invalid app secret" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await request.json();

    // PASS-THROUGH MODE — Schedule Lab ki AI Assistant jaisa advanced use-case
    if (body.contents) {
      const geminiRes = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            contents: body.contents,
            systemInstruction: body.systemInstruction || undefined
          })
        }
      );
      const passData = await geminiRes.json();
      return new Response(JSON.stringify(passData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const userMessage = body.message || "";
    const imageDataUrl = body.image || null;

    const parts = [{ text: userMessage }];
    if (imageDataUrl) {
      const match = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      }
    }

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          systemInstruction: {
            parts: [{ text: "Tum Aura ho, ek friendly AI assistant jo Hinglish mein natural, chhote jawab deta hai." }]
          }
        })
      }
    );
    const data = await geminiRes.json();
    let reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    let debugInfo = reply ? "" : JSON.stringify(data).slice(0, 300);

    // LAYER 2: Gemini fail ho -> ChatGPT/OpenAI try karo
    if (!reply && env.OPENAI_API_KEY) {
      try {
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.OPENAI_API_KEY
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Tum Aura ho, ek friendly AI assistant jo Hinglish mein natural, chhote jawab deta hai." },
              { role: "user", content: userMessage }
            ]
          })
        });
        const openaiData = await openaiRes.json();
        reply = openaiData?.choices?.[0]?.message?.content || null;
        if (reply) debugInfo = "";
      } catch (e) { /* OpenAI bhi fail, reply null hi rahega */ }
    }

    return new Response(JSON.stringify({ reply, debug: debugInfo }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ reply: null, debug: "Exception: " + err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
