// Cloudflare Pages Function — user count track karta hai
// URL: https://scheduleapp.sheduletimer.workers.dev/api/track-user
// Isके liye Cloudflare mein ek "KV Namespace" banake bind karna hoga (naam: USERS_KV)

export async function onRequestOptions(context) {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    if (!env.USERS_KV) {
      return new Response(JSON.stringify({ total: null, error: "KV not bound" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await request.json();
    const userId = body.userId;
    if (!userId) {
      return new Response(JSON.stringify({ total: null, error: "no userId" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check karo ye user ID pehले se dekha gaya hai ya naya hai
    const existing = await env.USERS_KV.get("user:" + userId);
    if (!existing) {
      await env.USERS_KV.put("user:" + userId, String(Date.now()));
      const countStr = await env.USERS_KV.get("total_count");
      const newCount = (parseInt(countStr) || 0) + 1;
      await env.USERS_KV.put("total_count", String(newCount));
    }

    const finalCount = await env.USERS_KV.get("total_count");
    return new Response(JSON.stringify({ total: parseInt(finalCount) || 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ total: null, error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
