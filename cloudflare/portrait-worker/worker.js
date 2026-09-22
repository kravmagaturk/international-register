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
const AI_MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";

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
      if (!isAllowedOrigin(origin)) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:corsHeaders(origin)});
    }
    if (request.method === "GET") return json({ok:true,service:"Krav Maga Turk Portrait AI",status:"ready",model:AI_MODEL},200,origin);
    if (request.method !== "POST") return json({ok:false,error:"Method not allowed."},405,origin);
    if (!isAllowedOrigin(origin)) return json({ok:false,error:"Origin not allowed."},403,origin);
    try {
      const body=await request.json();
      const imageData=String((body&&body.image)||"");
      const match=imageData.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
      if(!match) return json({ok:false,error:"A valid PNG, JPEG or WebP photo is required."},400,origin);
      const base64=match[2].replace(/\s/g,"");
      const bytes=base64ToBytes(base64);
      if(!bytes.length || bytes.length>8*1024*1024) return json({ok:false,error:"Photo size is invalid."},413,origin);
      const prompt=[
        "oil painted graphic portrait of the same person in the reference image",
        "preserve facial identity, age, hairstyle, glasses and expression",
        "chest-up martial arts portrait, black t-shirt with KRAV MAGA TURK written side by side",
        "dramatic black and deep red brush-stroke background",
        "professional Krav Maga academy poster style, realistic oil paint texture",
        "no extra people, no watermark, no random text"
      ].join(", ");
      const result=await env.AI.run(AI_MODEL,{
        prompt,
        negative_prompt:"different person, changed face, extra people, deformed hands, unreadable text, watermark",
        image_b64:base64,
        width:512,height:512,num_steps:12,strength:0.42,guidance:7
      });
      const out=await new Response(result).arrayBuffer();
      const out64=bytesToBase64(new Uint8Array(out));
      return json({ok:true,image:"data:image/png;base64,"+out64},200,origin);
    } catch(err) {
      return json({ok:false,error:(err&&err.message)||String(err)},500,origin);
    }
  }
};
