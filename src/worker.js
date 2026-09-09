export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ========================================================
    // 株価API
    // /api/stock/7203
    // ========================================================

    const match =
      url.pathname.match(
        /^\/api\/stock\/([0-9A-Z]{4})$/
      );

    if (match) {
      const code = match[1];

      const key =
        `stocks/${code}.json.gz`;

      // R2から取得
      const object =
        await env.STOCK_DATA.get(key);

      // 存在しない銘柄
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

      // ======================================================
      // R2に保存されているHTTPメタデータを引き継ぐ
      //
      // Content-Type: application/json
      // Content-Encoding: gzip
      // など
      // ======================================================

      const headers =
        new Headers();

      object.writeHttpMetadata(
        headers
      );

      headers.set(
        "ETag",
        object.httpEtag
      );

      headers.set(
        "Cache-Control",
        "no-cache"
      );

      /*
       * 重要
       *
       * R2内のobject.bodyはすでにgzip済み。
       *
       * encodeBody:"automatic"のままだと
       * Cloudflare Workersが再圧縮する可能性がある。
       *
       * manualにすることで、
       * 「このbodyはContent-Encodingに記載された形式で
       *  すでに圧縮済み」とWorkerへ伝える。
       */
      return new Response(
        object.body,
        {
          headers,

          encodeBody:
            "manual"
        }
      );
    }

    // ========================================================
    // API以外
    //
    // public/index.html等のStatic Assetsへ
    // ========================================================

    return env.ASSETS.fetch(
      request
    );
  }
};
