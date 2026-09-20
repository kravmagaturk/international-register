export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = origin === "https://kravmagaturk.github.io" || origin === "https://kravmaga.com.tr" || origin === "https://www.kravmaga.com.tr";
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : "https://kravmagaturk.github.io",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
    if (request.method !== "POST" || !allowed) return Response.json({error:"Not allowed"},{status:403,headers:cors});

    const bearer = request.headers.get("Authorization") || "";
    const idToken = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!idToken) return Response.json({error:"Login required"},{status:401,headers:cors});

    const verify = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyAS8VB0ikbZXuhVQNzgn_ZbQWGXExijmKA", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({idToken})
    });
    const verified = await verify.json();
    const email = verified && verified.users && verified.users[0] && verified.users[0].email;
    if (!verify.ok || String(email||"").toLowerCase() !== "bulicet@gmail.com") {
      return Response.json({error:"Unauthorized"},{status:403,headers:cors});
    }

    const body = await request.json();
    const image_b64 = String(body.image || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/,"");
    if (!image_b64) return Response.json({error:"Photo required"},{status:400,headers:cors});

    const prompt = "Create a consistent square illustrated portrait based on the supplied person. Preserve recognizable facial identity, age, hair and beard characteristics. Krav Maga professional instructor portrait, chest-up, black training clothing, defensive ready stance, dramatic black and deep red textured background, high contrast graphic-novel illustration, clean premium academy look. No text, no letters, no logos, no watermark.";
    const result = await env.AI.run("@cf/runwayml/stable-diffusion-v1-5-img2img", {
      prompt,
      negative_prompt:"text, letters, logo, watermark, extra fingers, duplicate hands, distorted face, different person",
      image_b64,
      width:768,
      height:768,
      num_steps:20,
      strength:0.55,
      guidance:7.5
    });
    const bytes = await new Response(result).arrayBuffer();
    let binary = "";
    const u8 = new Uint8Array(bytes);
    for (let i=0;i<u8.length;i+=0x8000) binary += String.fromCharCode(...u8.subarray(i,i+0x8000));
    const dataURI = "data:image/png;base64," + btoa(binary);
    return Response.json({ok:true, webPortrait:dataURI},{headers:{...cors,"Cache-Control":"no-store"}});
  }
};