const ALLOWED_ORIGINS = new Set([
  "https://kravmaga.com.tr",
  "https://www.kravmaga.com.tr",
  "https://kravmagaturk.github.io"
]);

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.hostname === "kravmagaturk.github.io";
  } catch {
    return false;
  }
}

const AI_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://kravmagaturk.github.io",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
        service: "Krav Maga Turk Portrait AI",
        status: "ready",
        model: AI_MODEL
      }, 200, origin);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405, origin);
    }

    if (!isAllowedOrigin(origin)) {
      return json({ ok: false, error: "Origin not allowed." }, 403, origin);
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

      const prompt = [
        "Use the person in input image 0 as the identity reference.",
        "Create a new professional oil-painted Krav Maga academy portrait of this same person.",
        "Preserve facial identity, age, hairstyle, glasses and recognizable facial features.",
        "Chest-up composition, black martial arts t-shirt, dramatic black and deep red brush-stroke background.",
        "Realistic oil paint texture, strong studio portrait lighting.",
        "Do not copy the original background.",
        "No extra people, no watermark, no random text."
      ].join(" ");

      const form = new FormData();
      form.append("prompt", prompt);
      form.append("input_image_0", new Blob([bytes], { type: mime }), "reference." + (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"));
      form.append("width", "512");
      form.append("height", "512");
      form.append("guidance", "4");

      const serialized = new Response(form);
      const result = await env.AI.run(AI_MODEL, {
        multipart: {
          body: serialized.body,
          contentType: serialized.headers.get("content-type")
        }
      });

      let generatedBase64 = "";
      if (result && typeof result.image === "string") generatedBase64 = result.image;
      else if (result && result.result && typeof result.result.image === "string") generatedBase64 = result.result.image;
      else if (result && result.data && typeof result.data.image === "string") generatedBase64 = result.data.image;

      generatedBase64 = generatedBase64.replace(/^data:image\/[^;]+;base64,/i, "").replace(/\s/g, "");

      if (!generatedBase64 || generatedBase64.length < 1000) {
        throw new Error("FLUX did not return a generated image.");
      }

      return json({
        ok: true,
        image: "data:image/png;base64," + generatedBase64,
        model: AI_MODEL
      }, 200, origin);

    } catch (err) {
      return json({
        ok: false,
        error: (err && err.message) || String(err)
      }, 500, origin);
    }
  }
};
