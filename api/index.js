import { Redis } from "@upstash/redis";

// ❌ Edge حذف شد تا Redis کار کنه
// export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// 50MB limit
const MAX_BYTES = 50 * 1024 * 1024;

const redis = Redis.fromEnv();

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(req, res) {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);

    const out = new Headers();
    let clientIp = null;

    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;

      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }

      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }

      out.set(k, v);
    }

    if (clientIp) out.set("x-forwarded-for", clientIp);
    else clientIp = "unknown";

    // گرفتن مصرف قبلی
    const used = (await redis.get(clientIp)) || 0;

    if (used >= MAX_BYTES) {
      return new Response("Data limit exceeded (50MB)", { status: 403 });
    }

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const response = await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    });

    // محاسبه مصرف
    const contentLength = Number(response.headers.get("content-length") || 0);
    const reqSize = Number(req.headers.get("content-length") || 0);
    const totalUsed = used + contentLength + reqSize;

    await redis.set(clientIp, totalUsed);

    return response;
  } catch (err) {
    console.error("relay error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
