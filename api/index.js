import { Redis } from "@upstash/redis";

export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// 50MB limit (برای تست)
const MAX_BYTES = 50 * 1024 * 1024;

const redis = Redis.fromEnv();

export default async function handler(req) {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    let clientIp =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for") ||
      "unknown";

    const used = (await redis.get(clientIp)) || 0;

    if (used >= MAX_BYTES) {
      return new Response("Data limit exceeded (50MB)", { status: 403 });
    }

    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);

    const res = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      duplex: "half",
    });

    const contentLength = Number(res.headers.get("content-length") || 0);
    const reqSize = Number(req.headers.get("content-length") || 0);
    const totalUsed = used + contentLength + reqSize;

    await redis.set(clientIp, totalUsed);

    return res;
  } catch (err) {
    console.error(err);
    return new Response("Bad Gateway", { status: 502 });
  }
}
