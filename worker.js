/**
 * Schedule Lab / NOVA — Secure Cloudflare Worker
 *
 * API keys MUST be stored as Cloudflare Worker Secrets:
 *   GEMINI_API_KEY
 *   OPENAI_API_KEY (optional fallback)
 *
 * Optional vars:
 *   ALLOWED_ORIGINS = comma-separated origins
 *   GEMINI_MODEL = gemini-3.6-flash
 *   OPENAI_MODEL = gpt-5.6-mini
 *   MAX_REQUEST_BYTES = 1500000
 */

const DEFAULT_ORIGINS = [
  "https://scheduleapp.sheduletimer.workers.dev",
  "https://aura-ai.sheduletimer.workers.dev"
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = getAllowedOrigins(env);
    const allowed = !origin || allowedOrigins.includes(origin);
    const cors = corsHeaders(origin, allowedOrigins, allowed);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json(
        {
          ok: true,
          service: "NOVA backend",
          time: new Date().toISOString()
        },
        200,
        cors
      );
    }

    if (
      url.pathname ===
        "/.well-known/web-app-origin-association" &&
      request.method === "GET"
    ) {
      return json(
        {
          "https://scheduleapp.sheduletimer.workers.dev": {
            scope: "/"
          }
        },
        200,
        {
          ...cors,
          "Access-Control-Allow-Origin": "*"
        }
      );
    }

    const apiPath = [
      "/api/chat",
      "/api/gemini-chat",
      "/api/openai-chat"
    ].includes(url.pathname);

    if (!apiPath) {
      return json(
        { error: "Not found" },
        404,
        cors
      );
    }

    if (!allowed) {
      return json(
        { error: "ORIGIN_NOT_ALLOWED" },
        403,
        cors
      );
    }

    if (request.method !== "POST") {
      return json(
        { error: "METHOD_NOT_ALLOWED" },
        405,
        cors
      );
    }

    // Browser Origin is useful CORS protection.
    // X-App-Secret is deliberately NOT trusted as an authentication
    // secret because anything in frontend JS can be copied.

    const maxBytes = Math.max(
      100000,
      Number(env.MAX_REQUEST_BYTES || 1500000)
    );

    const contentLength = Number(
      request.headers.get("Content-Length") || 0
    );

    if (contentLength > maxBytes) {
      return json(
        { error: "REQUEST_TOO_LARGE" },
        413,
        cors
      );
    }

    try {
      const raw = await request.text();

      if (raw.length > maxBytes) {
        return json(
          { error: "REQUEST_TOO_LARGE" },
          413,
          cors
        );
      }

      const body = JSON.parse(raw);

      const result = await handleChat(
        url.pathname,
        body,
        env,
        ctx
      );

      return json(
        result.body,
        result.status,
        cors
      );

    } catch (err) {
      console.error(
        "NOVA worker error",
        err?.message || err
      );

      return json(
        {
          reply: null,
          error: "SERVER_ERROR"
        },
        500,
        cors
      );
    }
  }
};

