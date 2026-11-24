import { getClientIP } from "./cloudflare.mjs";

const LASTFM_USERNAME = "caelondev";
const BLOG_BACKEND_URL = "https://blog-backend.caelondev.workers.dev";
const CODEBERG_COMMITS_URL =
  "https://codeberg-commits.pages.dev/api/latest-commit";
const DEFAULT_CODEBERG_USERNAME = "caelondev";

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === "http://localhost:3000") return true; // local dev
  try {
    const u = new URL(origin);
    return (
      u.protocol === "https:" &&
      (u.hostname === "caelondev.net" || u.hostname.endsWith(".caelondev.net"))
    );
  } catch {
    return false;
  }
}

function withCors(request, response) {
  const out = new Response(response.body, response);
  const origin = request.headers.get("origin");

  out.headers.delete("access-control-allow-origin");
  out.headers.delete("access-control-allow-credentials");
  out.headers.delete("access-control-allow-methods");
  out.headers.delete("access-control-allow-headers");
  out.headers.delete("access-control-expose-headers");

  if (isAllowedOrigin(origin)) {
    out.headers.set("access-control-allow-origin", origin);
    out.headers.set("access-control-allow-credentials", "true");
  }
  out.headers.append("vary", "Origin");
  return out;
}

async function handleLastfm(env) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${LASTFM_USERNAME}&api_key=${env.LASTFM_API_KEY}&format=json&limit=1`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }),
      { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
}

async function handleCodebergCommits(request) {
  const reqUrl = new URL(request.url);
  const username = reqUrl.searchParams.get("user") || DEFAULT_CODEBERG_USERNAME;
  const url = `${CODEBERG_COMMITS_URL}?user=${encodeURIComponent(username)}`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }),
      { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
}

async function handleBlog(request, pathname) {
  const reqUrl = new URL(request.url);
  const targetUrl = `${BLOG_BACKEND_URL}${pathname}${reqUrl.search}`;

  try {
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.text();

    const headers = new Headers({
      "content-type": request.headers.get("content-type") || "application/json",
      "x-user-real-ip": getClientIP(request),
      "user-agent": request.headers.get("user-agent") || "",
      "x-trace-id": request.headers.get("x-trace-id") || "",
      "x-turnstile-token": request.headers.get("x-turnstile-token") || "",
    });
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });

    const out = new Response(upstream.body, upstream);
    if (pathname.startsWith("/blog/auth")) {
      out.headers.set("cache-control", "no-store");
    }
    return out;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Blog backend fetch failed: ${err.message}` }),
      { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
}

async function route(request, pathname, env) {
  if (pathname === "/lastfm") return handleLastfm(env);
  if (pathname === "/codeberg-commits") return handleCodebergCommits(request);
  if (pathname.startsWith("/blog")) return handleBlog(request, pathname);

  return new Response(JSON.stringify({ error: "Unknown API route" }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleApiRequest(request, pathname, env) {
  if (request.method === "OPTIONS") {
    const res = new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, x-turnstile-token, x-trace-id",
        "Access-Control-Max-Age": "86400",
      },
    });
    const out = withCors(request, res);
    out.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    out.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, x-turnstile-token, x-trace-id",
    );
    out.headers.set("Access-Control-Max-Age", "86400");
    return out;
  }

  return withCors(request, await route(request, pathname, env));
}

export { handleApiRequest };
