export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ============================================================
    // CONFIG
    // ============================================================

    const defaultOrigins = [
      "https://scheduleapp.sheduletimer.workers.dev",
      "https://aura-ai.sheduletimer.workers.dev"
    ];

    const configuredOrigins = String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

    const allowedOrigins =
      configuredOrigins.length ? configuredOrigins : defaultOrigins;

    const origin = request.headers.get("Origin") || "";
    const originAllowed = allowedOrigins.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin":
        originAllowed ? origin : (allowedOrigins[0] || "null"),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, X-App-Secret",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });

    // ============================================================
    // CORS PREFLIGHT
    // ============================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    // ============================================================
    // HEALTH
    // ============================================================

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "NOVA AI Secure Worker",
        time: new Date().toISOString()
      });
    }

    // ============================================================
    // WEB APP ORIGIN ASSOCIATION
    // ============================================================

    if (
      url.pathname ===
        "/.well-known/web-app-origin-association" &&
      request.method === "GET"
    ) {
      return new Response(
        JSON.stringify({
          "https://scheduleapp.sheduletimer.workers.dev": {
            scope: "/"
          }
        }),
        {
          headers: {
            ...cors,
            "Content-Type":
              "application/json; charset=utf-8"
          }
        }
      );
    }

    // ============================================================
    // API ROUTES
    // ============================================================

    const apiRoute =
      url.pathname === "/api/chat" ||
      url.pathname === "/api/gemini-chat" ||
      url.pathname === "/api/openai-chat";

    if (apiRoute) {
      if (request.method !== "POST") {
        return json(
          {
            reply: null,
            error: "Method not allowed"
          },
          405
        );
      }

      // Browser requests from unknown origins are rejected.
      if (origin && !originAllowed) {
        return json(
          {
            reply: null,
            error: "Origin not allowed"
          },
          403
        );
      }

      /*
        IMPORTANT SECURITY:

        Never put APP_SECRET, GEMINI_API_KEY or
        OPENAI_API_KEY inside index.html.

        Real provider keys are read only from
        Cloudflare Worker Secrets.

        APP_SECRET is optional here. If supplied by a
        caller, it must match the Cloudflare Secret.
      */

      const suppliedSecret =
        request.headers.get("X-App-Secret");

      if (
        env.APP_SECRET &&
        suppliedSecret &&
        suppliedSecret !== env.APP_SECRET
      ) {
        return json(
          {
            reply: null,
            error: "Invalid app secret"
          },
          403
        );
      }
    }

    // ============================================================
    // MAIN CHAT
    // ============================================================

    if (url.pathname === "/api/chat") {
      return handleChat(request, env, json);
    }

    // ============================================================
    // GEMINI ONLY
    // ============================================================

    if (url.pathname === "/api/gemini-chat") {
      return handleGeminiOnly(request, env, json);
    }

    // ============================================================
    // OPENAI ONLY
    // ============================================================

    if (url.pathname === "/api/openai-chat") {
      return handleOpenAIOnly(request, env, json);
    }

    // ============================================================
    // DEFAULT
    // ============================================================

    return new Response(
      "NOVA AI Secure Worker is running.",
      {
        status: 200,
        headers: {
          ...cors,
          "Content-Type":
            "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
};


// ================================================================
// MAIN CHAT
// Gemini first → OpenAI fallback
// ================================================================

async function handleChat(request, env, json) {
  try {
    const contentLength = Number(
      request.headers.get("Content-Length") || 0
    );

    if (contentLength > 1500000) {
      return json(
        {
          reply: null,
          error:
            "Request too large. Please send a smaller message or image."
        },
        413
      );
    }

    const body = await request.json();

    const raw = JSON.stringify(body);

    if (raw.length > 1500000) {
      return json(
        {
          reply: null,
          error:
            "Request too large. Please send a smaller message or image."
        },
        413
      );
    }

    // ============================================================
    // ADVANCED GEMINI CONTENTS
    // ============================================================

    if (
      Array.isArray(body.contents) &&
      body.contents.length
    ) {
      const payload = {
        contents: body.contents
      };

      if (body.systemInstruction) {
        payload.systemInstruction =
          body.systemInstruction;
      }

      if (body.generationConfig) {
        payload.generationConfig =
          body.generationConfig;
      }

      if (body.safetySettings) {
        payload.safetySettings =
          body.safetySettings;
      }

      const gemini = await callGemini(
        env,
        payload
      );

      if (gemini.ok) {
        return json(gemini.data);
      }

      // OpenAI fallback for text from advanced contents.
      const text =
        extractTextFromContents(body.contents);

      if (
        env.OPENAI_API_KEY &&
        text.trim()
      ) {
        const openai =
          await callOpenAI(env, {
            messages: [
              {
                role: "system",
                content:
                  extractSystemText(
                    body.systemInstruction
                  ) ||
                  defaultSystemPrompt()
              },
              {
                role: "user",
                content: text
              }
            ]
          });

        if (openai.ok) {
          return json({
            reply: openai.reply,
            provider: "openai",
            fallback: true
          });
        }
      }

      return json({
        reply: null,
        debug: safeProviderError(
          gemini.data
        )
      });
    }

    // ============================================================
    // NORMAL MESSAGE + IMAGE
    // ============================================================

    const message =
      String(body.message || "")
        .slice(0, 6000);

    const image =
      typeof body.image === "string"
        ? body.image
        : null;

    const parts = [];

    if (message) {
      parts.push({
        text: message
      });
    }

    if (image) {
      const imagePart =
        dataUrlToGeminiPart(image);

      if (imagePart) {
        parts.push(imagePart);
      }
    }

    if (!parts.length) {
      return json(
        {
          reply: null,
          error: "Message is empty."
        },
        400
      );
    }

    const systemPrompt =
      String(
        body.systemPrompt ||
          defaultSystemPrompt()
      ).slice(0, 12000);

    const geminiPayload = {
      contents: [
        {
          role: "user",
          parts
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: systemPrompt
          }
        ]
      }
    };

    // ============================================================
    // GEMINI
    // ============================================================

    const gemini =
      await callGemini(
        env,
        geminiPayload
      );

    if (gemini.ok) {
      const reply =
        extractGeminiText(
          gemini.data
        );

      if (reply) {
        return json({
          reply,
          provider: "gemini"
        });
      }
    }

    // ============================================================
    // OPENAI FALLBACK
    // ============================================================

    if (
      env.OPENAI_API_KEY &&
      message
    ) {
      const openai =
        await callOpenAI(env, {
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: message
            }
          ]
        });

      if (openai.ok) {
        return json({
          reply: openai.reply,
          provider: "openai",
          fallback: true
        });
      }
    }

    return json({
      reply: null,
      debug: safeProviderError(
        gemini.data
      )
    });

  } catch (error) {
    return json(
      {
        reply: null,
        error: "Server error",
        debug: String(
          error?.message || error
        ).slice(0, 300)
      },
      500
    );
  }
}


