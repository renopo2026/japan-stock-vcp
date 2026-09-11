export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(
        request.url
      );


    /*
    ==========================================================
    株価API

    /api/stock/9984
    ==========================================================
    */

    const stockMatch =
      url.pathname.match(
        /^\/api\/stock\/([0-9A-Z]{4})$/
      );


    if (
      stockMatch
    ) {

      return serveR2JsonGzip(

        env,

        `stocks/${stockMatch[1]}.json.gz`,

        {
          error:
            "Stock data not found",

          code:
            stockMatch[1]
        }
      );
    }


    /*
    ==========================================================
    需給API

    /api/supply/9984
    ==========================================================
    */

    const supplyMatch =
      url.pathname.match(
        /^\/api\/supply\/([0-9A-Z]{4})$/
      );


    if (
      supplyMatch
    ) {

      return serveR2JsonGzip(

        env,

        `supply/${supplyMatch[1]}.json.gz`,

        {
          error:
            "Supply data not found",

          code:
            supplyMatch[1]
        }
      );
    }


    /*
    ==========================================================
    TOPIX API

    /api/topix

    R2:
    benchmark/TOPIX.json.gz
    ==========================================================
    */

    if (
      url.pathname ===
      "/api/topix"
    ) {

      return serveR2JsonGzip(

        env,

        "benchmark/TOPIX.json.gz",

        {
          error:
            "TOPIX data not found",

          code:
            "TOPIX"
        }
      );
    }


    /*
    ==========================================================
    Static assets
    ==========================================================
    */

    return env.ASSETS.fetch(
      request
    );
  }
};


/*
==============================================================
R2 gzip JSON response

encodeBody: manual が重要。

R2内のgzipを
Cloudflareに再圧縮させない。
==============================================================
*/

async function serveR2JsonGzip(
  env,
  key,
  notFoundBody
) {

  const object =
    await env.STOCK_DATA.get(
      key
    );


  if (
    !object
  ) {

    return new Response(

      JSON.stringify(
        notFoundBody
      ),

      {

        status:
          404,

        headers: {

          "Content-Type":
            "application/json; charset=utf-8",

          "Cache-Control":
            "no-cache"
        }
      }
    );
  }


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


  return new Response(

    object.body,

    {

      headers,

      encodeBody:
        "manual"
    }
  );
}
