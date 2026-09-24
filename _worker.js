export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const target = "https://admin-blog.dingdao.me" + url.pathname + url.search;
      const h = new Headers(request.headers);
      h.delete("host");
      const init = { method: request.method, headers: h, redirect: "manual" };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        init.duplex = "half";
      }
      try {
        return await fetch(target, init);
      } catch (e) {
        return new Response("backend unavailable", { status: 502 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
