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

const ADMIN_EMAIL = "bulicet@gmail.com";
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
  const clean = base64.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (request.method === "GET") {
      return json(
        {
          ok: true,
          service: "Krav Maga Turk Portrait AI",
          status: "ready",
          authentication: "Allowed origins",
          model: AI_MODEL
        },
        200,
        origin
      );
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed." }, 405, origin);
    }

    if (!isAllowedOrigin(origin)) {
      return json({ ok: false, error: "Origin not allowed." }, 403, origin);
    }

    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid JSON." }, 400, origin);
      }

      const imageData = String((body && body.image) || "");
      const match = imageData.match(
        /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i
      );

      if (!match) {
        return json(
          { ok: false, error: "A valid PNG, JPEG or WebP photo is required." },
          400,
          origin
        );
      }

      const imageBytes = base64ToBytes(match[2]);

      if (!imageBytes.length) {
        return json({ ok: false, error: "Photo is empty." }, 400, origin);
      }

      if (imageBytes.length > 8 * 1024 * 1024) {
        return json(
          { ok: false, error: "Photo is too large. Maximum size is 8 MB." },
          413,
          origin
        );
      }

      const prompt = [
        "Use input image 0 as the identity reference.",
        "Create a square illustrated portrait of exactly the same person.",
        "Preserve recognizable facial identity, age, hair, beard, skin tone and facial proportions.",
        "Professional Krav Maga instructor portrait, chest-up composition, black training clothing, confident neutral defensive stance.",
        "Premium realistic graphic-novel illustration, dramatic black and deep red textured background, crisp studio lighting.",
        "Do not add text, letters, logos, badges or watermarks."
      ].join(" ");

      const inputBlob = new Blob([imageBytes], { type: "image/" + (match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase()) });
      const form = new FormData();
      form.append("input_image_0", inputBlob, "reference." + match[1].toLowerCase());
      form.append("prompt", prompt);
      form.append("width", "768");
      form.append("height", "768");
      form.append("guidance", "4");

      const formResponse = new Response(form);
      const formStream = formResponse.body;
      const formContentType = formResponse.headers.get("content-type");

      const result = await env.AI.run(AI_MODEL, {
        multipart: {
          body: formStream,
          contentType: formContentType
        }
      });

      let outputBytes;
      let contentType = "image/png";

      if (result && typeof result === "object" && typeof result.image === "string") {
        outputBytes = base64ToBytes(result.image);
      } else if (result instanceof Response) {
        const ct = result.headers.get("Content-Type") || "";
        if (ct.includes("application/json")) {
          const data = await result.json();
          if (!data || !data.image) throw new Error("Workers AI returned no image.");
          outputBytes = base64ToBytes(data.image);
        } else {
          contentType = ct || contentType;
          outputBytes = new Uint8Array(await result.arrayBuffer());
        }
      } else if (result instanceof ReadableStream) {
        outputBytes = new Uint8Array(await new Response(result).arrayBuffer());
      } else if (result instanceof ArrayBuffer) {
        outputBytes = new Uint8Array(result);
      } else if (ArrayBuffer.isView(result)) {
        outputBytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
      } else {
        throw new Error("Workers AI returned an unsupported image response.");
      }

      if (!outputBytes || !outputBytes.length) {
        throw new Error("Workers AI returned an empty image.");
      }

      const webPortrait =
        "data:" + contentType.split(";")[0] + ";base64," + bytesToBase64(outputBytes);

      return json({ ok: true, webPortrait }, 200, origin);
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            error && error.message
              ? error.message
              : "Çizim oluşturulamadı."
        },
        500,
        origin
      );
    }
  }
};
