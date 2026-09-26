const ALLOWED_ORIGINS = new Set([
  "https://kravmaga.com.tr",
  "https://www.kravmaga.com.tr",
  "https://kravmagaturk.github.io"
]);

const OPENAI_MODEL = "gpt-image-2.5-sunburst";

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.hostname === "kravmagaturk.github.io";
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://kravmagaturk.github.io",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function base64ToBytes(base64) {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function defaultPrompt(registerNo, studentName) {
  return [
    "Edit the supplied student photo into the official Krav Maga Turk academy portrait.",
    "Keep exactly the same person and preserve facial identity, age, hairstyle, glasses, eye shape and recognizable facial features.",
    "Chest-up professional portrait, black martial arts t-shirt, small 1948 Krav Maga Turk logo on the left chest.",
    "Black and deep red brush-stroke background, realistic oil-paint texture, strong studio portrait lighting.",
    "Do not copy the original background. Do not add another person, watermark, random text or extra logos.",
    "Keep the face natural and recognizable; do not beautify into a different identity.",
    registerNo ? "Registry reference: " + registerNo + "." : "",
    studentName ? "Student: " + studentName + "." : ""
  ].filter(Boolean).join(" ");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET") {
      return json({
        ok: true,
        service: "Krav Maga Turk OpenAI Portrait",
        status: env.OPENAI_API_KEY ? "ready" : "needs_openai_api_key",
        model: OPENAI_MODEL
      }, 200, origin);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405, origin);
    }

    if (!isAllowedOrigin(origin)) {
      return json({ ok: false, error: "Origin not allowed." }, 403, origin);
    }

    if (!env.OPENAI_API_KEY) {
      return json({ ok: false, error: "OpenAI API key is not configured." }, 503, origin);
    }

    try {
      const body = await request.json();
      const imageData = String((body && body.image) || "");
      const match = imageData.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i);

      if (!match) {
        return json({ ok: false, error: "A valid PNG, JPEG or WebP photo is required." }, 400, origin);
      }

      const mime = match[1].toLowerCase() === "png"
        ? "image/png"
        : match[1].toLowerCase() === "webp"
          ? "image/webp"
          : "image/jpeg";

      const bytes = base64ToBytes(match[2]);
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
        return json({ ok: false, error: "Photo size is invalid." }, 413, origin);
      }

      const reg = String((body && body.registerNo) || "").slice(0, 40);
      const name = String((body && body.studentName) || "").slice(0, 120);
      const prompt = String((body && body.prompt) || defaultPrompt(reg, name)).slice(0, 8000);

      const form = new FormData();
      form.append("model", OPENAI_MODEL);
      form.append("prompt", prompt);
      form.append("image", new Blob([bytes], { type: mime }), "reference." + (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"));
      form.append("size", "1024x1536");
      form.append("quality", "medium");
      form.append("output_format", "jpeg");
      form.append("output_compression", "88");
      form.append("n", "1");

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY },
        body: form
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : "OpenAI image edit failed.";
        return json({ ok: false, error: message }, response.status, origin);
      }

      const generated = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!generated || generated.length < 1000) {
        return json({ ok: false, error: "OpenAI did not return image data." }, 502, origin);
      }

      return json({
        ok: true,
        image: "data:image/jpeg;base64," + generated,
        model: OPENAI_MODEL
      }, 200, origin);
    } catch (err) {
      return json({
        ok: false,
        error: (err && err.message) || String(err)
      }, 500, origin);
    }
  }
};