// ================================================================
// GEMINI ONLY
// ================================================================

async function handleGeminiOnly(
  request,
  env,
  json
) {
  try {
    if (!env.GEMINI_API_KEY) {
      return json(
        {
          reply: null,
          error:
            "GEMINI_API_KEY Secret is missing."
        },
        500
      );
    }

    const body =
      await request.json();

    if (
      !Array.isArray(body.contents) ||
      !body.contents.length
    ) {
      return json(
        {
          reply: null,
          error:
            "contents is required."
        },
        400
      );
    }

    const payload = {
      contents: body.contents
    };

    if (body.systemInstruction) {
      payload.systemInstruction =
        body.systemInstruction;
    }

    if (body.generationConfig) {
      payload.generationConfig =
        body.generationConfig;
    }

    if (body.safetySettings) {
      payload.safetySettings =
        body.safetySettings;
    }

    const result =
      await callGemini(
        env,
        payload
      );

    return json(
      result.data,
      result.ok
        ? 200
        : result.status || 502
    );

  } catch (error) {
    return json(
      {
        reply: null,
        error: "Gemini route error",
        debug: String(
          error?.message || error
        ).slice(0, 300)
      },
      500
    );
  }
}


// ================================================================
// OPENAI ONLY
// ================================================================

async function handleOpenAIOnly(
  request,
  env,
  json
) {
  try {
    if (!env.OPENAI_API_KEY) {
      return json(
        {
          reply: null,
          error:
            "OPENAI_API_KEY Secret is missing."
        },
        500
      );
    }

    const body =
      await request.json();

    const messages =
      Array.isArray(body.messages)
        ? body.messages
        : [
            {
              role: "user",
              content:
                String(
                  body.message || ""
                )
            }
          ];

    if (!messages.length) {
      return json(
        {
          reply: null,
          error:
            "messages is required."
        },
        400
      );
    }

    const result =
      await callOpenAI(env, {
        messages,
        model: body.model
      });

    if (!result.ok) {
      return json(
        {
          reply: null,
          debug:
            safeProviderError(
              result.data
            )
        },
        result.status || 502
      );
    }

    return json({
      reply: result.reply,
      provider: "openai"
    });

  } catch (error) {
    return json(
      {
        reply: null,
        error:
          "OpenAI route error",
        debug: String(
          error?.message || error
        ).slice(0, 300)
      },
      500
    );
  }
}


