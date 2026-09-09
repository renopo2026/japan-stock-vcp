export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ----------------------------------------
    // 株価API
    // /api/stock/7203
    // ----------------------------------------
    const match =
      url.pathname.match(
        /^\/api\/stock\/([0-9A-Z]{4})$/
      );

    if (match) {
      const code = match[1];

      const key =
        `stocks/${code}.json.gz`;

      const object =
        await env.STOCK_DATA.get(key);

      if (!object) {
        return new Response(
          JSON.stringify({
            error: "Stock data not found",
            code
          }),
          {
            status: 404,
            headers: {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          }
        );
      }

      const headers =
        new Headers();

      // R2に保存されている
      // Content-Type / Content-Encoding等を反映
      object.writeHttpMetadata(headers);

      headers.set(
        "ETag",
        object.httpEtag
      );

      headers.set(
        "Cache-Control",
        "no-cache"
      );

      return new Response(
        object.body,
        {
          headers
        }
      );
    }

    // ----------------------------------------
    // API以外はHTML等のStatic Assetsへ
    // ----------------------------------------

    return env.ASSETS.fetch(request);
  }
};