async function handleChat(path, body, env, ctx) {

  if (!body || typeof body !== "object") {
    return {
      status: 400,
      body: {
        reply: null,
        error: "INVALID_BODY"
      }
    };
  }

  const geminiOnly =
    path === "/api/gemini-chat";

  const openaiOnly =
    path === "/api/openai-chat";

  // Advanced Schedule Lab mode:
  // preserve the original Gemini contents/systemInstruction API shape.

  if (!openaiOnly && body.contents) {

    if (!env.GEMINI_API_KEY) {
      return {
        status: 503,
        body: {
          reply: null,
          error: "GEMINI_NOT_CONFIGURED"
        }
      };
    }

    const contents =
      Array.isArray(body.contents)
        ? body.contents.slice(-30)
        : null;

    if (!contents) {
      return {
        status: 400,
        body: {
          reply: null,
          error: "INVALID_CONTENTS"
        }
      };
    }

    const systemText =
      extractSystemText(
        body.systemInstruction
      ).slice(0, 16000);

    const response =
      await callGemini(
        contents,
        systemText,
        env
      );

    if (response.ok) {
      return {
        status: 200,
        body: response.data
      };
    }

    // /api/gemini-chat and advanced /api/chat
    // keep the original Gemini response contract.

    if (
      geminiOnly ||
      !env.OPENAI_API_KEY
    ) {
      return {
        status: 502,
        body: {
          reply: null,
          error: "AI_PROVIDER_UNAVAILABLE"
        }
      };
    }
  }

  const message =
    String(body.message || "").trim();

  if (!message && !body.contents) {
    return {
      status: 400,
      body: {
        reply: null,
        error: "MESSAGE_REQUIRED"
      }
    };
  }

  if (message.length > 6000) {
    return {
      status: 413,
      body: {
        reply: null,
        error: "MESSAGE_TOO_LONG"
      }
    };
  }

  const scheduleContext =
    String(
      body.scheduleContext || ""
    ).slice(0, 12000);

  const language =
    String(
      body.language || "hinglish"
    ).slice(0, 40);

  const system =
    String(
      body.systemPrompt ||
        "Tum NOVA ho, Schedule Lab ke andar friendly AI assistant. Hinglish mein natural, clear aur practical jawab do. Replies ko unnecessarily lamba mat karo."
    ).slice(0, 16000);

  if (
    !openaiOnly &&
    env.GEMINI_API_KEY
  ) {

    const prompt =
      buildPrompt(
        message,
        scheduleContext,
        language,
        system
      );

    const response =
      await callGemini(
        [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        "",
        env
      );

    if (response.ok) {

      const reply =
        extractGeminiReply(
          response.data
        );

      if (reply) {
        return {
          status: 200,
          body: {
            reply
          }
        };
      }
    }
  }

  if (
    !geminiOnly &&
    env.OPENAI_API_KEY
  ) {

    const prompt =
      buildPrompt(
        message,
        scheduleContext,
        language,
        system
      );

    const response =
      await callOpenAI(
        prompt,
        env
      );

    if (response.ok) {

      const reply =
        extractOpenAIReply(
          response.data
        );

      if (reply) {
        return {
          status: 200,
          body: {
            reply
          }
        };
      }
    }
  }

  return {
    status: 503,
    body: {
      reply: null,
      error: "AI_PROVIDER_UNAVAILABLE"
    }
  };
}

function buildPrompt(
  message,
  scheduleContext,
  language,
  system
) {

  return [
    system,
    `Preferred language: ${language}`,
    scheduleContext
      ? `Today's Schedule Lab context:\n${scheduleContext}`
      : "",
    `User message:\n${message}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callGemini(
  contents,
  systemText,
  env
) {

  const model =
    env.GEMINI_MODEL ||
    "gemini-3.6-flash";

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

  const payload = {
    contents
  };

  if (systemText) {
    payload.systemInstruction = {
      parts: [
        {
          text: systemText
        }
      ]
    };
  }

  try {

    const response =
      await fetch(endpoint, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            env.GEMINI_API_KEY
        },

        body: JSON.stringify(
          payload
        )
      });

    const text =
      await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch (_) {}

    return {
      ok: response.ok,
      status: response.status,
      data
    };

  } catch (error) {

    console.error(
      "Gemini request failed",
      error?.message || error
    );

    return {
      ok: false,
      status: 0,
      data: null
    };
  }
}

async function callOpenAI(
  prompt,
  env
) {

  const model =
    env.OPENAI_MODEL ||
    "gpt-5.6-mini";

  try {

    const response =
      await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${env.OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model,

            messages: [
              {
                role: "system",
                content:
                  "You are NOVA, a helpful assistant inside Schedule Lab."
              },

              {
                role: "user",
                content: prompt
              }
            ]
          })
        }
      );

    const text =
      await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch (_) {}

    return {
      ok: response.ok,
      status: response.status,
      data
    };

  } catch (error) {

    console.error(
      "OpenAI request failed",
      error?.message || error
    );

    return {
      ok: false,
      status: 0,
      data: null
    };
  }
}

function extractGeminiReply(data) {

  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(
        part => part?.text || ""
      )
      .join("")
      .trim() || null
  );
}

function extractOpenAIReply(data) {

  return (
    data?.choices?.[0]?.message?.content
      ?.trim() || null
  );
}

function extractSystemText(
  instruction
) {

  if (!instruction) return "";

  if (
    typeof instruction === "string"
  ) {
    return instruction;
  }

  return Array.isArray(
    instruction?.parts
  )
    ? instruction.parts
        .map(
          p => p?.text || ""
        )
        .join("\n")
    : "";
}

function getAllowedOrigins(env) {

  const configured =
    String(
      env.ALLOWED_ORIGINS || ""
    )
      .split(",")
      .map(
        x => x.trim()
      )
      .filter(Boolean);

  return configured.length
    ? configured
    : DEFAULT_ORIGINS;
}

function corsHeaders(
  origin,
  allowedOrigins,
  allowed
) {

  const headers = {

    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, X-App-Secret",

    "Access-Control-Max-Age":
      "86400",

    "Cache-Control":
      "no-store",

    "X-Content-Type-Options":
      "nosniff",

    "X-Frame-Options":
      "DENY",

    "Referrer-Policy":
      "no-referrer",

    "Permissions-Policy":
      "camera=(), microphone=(self), geolocation=()",

    "Vary":
      "Origin"
  };

  if (
    allowed &&
    origin &&
    allowedOrigins.includes(origin)
  ) {

    headers[
      "Access-Control-Allow-Origin"
    ] = origin;
  }

  return headers;
}

function json(
  data,
  status,
  extraHeaders = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        ...extraHeaders
      }
    }
  );
}
