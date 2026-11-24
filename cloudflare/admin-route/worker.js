// KMT Admin route | security audit | 2026-11-18
// Only Google/Firebase signed ID tokens are accepted; no client-provided identity is trusted.
const ADMIN_SOURCE = "https://raw.githubusercontent.com/kravmagaturk/international-register/9cc5f07b99eee23b656986dc4a263d398d3b4f2f/kmt-secure-8f3c2d-admin.html";
const PROJECT_ID = "kravmaga-diploma";
const ADMIN_EMAIL = "bulicet@gmail.com";
const AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

function secure(res) {
  const h = new Headers(res.headers);
  h.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  h.set("Cache-Control", "no-store, max-age=0");
  h.set("Content-Security-Policy", "frame-ancestors 'none'");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  return new Response(res.body, {status:res.status, statusText:res.statusText, headers:h});
}
function json(data, status=200) {
  return secure(new Response(JSON.stringify(data), {
    status,headers:{"Content-Type":"application/json; charset=utf-8"}
  }));
}
function decodeBase64Url(input) {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("TOKEN_FORMAT");
  const encoded=input.replace(/-/g,"+").replace(/_/g,"/");
  const chars=atob(encoded+"=".repeat((4-encoded.length%4)%4));
  return Uint8Array.from(chars,ch=>ch.charCodeAt(0));
}
function jwtJson(input) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(input)));
}
async function verifyFirebaseToken(request) {
  const auth=request.headers.get("Authorization")||"";
  const match=/^Bearer\s+([A-Za-z0-9_.-]+)$/i.exec(auth);
  if (!match) throw new Error("MISSING_TOKEN");
  const parts=match[1].split(".");
  if (parts.length!==3 || parts.some(x=>!x)) throw new Error("TOKEN_FORMAT");
  const header=jwtJson(parts[0]),claims=jwtJson(parts[1]);
  const now=Math.floor(Date.now()/1000);
  if (header.alg!=="RS256" || !header.kid || (header.typ&&header.typ!=="JWT")) throw new Error("TOKEN_HEADER");
  if (claims.aud!==PROJECT_ID ||
      claims.iss!=="https://securetoken.google.com/"+PROJECT_ID ||
      typeof claims.sub!=="string" || !claims.sub || claims.sub.length>128 ||
      !Number.isFinite(claims.exp) || claims.exp<=now ||
      !Number.isFinite(claims.iat) || claims.iat>now ||
      !Number.isFinite(claims.auth_time) || claims.auth_time>now) throw new Error("TOKEN_CLAIMS");
  const certs=await fetch(JWK_URL,{cf:{cacheEverything:true,cacheTtl:3600}});
  if (!certs.ok) throw new Error("KEYS_UNAVAILABLE");
  const body=await certs.json();
  const jwk=Array.isArray(body.keys)?body.keys.find(k=>k.kid===header.kid&&k.kty==="RSA"):null;
  if (!jwk) throw new Error("UNKNOWN_SIGNER");
  const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,decodeBase64Url(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  if (!valid) throw new Error("INVALID_SIGNATURE");
  return claims;
}
function authorized(claims) {
  return String(claims.email||"").toLowerCase()===ADMIN_EMAIL && claims.email_verified===true;
}
async function listAudit(kv) {
  const items=[];
  let cursor,tries=0;
  do {
    const page=await kv.list({prefix:"audit:",limit:500,...(cursor?{cursor}:{})});
    for (const k of page.keys) {
      // Most recent entries are retrieved from names; no records are published without verified admin JWT.
      items.push(k.name);
    }
    cursor=page.list_complete?null:page.cursor;
    tries++;
  } while(cursor&&tries<10);
  items.sort().reverse();
  const latest=items.slice(0,500);
  const values=await Promise.all(latest.map(k=>kv.get(k,"json")));
  return {entries:values.filter(Boolean),total:items.length,partial:!!cursor};
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if (path==="/kmt-admin/audit") {
      if (!env.ADMIN_SECURITY_AUDIT) return json({error:"AUDIT_STORE_UNAVAILABLE"},503);
      if (request.method!=="POST"&&request.method!=="GET") return json({error:"METHOD_NOT_ALLOWED"},405);
      let claims;
      try {claims=await verifyFirebaseToken(request);} catch(e){
        // Invalid/anonymous traffic must not be stored as a "failed user login".
        return json({error:"AUTH_FAILED"},401);
      }
      if (request.method==="GET") {
        if(!authorized(claims)) return json({error:"FORBIDDEN"},403);
        try{return json(await listAudit(env.ADMIN_SECURITY_AUDIT));}
        catch(e){return json({error:"AUDIT_READ_FAILED"},502);}
      }
      // POST records verified Firebase identity only, with result determined on the server.
      if (Number(request.headers.get("content-length")||0)>256) return json({error:"TOO_LARGE"},413);
      const allowed=authorized(claims);
      const row={
        type:allowed?"login_success":"login_denied",
        uid:String(claims.user_id||claims.sub||"").slice(0,128),
        email:String(claims.email||"").slice(0,254),
        timestamp:new Date().toISOString(),
        ip:String(request.headers.get("CF-Connecting-IP")||"unknown").slice(0,64),
        country:String(request.cf?.country||"").slice(0,3),
        source:"verified_firebase_login"
      };
      try {
        const key="audit:"+row.timestamp+":"+crypto.randomUUID();
        await env.ADMIN_SECURITY_AUDIT.put(key,JSON.stringify(row),{expirationTtl:AUDIT_RETENTION_SECONDS});
        return json({ok:true,status:allowed?"authorized":"denied"},201);
      }catch(e){return json({error:"AUDIT_WRITE_FAILED"},502);}
    }
    if(path!=="/kmt-admin"&&path!=="/kmt-admin/")return secure(new Response("Not found",{status:404}));
    if(request.method!=="GET"&&request.method!=="HEAD")return secure(new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}}));
    try{
      const source=await fetch(ADMIN_SOURCE,{headers:{"Cache-Control":"no-store"}});
      if(!source.ok)return secure(new Response("Admin source unavailable",{status:502}));
      let html=await source.text();
      html=html.replace("<link rel=\"icon\" type=\"image/png\" href=\"https://kravmaga.com.tr/assets/brand/logo-1948.png\">","<link rel=\"icon\" type=\"image/png\" sizes=\"96x96\" href=\"https://kravmaga.com.tr/assets/brand/kmt-symbol-mono-20261125.png\">");
      html=html.replace("<head>","<head>\n<base href=\"https://kravmagaturk.github.io/international-register/\">");
      return secure(new Response(request.method==="HEAD"?null:html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8"}}));
    }catch(e){return secure(new Response("Admin source unavailable",{status:502}));}
  }
};