// ================================================================
// GEMINI API
// ================================================================

async function callGemini(
  env,
  payload
) {
  if (!env.GEMINI_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: {
        error:
          "GEMINI_API_KEY Secret is missing."
      }
    };
  }

  const model =
    env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";

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

        body:
          JSON.stringify(payload)
      });

    const data =
      await response.json();

    return {
      ok: response.ok,
      status: response.status,
      data
    };

  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: {
        error: String(
          error?.message || error
        )
      }
    };
  }
}


// ================================================================
// OPENAI API
// ================================================================

async function callOpenAI(
  env,
  payload
) {
  if (!env.OPENAI_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: {
        error:
          "OPENAI_API_KEY Secret is missing."
      }
    };
  }

  const model =
    payload.model ||
    env.OPENAI_MODEL ||
    "gpt-5.6-mini";

  const requestBody = {
    model,
    messages:
      payload.messages
  };

  if (
    payload.temperature !==
    undefined
  ) {
    requestBody.temperature =
      payload.temperature;
  }

  if (
    payload.max_tokens !==
    undefined
  ) {
    requestBody.max_tokens =
      payload.max_tokens;
  }

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
              "Bearer " +
              env.OPENAI_API_KEY
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );

    const data =
      await response.json();

    return {
      ok: response.ok,
      status: response.status,
      data,

      reply:
        data?.choices?.[0]
          ?.message?.content ||
        null
    };

  } catch (error) {
    return {
      ok: false,
      status: 502,
      data: {
        error: String(
          error?.message || error
        )
      },
      reply: null
    };
  }
}


// ================================================================
// GEMINI TEXT EXTRACTION
// ================================================================

function extractGeminiText(data) {
  const parts =
    data?.candidates?.[0]
      ?.content?.parts;

  if (!Array.isArray(parts)) {
    return null;
  }

  const text =
    parts
      .map(part =>
        typeof part?.text ===
        "string"
          ? part.text
          : ""
      )
      .filter(Boolean)
      .join("\n")
      .trim();

  return text || null;
}


// ================================================================
// ADVANCED CONTENT TEXT
// ================================================================

function extractTextFromContents(
  contents
) {
  if (!Array.isArray(contents)) {
    return "";
  }

  return contents
    .map(item => {
      const parts =
        Array.isArray(item?.parts)
          ? item.parts
          : [];

      return parts
        .map(part =>
          typeof part?.text ===
          "string"
            ? part.text
            : ""
        )
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);
}


// ================================================================
// SYSTEM INSTRUCTION TEXT
// ================================================================

function extractSystemText(
  systemInstruction
) {
  if (!systemInstruction) {
    return "";
  }

  if (
    typeof systemInstruction ===
    "string"
  ) {
    return systemInstruction.slice(
      0,
      12000
    );
  }

  const parts =
    Array.isArray(
      systemInstruction.parts
    )
      ? systemInstruction.parts
      : [];

  return parts
    .map(part =>
      typeof part?.text ===
      "string"
        ? part.text
        : ""
    )
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);
}


// ================================================================
// IMAGE DATA URL
// ================================================================

function dataUrlToGeminiPart(
  dataUrl
) {
  const match =
    dataUrl.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
    );

  if (!match) {
    return null;
  }

  const mimeType =
    match[1];

  const data =
    match[2];

  // Protect Worker from very large images.
  if (data.length > 1300000) {
    return null;
  }

  return {
    inline_data: {
      mime_type:
        mimeType,

      data
    }
  };
}


// ================================================================
// ERROR SANITIZATION
// ================================================================

function safeProviderError(
  data
) {
  const message =
    data?.error?.message ||
    data?.error ||
    data?.message ||
    "AI provider did not return a response.";

  return String(message)
    .slice(0, 500);
}


// ================================================================
// DEFAULT NOVA PROMPT
// ================================================================

function defaultSystemPrompt() {
  return `
You are NOVA, a helpful AI assistant for Schedule Lab.

Be friendly, practical and concise.
You can answer in English, Hindi or Hinglish depending on
the user's language.

Help with:
- schedules
- tasks
- study planning
- productivity
- general questions
- planning and organization

Do not claim to have performed actions that you did not perform.
`;
}
