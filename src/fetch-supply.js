import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { chromium } from "playwright";
import * as XLSX from "xlsx";

import {
  gzipSync,
  gunzipSync
} from "node:zlib";


const CODE =
  String(
    process.env.STOCK_CODE ||
    "9984"
  )
  .trim()
  .toUpperCase();


const BUCKET =
  process.env.R2_BUCKET_NAME;


const ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID;


const ENDPOINT =
  process.env.R2_ENDPOINT ||
  `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;


const JSF_BACKFILL_YEARS =
  Math.max(
    1,
    Number(
      process.env.JSF_BACKFILL_YEARS ||
      10
    )
  );


const R2_KEY =
  `supply/${CODE}.json.gz`;


if (
  !/^[0-9A-Z]{4}$/.test(
    CODE
  )
) {

  throw new Error(
    `Invalid STOCK_CODE: ${CODE}`
  );
}


if (
  !BUCKET ||
  !ACCOUNT_ID ||
  !process.env.R2_ACCESS_KEY_ID ||
  !process.env.R2_SECRET_ACCESS_KEY
) {

  throw new Error(
    "R2 environment variables are missing"
  );
}


const s3 =
  new S3Client({

    region:
      "auto",

    endpoint:
      ENDPOINT,

    credentials: {

      accessKeyId:
        process.env.R2_ACCESS_KEY_ID,

      secretAccessKey:
        process.env.R2_SECRET_ACCESS_KEY
    },

    requestChecksumCalculation:
      "WHEN_REQUIRED",

    responseChecksumValidation:
      "WHEN_REQUIRED"
  });


const DEFAULT_HEADERS = {

  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 Chrome/152 Safari/537.36",

  "Accept-Language":
    "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5"
};


const sleep =
  ms =>
    new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );


function cleanText(
  value
) {

  return String(
    value ??
    ""
  )
  .replace(
    /\u3000/g,
    " "
  )
  .replace(
    /\s+/g,
    " "
  )
  .trim();
}


function normalizeCode(
  value
) {

  let code =
    cleanText(
      value
    )
    .toUpperCase()
    .replace(
      /[^0-9A-Z]/g,
      ""
    );


  if (
    /^[0-9]{5}$/.test(
      code
    )
    &&
    code.endsWith(
      "0"
    )
  ) {

    code =
      code.slice(
        0,
        4
      );
  }


  return code;
}


function parseNumber(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;
  }


  const text =
    String(
      value
    )
    .replace(
      /,/g,
      ""
    )
    .replace(
      /▲/g,
      "-"
    )
    .replace(
      /[^\d.\-]/g,
      ""
    );


  if (
    !text ||
    text === "-" ||
    text === "."
  ) {

    return null;
  }


  const n =
    Number(
      text
    );


  return Number.isFinite(
    n
  )
    ? n
    : null;
}


function normalizeDate(
  value
) {

  if (
    value instanceof Date
    &&
    !Number.isNaN(
      value.getTime()
    )
  ) {

    const y =
      value.getUTCFullYear();

    const m =
      String(
        value.getUTCMonth() + 1
      )
      .padStart(
        2,
        "0"
      );

    const d =
      String(
        value.getUTCDate()
      )
      .padStart(
        2,
        "0"
      );


    return `${y}-${m}-${d}`;
  }


  if (
    typeof value ===
    "number"
  ) {

    const parsed =
      XLSX.SSF
        .parse_date_code(
          value
        );


    if (
      parsed
    ) {

      return (
        `${parsed.y}-` +
        `${String(parsed.m).padStart(2, "0")}-` +
        `${String(parsed.d).padStart(2, "0")}`
      );
    }
  }


  const text =
    cleanText(
      value
    );


  let m =
    text.match(
      /(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/
    );


  if (
    m
  ) {

    return (
      `${m[1]}-` +
      `${String(m[2]).padStart(2, "0")}-` +
      `${String(m[3]).padStart(2, "0")}`
    );
  }


  m =
    text.match(
      /^(\d{4})(\d{2})(\d{2})$/
    );


  if (
    m
  ) {

    return (
      `${m[1]}-${m[2]}-${m[3]}`
    );
  }


  return null;
}


function todayJstString() {

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Tokyo",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
    .formatToParts(
      new Date()
    );


  const map =
    Object.fromEntries(
      parts.map(
        p => [
          p.type,
          p.value
        ]
      )
    );


  return (
    `${map.year}-` +
    `${map.month}-` +
    `${map.day}`
  );
}


function yearsAgoDateString(
  years
) {

  const today =
    todayJstString();


  const [
    y,
    m,
    d
  ] =
    today
      .split("-")
      .map(Number);


  const dt =
    new Date(
      Date.UTC(
        y - years,
        m - 1,
        d
      )
    );


  return dt
    .toISOString()
    .slice(
      0,
      10
    );
}


function formatJsfDate(
  iso
) {

  const [
    y,
    m,
    d
  ] =
    iso.split("-");


  return (
    `${y} / ${m} / ${d}`
  );
}


function round(
  value,
  digits = 6
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;
  }


  const scale =
    10 ** digits;


  return (
    Math.round(
      value *
      scale
    )
    /
    scale
  );
}


function absoluteUrl(
  base,
  href
) {

  try {

    return new URL(
      href,
      base
    ).href;

  }
  catch {

    return null;
  }
}


function minMaxDates(
  rows,
  key = "date"
) {

  const dates =
    rows
      .map(
        r =>
          r?.[key]
      )
      .filter(
        Boolean
      )
      .sort();


  return {

    startDate:
      dates[0] ??
      null,

    endDate:
      dates[
        dates.length - 1
      ]
      ??
      null
  };
}


async function fetchResponse(
  url,
  attempts = 4
) {

  let lastError;


  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {

    try {

      console.log(
        `[HTTP] ${url}`
      );


      const response =
        await fetch(
          url,
          {
            headers:
              DEFAULT_HEADERS,

            redirect:
              "follow"
          }
        );


      if (
        response.ok
      ) {

        return response;
      }


      throw new Error(
        `HTTP ${response.status} ${response.statusText}`
      );

    }
    catch (
      error
    ) {

      lastError =
        error;


      console.warn(
        `[HTTP] attempt ${attempt}/${attempts} failed: ${error.message}`
      );


      if (
        attempt <
        attempts
      ) {

        await sleep(
          attempt *
          3000
        );
      }
    }
  }


  throw lastError;
}


async function fetchText(
  url
) {

  return (
    await fetchResponse(
      url
    )
  ).text();
}


async function fetchBuffer(
  url
) {

  return Buffer.from(
    await (
      await fetchResponse(
        url
      )
    ).arrayBuffer()
  );
}


async function loadExistingSupply() {

  try {

    const object =
      await s3.send(
        new GetObjectCommand({

          Bucket:
            BUCKET,

          Key:
            R2_KEY
        })
      );


    const bytes =
      Buffer.from(
        await object.Body
          .transformToByteArray()
      );


    const parsed =
      JSON.parse(
        gunzipSync(
          bytes
        )
        .toString(
          "utf8"
        )
      );


    console.log(
      `[R2] existing ${R2_KEY}: ${parsed.rows?.length ?? 0} rows`
    );


    return parsed;

  }
  catch (
    error
  ) {

    if (
      error.name ===
        "NoSuchKey"
      ||
      error.$metadata
        ?.httpStatusCode ===
        404
    ) {

      console.log(
        `[R2] ${R2_KEY} does not exist yet`
      );


      return null;
    }


    console.warn(
      `[R2] existing data could not be loaded: ${error.message}`
    );


    return null;
  }
}


function parseCsvLine(
  line
) {

  const result =
    [];

  let current =
    "";

  let quoted =
    false;


  for (
    let i = 0;
    i < line.length;
    i++
  ) {

    const char =
      line[i];


    if (
      char === '"'
    ) {

      if (
        quoted
        &&
        line[i + 1] === '"'
      ) {

        current +=
          '"';

        i++;

      }
      else {

        quoted =
          !quoted;
      }


      continue;
    }


    if (
      char === ","
      &&
      !quoted
    ) {

      result.push(
        current
      );

      current =
        "";

      continue;
    }


    current +=
      char;
  }


  result.push(
    current
  );


  return result;
}


function parseCsv(
  text
) {

  return text
    .replace(
      /^\uFEFF/,
      ""
    )
    .split(
      /\r?\n/
    )
    .filter(
      line =>
        line.trim()
    )
    .map(
      parseCsvLine
    );
}


function decodeJapaneseCsv(
  buffer
) {

  const utf8 =
    buffer
      .toString(
        "utf8"
      )
      .replace(
        /^\uFEFF/,
        ""
      );


  if (
    /申込日|融資|貸株|銘柄コード/.test(
      utf8
    )
    &&
    !utf8.includes(
      "�"
    )
  ) {

    return utf8;
  }


  return iconv
    .decode(
      buffer,
      "cp932"
    )
    .replace(
      /^\uFEFF/,
      ""
    );
}


/*
==============================================================
JSF 現在残高
==============================================================
*/

async function fetchJsfCurrentCsv() {

  console.log(
    "\n=== JSF current zandaka.csv ==="
  );


  const text =
    decodeJapaneseCsv(
      await fetchBuffer(
        "https://www.taisyaku.jp/data/zandaka.csv"
      )
    );


  const records =
    parseCsv(
      text
    );


  const candidates =
    [];


  for (
    const row
    of records
  ) {

    if (
      row.length <
      13
    ) {

      continue;
    }


    if (
      normalizeCode(
        row[2]
      ) !==
      CODE
    ) {

      continue;
    }


    if (
      !cleanText(
        row[4]
      )
      .includes(
        "東証"
      )
    ) {

      continue;
    }


    const date =
      normalizeDate(
        row[0]
      );


    if (
      !date
    ) {

      continue;
    }


    const status =
      cleanText(
        row[6]
      );


    const loanBalance =
      parseNumber(
        row[9]
      );


    const stockLoanBalance =
      parseNumber(
        row[12]
      );


    const loanRatio =
      stockLoanBalance >
        0
      &&
      loanBalance !==
        null
      ?
        round(
          loanBalance /
          stockLoanBalance,
          6
        )
      :
        null;


    candidates.push({

      date,

      status,

      loanBalance,

      stockLoanBalance,

      loanRatio
    });
  }


  candidates.sort(
    (
      a,
      b
    ) => {

      if (
        a.date !==
        b.date
      ) {

        return b.date
          .localeCompare(
            a.date
          );
      }


      if (
        a.status ===
          "確報"
        &&
        b.status !==
          "確報"
      ) {

        return -1;
      }


      if (
        b.status ===
          "確報"
        &&
        a.status !==
          "確報"
      ) {

        return 1;
      }


      return 0;
    }
  );


  if (
    !candidates.length
  ) {

    console.warn(
      `[JSF] ${CODE} not found in zandaka.csv`
    );


    return [];
  }


  console.log(
    "[JSF] current:",
    candidates[0]
  );


  return [
    candidates[0]
  ];
}


/*
==============================================================
HTML table展開
==============================================================
*/

function htmlTableToGrid(
  $,
  table
) {

  const grid =
    [];

  const spans =
    [];


  $(table)
    .find(
      "tr"
    )
    .each(
      (
        _,
        tr
      ) => {

        const row =
          [];

        let col =
          0;


        const placePending =
          () => {

            while (
              spans[col]
              ?.remaining >
              0
            ) {

              row[col] =
                spans[col]
                  .text;


              spans[col]
                .remaining--;


              if (
                spans[col]
                  .remaining <=
                0
              ) {

                spans[col] =
                  null;
              }


              col++;
            }
          };


        placePending();


        $(tr)
          .children(
            "th,td"
          )
          .each(
            (
              _,
              cell
            ) => {

              placePending();


              const text =
                cleanText(
                  $(cell)
                    .text()
                );


              const rowspan =
                Math.max(
                  1,
                  Number(
                    $(cell)
                      .attr(
                        "rowspan"
                      )
                    ||
                    1
                  )
                );


              const colspan =
                Math.max(
                  1,
                  Number(
                    $(cell)
                      .attr(
                        "colspan"
                      )
                    ||
                    1
                  )
                );


              for (
                let k = 0;
                k < colspan;
                k++
              ) {

                row[
                  col + k
                ] =
                  text;


                if (
                  rowspan >
                  1
                ) {

                  spans[
                    col + k
                  ] = {

                    text,

                    remaining:
                      rowspan - 1
                  };
                }
              }


              col +=
                colspan;
            }
          );


        placePending();


        grid.push(
          row
        );
      }
    );


  return grid;
}


/*
==============================================================
JSF 直近表示分
==============================================================
*/

async function fetchJsfRecentDetail() {

  console.log(
    "\n=== JSF recent detail ==="
  );


  const url =
    `https://www.taisyaku.jp/app/stock/detail/${CODE}-01`;


  const $ =
    cheerio.load(
      await fetchText(
        url
      )
    );


  let bestGrid =
    null;


  $("table")
    .each(
      (
        _,
        table
      ) => {

        const text =
          cleanText(
            $(table)
              .text()
          );


        if (
          text.includes(
            "申込日"
          )
          &&
          text.includes(
            "融資"
          )
          &&
          text.includes(
            "貸株"
          )
        ) {

          bestGrid =
            htmlTableToGrid(
              $,
              table
            );
        }
      }
    );


  if (
    !bestGrid
  ) {

    return [];
  }


  let dateColumns =
    [];


  for (
    const row
    of bestGrid
  ) {

    if (
      !row.some(
        value =>
          cleanText(
            value
          ) ===
          "申込日"
      )
    ) {

      continue;
    }


    dateColumns =
      row
        .map(
          (
            value,
            index
          ) => ({

            index,

            date:
              normalizeDate(
                value
              )
          })
        )
        .filter(
          x =>
            x.date
        );


    break;
  }


  if (
    !dateColumns.length
  ) {

    return [];
  }


  const data =
    new Map();


  let section =
    null;


  for (
    const row
    of bestGrid
  ) {

    if (
      row.some(
        v =>
          cleanText(
            v
          ) ===
          "融資"
      )
    ) {

      section =
        "fund";
    }


    if (
      row.some(
        v =>
          cleanText(
            v
          ) ===
          "貸株"
      )
    ) {

      section =
        "stock";
    }


    if (
      !row.some(
        v =>
          cleanText(
            v
          ) ===
          "残高"
      )
      ||
      !section
    ) {

      continue;
    }


    for (
      const item
      of dateColumns
    ) {

      const value =
        parseNumber(
          row[
            item.index
          ]
        );


      if (
        value ===
        null
      ) {

        continue;
      }


      if (
        !data.has(
          item.date
        )
      ) {

        data.set(
          item.date,
          {
            date:
              item.date
          }
        );
      }


      const target =
        data.get(
          item.date
        );


      if (
        section ===
        "fund"
      ) {

        target.loanBalance =
          value;

      }
      else {

        target.stockLoanBalance =
          value;
      }
    }
  }


  const result =
    [...data.values()]
      .filter(
        r =>
          r.loanBalance !==
          undefined
        &&
        r.stockLoanBalance !==
          undefined
      )
      .map(
        r => ({

          ...r,

          loanRatio:
            r.stockLoanBalance >
            0
            ?
              round(
                r.loanBalance /
                r.stockLoanBalance,
                6
              )
            :
              null
        })
      )
      .sort(
        (
          a,
          b
        ) =>
          a.date
            .localeCompare(
              b.date
            )
      );


  console.log(
    `[JSF] recent detail: ${result.length} rows`
  );


  return result;
}


/*
==============================================================
JSF 過去CSV
==============================================================
*/

async function downloadToBuffer(
  download
) {

  const stream =
    await download
      .createReadStream();


  const chunks =
    [];


  for await (
    const chunk
    of stream
  ) {

    chunks.push(
      Buffer.from(
        chunk
      )
    );
  }


  return Buffer.concat(
    chunks
  );
}


async function requestJsfCsv(
  page,
  startIso,
  endIso
) {

  const detailUrl =
    `https://www.taisyaku.jp/app/stock/detail/${CODE}-01`;


  await page.goto(
    detailUrl,
    {
      waitUntil:
        "domcontentloaded",

      timeout:
        60000
    }
  );


  const periodInputs =
    page.locator(
      'input[placeholder*="YYYY"]'
    );


  if (
    await periodInputs.count()
    <
    2
  ) {

    throw new Error(
      "JSF period inputs not found"
    );
  }


  await periodInputs
    .nth(0)
    .fill(
      formatJsfDate(
        startIso
      )
    );


  await periodInputs
    .nth(1)
    .fill(
      formatJsfDate(
        endIso
      )
    );


  try {

    await page
      .getByText(
        "選択なし",
        {
          exact:
            true
        }
      )
      .click(
        {
          timeout:
            2000
        }
      );

  }
  catch {}


  let downloaded =
    null;


  const firstDownload =
    page
      .waitForEvent(
        "download",
        {
          timeout:
            15000
        }
      )
      .catch(
        () =>
          null
      );


  await page
    .getByRole(
      "button",
      {
        name:
          "この条件で表示する"
      }
    )
    .click(
      {
        timeout:
          10000
      }
    );


  downloaded =
    await firstDownload;


  if (
    !downloaded
  ) {

    await page
      .waitForLoadState(
        "domcontentloaded",
        {
          timeout:
            10000
        }
      )
      .catch(
        () => {}
      );


    const csvLink =
      page
        .getByRole(
          "link",
          {
            name:
              "CSV",

            exact:
              true
          }
        )
        .first();


    if (
      await csvLink.count()
      ===
      0
    ) {

      throw new Error(
        "JSF CSV link not found after period selection"
      );
    }


    const secondDownload =
      page.waitForEvent(
        "download",
        {
          timeout:
            20000
        }
      );


    await csvLink.click();


    downloaded =
      await secondDownload;
  }


  return downloadToBuffer(
    downloaded
  );
}


function parseJsfHistoricalCsv(
  buffer
) {

  const rows =
    parseCsv(
      decodeJapaneseCsv(
        buffer
      )
    );


  if (
    !rows.length
  ) {

    return [];
  }


  /*
  ============================================================
  JSF CSVは横持ち形式を優先して解析する。

  重要：
  「直後基準日 2026/09/30」などのメタデータを
  申込日として誤認しないように、

  「申込日」というセルより右側だけ

  を日付系列として使用する。
  ============================================================
  */

  let dates =
    [];


  for (
    const row
    of rows
  ) {

    const labelIndex =
      row.findIndex(
        value =>
          cleanText(
            value
          ) ===
          "申込日"
      );


    if (
      labelIndex <
      0
    ) {

      continue;
    }


    /*
      「申込日」より左側または別フィールドにある
      直後基準日などを除外する。
    */

    dates =
      row
        .slice(
          labelIndex + 1
        )
        .map(
          value =>
            normalizeDate(
              value
            )
        )
        .filter(
          Boolean
        )
        .filter(
          date =>
            date <=
            todayJstString()
        );


    if (
      dates.length
    ) {

      break;
    }
  }


  /*
  ============================================================
  横持ち形式
  ============================================================
  */

  if (
    dates.length
  ) {

    console.log(
      `[JSF parser] application dates found: ${dates.length}`
    );


    console.log(
      `[JSF parser] date range: ` +
      `${dates[dates.length - 1]} -> ${dates[0]}`
    );


    let section =
      null;


    let loanValues =
      null;


    let stockLoanValues =
      null;


    for (
      const row
      of rows
    ) {

      const labels =
        row.map(
          value =>
            cleanText(
              value
            )
        );


      /*
      ----------------------------------------------------------
      融資セクション開始
      ----------------------------------------------------------
      */

      if (
        labels.some(
          value =>
            value ===
            "融資"
        )
      ) {

        section =
          "loan";
      }


      /*
      ----------------------------------------------------------
      貸株セクション開始
      ----------------------------------------------------------
      */

      if (
        labels.some(
          value =>
            value ===
            "貸株"
        )
      ) {

        section =
          "stockLoan";
      }


      /*
      ----------------------------------------------------------
      「残高」の行だけ取得する。

      新規・返済は使わない。
      ----------------------------------------------------------
      */

      const hasExactBalance =
        labels.some(
          value =>
            value ===
            "残高"
        );


      if (
        !hasExactBalance
        ||
        !section
      ) {

        continue;
      }


      /*
      ----------------------------------------------------------
      JSF CSVでは先頭の見出し列数が行によって異なるため、
      右端から申込日数分を取得する。

      datesは既に「申込日より右側」のみなので、
      直後基準日による1列ズレは発生しない。
      ----------------------------------------------------------
      */

      const values =
        row
          .slice(
            -dates.length
          )
          .map(
            value =>
              parseNumber(
                value
              )
          );


      if (
        section ===
        "loan"
        &&
        loanValues ===
        null
      ) {

        loanValues =
          values;


        console.log(
          `[JSF parser] loan balance row found: ${values.length}`
        );
      }


      if (
        section ===
        "stockLoan"
        &&
        stockLoanValues ===
        null
      ) {

        stockLoanValues =
          values;


        console.log(
          `[JSF parser] stock loan balance row found: ${values.length}`
        );
      }
    }


    if (
      loanValues
      &&
      stockLoanValues
    ) {

      const out =
        [];


      const count =
        Math.min(
          dates.length,
          loanValues.length,
          stockLoanValues.length
        );


      for (
        let i = 0;
        i < count;
        i++
      ) {

        const date =
          dates[i];


        const loanBalance =
          loanValues[i];


        const stockLoanBalance =
          stockLoanValues[i];


        if (
          !date
          ||
          loanBalance ===
          null
          ||
          stockLoanBalance ===
          null
        ) {

          continue;
        }


        /*
          貸株残高 = 0 の場合は倍率を定義できないので
          nullとする。
        */

        const loanRatio =
          stockLoanBalance >
          0
          ?
            round(
              loanBalance /
              stockLoanBalance,
              6
            )
          :
            null;


        out.push({

          date,

          loanBalance,

          stockLoanBalance,

          loanRatio
        });
      }


      /*
      ----------------------------------------------------------
      日付重複除去
      ----------------------------------------------------------
      */

      const result =
        dedupeRows(
          out
        );


      console.log(
        `[JSF parser] parsed historical rows: ${result.length}`
      );


      const validRatios =
        result.filter(
          row =>
            row.loanRatio !==
            null
          &&
            row.loanRatio !==
            undefined
        );


      console.log(
        `[JSF parser] valid loanRatio rows: ${validRatios.length}`
      );


      if (
        result.length
      ) {

        console.log(
          `[JSF parser] first row:`,
          result[0]
        );


        console.log(
          `[JSF parser] last row:`,
          result[
            result.length - 1
          ]
        );
      }


      return result;
    }
  }


  /*
  ============================================================
  縦持ちCSV fallback

  将来JSF側のCSV形式が変わった場合用。
  ============================================================
  */

  console.log(
    "[JSF parser] horizontal format not detected; trying vertical format"
  );


  for (
    let h = 0;
    h <
      Math.min(
        rows.length,
        30
      );
    h++
  ) {

    const header =
      rows[h]
        .map(
          value =>
            cleanText(
              value
            )
        );


    const dateCol =
      header.findIndex(
        value =>
          value.includes(
            "申込日"
          )
      );


    const loanCol =
      header.findIndex(
        value =>
          value.includes(
            "融資残高"
          )
      );


    const stockLoanCol =
      header.findIndex(
        value =>
          value.includes(
            "貸株残高"
          )
      );


    if (
      dateCol <
      0
      ||
      loanCol <
      0
      ||
      stockLoanCol <
      0
    ) {

      continue;
    }


    const out =
      [];


    for (
      let r =
        h + 1;

      r <
        rows.length;

      r++
    ) {

      const date =
        normalizeDate(
          rows[r][dateCol]
        );


      /*
        将来日や基準日を除外
      */

      if (
        !date
        ||
        date >
        todayJstString()
      ) {

        continue;
      }


      const loanBalance =
        parseNumber(
          rows[r][loanCol]
        );


      const stockLoanBalance =
        parseNumber(
          rows[r][stockLoanCol]
        );


      if (
        loanBalance ===
        null
        ||
        stockLoanBalance ===
        null
      ) {

        continue;
      }


      out.push({

        date,

        loanBalance,

        stockLoanBalance,

        loanRatio:
          stockLoanBalance >
          0
          ?
            round(
              loanBalance /
              stockLoanBalance,
              6
            )
          :
            null
      });
    }


    if (
      out.length
    ) {

      const result =
        dedupeRows(
          out
        );


      console.log(
        `[JSF parser] vertical format rows: ${result.length}`
      );


      return result;
    }
  }


  throw new Error(
    "JSF historical CSV: loan/stock-loan balance rows could not be parsed"
  );
}


async function fetchJsfHistoricalCsv(
  years = 10
) {

  console.log(
    `\n=== JSF historical CSV backfill (${years}y) ===`
  );


  const start =
    yearsAgoDateString(
      years
    );


  const end =
    todayJstString();


  const browser =
    await chromium.launch(
      {
        headless:
          true
      }
    );


  const page =
    await browser.newPage(
      {
        acceptDownloads:
          true
      }
    );


  page.on(
    "dialog",
    async dialog => {

      console.log(
        `[JSF dialog] ${dialog.message()}`
      );


      await dialog
        .accept()
        .catch(
          () => {}
        );
    }
  );


  try {

    /*
    ----------------------------------------------------------
    まず10年を一括取得
    ----------------------------------------------------------
    */

    try {

      const buffer =
        await requestJsfCsv(
          page,
          start,
          end
        );


      const parsed =
        parseJsfHistoricalCsv(
          buffer
        );


      console.log(
        `[JSF] full-range CSV: ${parsed.length} rows`
      );


      if (
        parsed.length >=
        100
      ) {

        return dedupeRows(
          parsed
        );
      }

    }
    catch (
      error
    ) {

      console.warn(
        `[JSF] full-range CSV failed: ${error.message}`
      );
    }


    /*
    ----------------------------------------------------------
    一括が駄目なら年単位
    ----------------------------------------------------------
    */

    console.log(
      "[JSF] falling back to yearly CSV chunks"
    );


    const all =
      [];


    const [
      startYear
    ] =
      start
        .split("-")
        .map(Number);


    const [
      endYear
    ] =
      end
        .split("-")
        .map(Number);


    for (
      let year =
        startYear;

      year <=
        endYear;

      year++
    ) {

      const chunkStart =
        year ===
        startYear
        ?
          start
        :
          `${year}-01-01`;


      const chunkEnd =
        year ===
        endYear
        ?
          end
        :
          `${year}-12-31`;


      try {

        const buffer =
          await requestJsfCsv(
            page,
            chunkStart,
            chunkEnd
          );


        const parsed =
          parseJsfHistoricalCsv(
            buffer
          );


        console.log(
          `[JSF] ${chunkStart}..${chunkEnd}: ${parsed.length} rows`
        );


        all.push(
          ...parsed
        );

      }
      catch (
        error
      ) {

        console.warn(
          `[JSF] chunk ${year} failed: ${error.message}`
        );
      }


      await sleep(
        400
      );
    }


    return dedupeRows(
      all
    );

  }
  finally {

    await browser.close();
  }
}


/*
==============================================================
Yahoo 信用倍率
==============================================================
*/

async function fetchYahooMarginHistory(
  years = 10
) {

  console.log(
    "\n=== Yahoo margin history ==="
  );


  const cutoff =
    yearsAgoDateString(
      years
    );


  let url =
    `https://finance.yahoo.co.jp/quote/${CODE}.T/history?styl=margin`;


  const results =
    new Map();


  const seenPages =
    new Set();


  for (
    let page = 1;
    page <= 35;
    page++
  ) {

    let html;


    try {

      html =
        await fetchText(
          url
        );

    }
    catch (
      error
    ) {

      console.warn(
        `[Yahoo margin] stopped: ${error.message}`
      );


      break;
    }


    const $ =
      cheerio.load(
        html
      );


    let tableFound =
      false;

    let firstDate =
      null;

    let oldestDate =
      null;


    $("table")
      .each(
        (
          _,
          table
        ) => {

          const headers =
            $(table)
              .find(
                "th"
              )
              .map(
                (
                  _,
                  th
                ) =>
                  cleanText(
                    $(th)
                      .text()
                  )
              )
              .get();


          if (
            !headers.some(
              text =>
                text.includes(
                  "信用倍率"
                )
            )
          ) {

            return;
          }


          tableFound =
            true;


          $(table)
            .find(
              "tbody tr"
            )
            .each(
              (
                _,
                tr
              ) => {

                const cells =
                  $(tr)
                    .find(
                      "th,td"
                    )
                    .map(
                      (
                        _,
                        cell
                      ) =>
                        cleanText(
                          $(cell)
                            .text()
                        )
                    )
                    .get();


                if (
                  cells.length <
                  6
                ) {

                  return;
                }


                const date =
                  normalizeDate(
                    cells[0]
                  );


                if (
                  !date
                ) {

                  return;
                }


                if (
                  !firstDate
                ) {

                  firstDate =
                    date;
                }


                oldestDate =
                  date;


                if (
                  date <
                  cutoff
                ) {

                  return;
                }


                const marginSell =
                  parseNumber(
                    cells[1]
                  );


                const marginBuy =
                  parseNumber(
                    cells[2]
                  );


                let marginRatio =
                  parseNumber(
                    cells[5]
                  );


                if (
                  marginRatio ===
                    null
                  &&
                  marginSell >
                    0
                  &&
                  marginBuy !==
                    null
                ) {

                  marginRatio =
                    round(
                      marginBuy /
                      marginSell,
                      6
                    );
                }


                results.set(
                  date,
                  {

                    date,

                    marginSell,

                    marginBuy,

                    marginRatio
                  }
                );
              }
            );
        }
      );


    if (
      !tableFound
    ) {

      break;
    }


    if (
      firstDate
      &&
      seenPages.has(
        firstDate
      )
    ) {

      break;
    }


    if (
      firstDate
    ) {

      seenPages.add(
        firstDate
      );
    }


    console.log(
      `[Yahoo margin] page ${page}: ${firstDate ?? "?"} -> ${oldestDate ?? "?"}`
    );


    if (
      oldestDate
      &&
      oldestDate <
      cutoff
    ) {

      break;
    }


    let nextHref =
      null;


    $("a")
      .each(
        (
          _,
          anchor
        ) => {

          if (
            cleanText(
              $(anchor)
                .text()
            ) ===
            "次へ"
          ) {

            nextHref =
              $(anchor)
                .attr(
                  "href"
                );
          }
        }
      );


    if (
      nextHref
    ) {

      url =
        absoluteUrl(
          url,
          nextHref
        );

    }
    else {

      const fallback =
        new URL(
          `https://finance.yahoo.co.jp/quote/${CODE}.T/history`
        );


      fallback
        .searchParams
        .set(
          "styl",
          "margin"
        );


      fallback
        .searchParams
        .set(
          "page",
          String(
            page + 1
          )
        );


      url =
        fallback.href;
    }


    await sleep(
      700
    );
  }


  const rows =
    [...results.values()]
      .sort(
        (
          a,
          b
        ) =>
          a.date
            .localeCompare(
              b.date
            )
      );


  console.log(
    `[Yahoo margin] ${rows.length} rows`
  );


  return rows;
}


/*
==============================================================
JPX 公表機関空売り
==============================================================
*/

function datesFromPageText(
  text
) {

  return [
    ...text.matchAll(
      /(\d{4})\/(\d{1,2})\/(\d{1,2})/g
    )
  ]
  .map(
    m =>
      (
        `${m[1]}-` +
        `${String(m[2]).padStart(2, "0")}-` +
        `${String(m[3]).padStart(2, "0")}`
      )
  );
}


async function parseJpxShortPage(
  pageUrl
) {

  const html =
    await fetchText(
      pageUrl
    );


  const $ =
    cheerio.load(
      html
    );


  const files =
    [];


  $("tr")
    .each(
      (
        _,
        tr
      ) => {

        const rowText =
          cleanText(
            $(tr)
              .text()
          );


        const publicationDate =
          datesFromPageText(
            rowText
          )[0]
          ||
          null;


        $(tr)
          .find(
            "a[href]"
          )
          .each(
            (
              _,
              anchor
            ) => {

              const href =
                $(anchor)
                  .attr(
                    "href"
                  );


              if (
                !href
                ||
                !/\.(xlsx?|xls)(?:\?|$)/i
                  .test(
                    href
                  )
              ) {

                return;
              }


              const url =
                absoluteUrl(
                  pageUrl,
                  href
                );


              if (
                url
              ) {

                files.push({

                  url,

                  publicationDate
                });
              }
            }
          );
      }
    );


  const archives =
    new Set();


  $("option[value],a[href]")
    .each(
      (
        _,
        element
      ) => {

        const value =
          $(element)
            .attr(
              "value"
            )
          ||
          $(element)
            .attr(
              "href"
            );


        if (
          !value
          ||
          !value.includes(
            "archives"
          )
        ) {

          return;
        }


        const url =
          absoluteUrl(
            pageUrl,
            value
          );


        if (
          url
        ) {

          archives.add(
            url
          );
        }
      }
    );


  return {

    html,

    files,

    archives:
      [...archives]
  };
}


function sheetCell(
  sheet,
  row,
  column
) {

  return sheet[
    XLSX.utils
      .encode_cell(
        {
          r:
            row,

          c:
            column
        }
      )
  ];
}


function sheetCellText(
  sheet,
  row,
  column
) {

  const cell =
    sheetCell(
      sheet,
      row,
      column
    );


  return cell
    ?
      cleanText(
        cell.w ??
        cell.v ??
        ""
      )
    :
      "";
}


function parsePercentCell(
  cell
) {

  if (
    !cell
  ) {

    return null;
  }


  if (
    typeof cell.v ===
    "number"
  ) {

    const format =
      String(
        cell.z ??
        ""
      );


    const display =
      String(
        cell.w ??
        ""
      );


    return round(
      format.includes("%")
      ||
      display.includes("%")
        ?
          cell.v *
          100
        :
          cell.v,
      6
    );
  }


  return parseNumber(
    cell.v
  );
}


function parseJpxShortWorkbook(
  buffer,
  publicationDate,
  fileUrl
) {

  const workbook =
    XLSX.read(
      buffer,
      {

        type:
          "buffer",

        cellDates:
          true,

        cellNF:
          true,

        cellText:
          true
      }
    );


  const events =
    [];


  for (
    const sheetName
    of workbook.SheetNames
  ) {

    const sheet =
      workbook.Sheets[
        sheetName
      ];


    if (
      !sheet["!ref"]
    ) {

      continue;
    }


    const range =
      XLSX.utils
        .decode_range(
          sheet["!ref"]
        );


    const headerMaxRow =
      Math.min(
        range.e.r,
        range.s.r +
        20
      );


    const columnText =
      [];


    for (
      let c =
        range.s.c;

      c <=
        range.e.c;

      c++
    ) {

      let text =
        "";


      for (
        let r =
          range.s.r;

        r <=
          headerMaxRow;

        r++
      ) {

        text +=
          ` ${sheetCellText(
            sheet,
            r,
            c
          )}`;
      }


      columnText[c] =
        cleanText(
          text
        );
    }


    let holderCol =
      null;

    let addressCol =
      null;

    let codeCol =
      null;

    let calcDateCol =
      null;

    let ratioCol =
      null;


    for (
      let c =
        range.s.c;

      c <=
        range.e.c;

      c++
    ) {

      const text =
        columnText[c]
        ||
        "";


      if (
        holderCol ===
          null
        &&
        (
          (
            text.includes(
              "商号"
            )
            &&
            text.includes(
              "名称"
            )
          )
          ||
          /position holder/i
            .test(
              text
            )
        )
      ) {

        holderCol =
          c;
      }


      if (
        addressCol ===
          null
        &&
        (
          text.includes(
            "住所"
          )
          ||
          /address/i
            .test(
              text
            )
        )
      ) {

        addressCol =
          c;
      }


      if (
        codeCol ===
          null
        &&
        (
          text.includes(
            "銘柄コード"
          )
          ||
          /\bcode\b/i
            .test(
              text
            )
        )
        &&
        !text.includes(
          "新証券コード"
        )
      ) {

        codeCol =
          c;
      }


      if (
        calcDateCol ===
          null
        &&
        (
          text.includes(
            "計算年月日"
          )
          ||
          /calculation date/i
            .test(
              text
            )
        )
        &&
        !text.includes(
          "直近"
        )
        &&
        !/previous|last/i
          .test(
            text
          )
      ) {

        calcDateCol =
          c;
      }


      if (
        ratioCol ===
          null
        &&
        (
          text.includes(
            "残高割合"
          )
          ||
          /short position ratio/i
            .test(
              text
            )
        )
        &&
        !text.includes(
          "直近"
        )
        &&
        !/previous|last/i
          .test(
            text
          )
      ) {

        ratioCol =
          c;
      }
    }


    if (
      codeCol ===
        null
      ||
      calcDateCol ===
        null
      ||
      ratioCol ===
        null
    ) {

      continue;
    }


    for (
      let r =
        range.s.r;

      r <=
        range.e.r;

      r++
    ) {

      if (
        normalizeCode(
          sheetCellText(
            sheet,
            r,
            codeCol
          )
        )
        !==
        CODE
      ) {

        continue;
      }


      const calcCell =
        sheetCell(
          sheet,
          r,
          calcDateCol
        );


      const calculationDate =
        normalizeDate(
          calcCell?.v ??
          calcCell?.w
        );


      const ratio =
        parsePercentCell(
          sheetCell(
            sheet,
            r,
            ratioCol
          )
        );


      if (
        !calculationDate
        ||
        ratio ===
        null
      ) {

        continue;
      }


      events.push({

        calculationDate,

        publicationDate:
          publicationDate ||
          calculationDate,

        institution:
          holderCol !==
          null
          ?
            (
              sheetCellText(
                sheet,
                r,
                holderCol
              )
              ||
              "Unknown"
            )
          :
            "Unknown",

        address:
          addressCol !==
          null
          ?
            sheetCellText(
              sheet,
              r,
              addressCol
            )
          :
            "",

        ratio,

        source:
          fileUrl
      });
    }
  }


  return events;
}


async function fetchJpxShortHistory(
  fullBackfill
) {

  console.log(
    `\n=== JPX public short positions (${fullBackfill ? "full archive scan" : "current page"}) ===`
  );


  const root =
    "https://www.jpx.co.jp/markets/public/short-selling/";


  const rootPage =
    await parseJpxShortPage(
      root
    );


  let files =
    [
      ...rootPage.files
    ];


  let pageFailures =
    0;


  if (
    fullBackfill
  ) {

    console.log(
      `[JPX] archive pages discovered: ${rootPage.archives.length}`
    );


    for (
      const archiveUrl
      of rootPage.archives
    ) {

      try {

        const page =
          await parseJpxShortPage(
            archiveUrl
          );


        files.push(
          ...page.files
        );

      }
      catch (
        error
      ) {

        pageFailures++;


        console.warn(
          `[JPX] archive skipped ${archiveUrl}: ${error.message}`
        );
      }


      await sleep(
        100
      );
    }
  }


  const unique =
    new Map();


  for (
    const file
    of files
  ) {

    unique.set(
      file.url,
      file
    );
  }


  files =
    [...unique.values()]
      .sort(
        (
          a,
          b
        ) =>
          (
            a.publicationDate ||
            ""
          )
          .localeCompare(
            b.publicationDate ||
            ""
          )
      );


  console.log(
    `[JPX] Excel files: ${files.length}`
  );


  const events =
    [];


  let processedFiles =
    0;

  let failedFiles =
    0;


  for (
    let i = 0;
    i < files.length;
    i++
  ) {

    const file =
      files[i];


    try {

      const parsed =
        parseJpxShortWorkbook(
          await fetchBuffer(
            file.url
          ),
          file.publicationDate,
          file.url
        );


      processedFiles++;


      if (
        parsed.length
      ) {

        console.log(
          `[JPX] ${file.publicationDate ?? "?"}: ${parsed.length} ${CODE} records`
        );


        events.push(
          ...parsed
        );
      }

    }
    catch (
      error
    ) {

      failedFiles++;


      console.warn(
        `[JPX] file skipped ${file.url}: ${error.message}`
      );
    }


    if (
      i <
      files.length - 1
    ) {

      await sleep(
        120
      );
    }
  }


  const publicationDates =
    files
      .map(
        f =>
          f.publicationDate
      )
      .filter(
        Boolean
      )
      .sort();


  return {

    events,

    fullBackfill,

    fileCount:
      files.length,

    processedFiles,

    failedFiles,

    pageFailures,

    coverageStartDate:
      publicationDates[0]
      ??
      null,

    coverageEndDate:
      publicationDates[
        publicationDates.length - 1
      ]
      ??
      null
  };
}


function shortStateMap(
  state
) {

  const map =
    new Map();


  for (
    const item
    of state?.active ??
    []
  ) {

    const key =
      `${item.name ?? "Unknown"}||${item.address ?? ""}`;


    map.set(
      key,
      {

        name:
          item.name ??
          "Unknown",

        address:
          item.address ??
          "",

        ratio:
          Number(
            item.ratio
          )
      }
    );
  }


  return map;
}


function applyShortEvents(
  events,
  previousState = null,
  incremental = false
) {

  const active =
    incremental
    ?
      shortStateMap(
        previousState
      )
    :
      new Map();


  const previousAsOf =
    incremental
    ?
      previousState?.asOfDate ??
      null
    :
      null;


  const relevant =
    [...events]
      .filter(
        e =>
          !incremental
          ||
          !previousAsOf
          ||
          e.calculationDate >
          previousAsOf
      )
      .sort(
        (
          a,
          b
        ) => {

          const d =
            a.calculationDate
              .localeCompare(
                b.calculationDate
              );


          return d
            ||
            (
              a.publicationDate ||
              ""
            )
            .localeCompare(
              b.publicationDate ||
              ""
            );
        }
      );


  const byDate =
    new Map();


  for (
    const event
    of relevant
  ) {

    if (
      !byDate.has(
        event.calculationDate
      )
    ) {

      byDate.set(
        event.calculationDate,
        []
      );
    }


    byDate
      .get(
        event.calculationDate
      )
      .push(
        event
      );
  }


  const snapshots =
    [];


  let asOfDate =
    previousAsOf;


  for (
    const date
    of [...byDate.keys()]
      .sort()
  ) {

    for (
      const event
      of byDate.get(
        date
      )
    ) {

      const key =
        `${event.institution}||${event.address}`;


      if (
        event.ratio >=
        0.5
      ) {

        active.set(
          key,
          {

            name:
              event.institution,

            address:
              event.address,

            ratio:
              event.ratio
          }
        );

      }
      else {

        active.delete(
          key
        );
      }
    }


    const institutions =
      [...active.values()]
        .map(
          (
            {
              name,
              ratio
            }
          ) => ({

            name,

            ratio
          })
        )
        .sort(
          (
            a,
            b
          ) =>
            b.ratio -
            a.ratio
        );


    snapshots.push({

      date,

      publicShortRatio:
        round(
          institutions
            .reduce(
              (
                sum,
                item
              ) =>
                sum +
                item.ratio,
              0
            ),
          4
        ),

      publicShortInstitutions:
        institutions
    });


    asOfDate =
      date;
  }


  return {

    snapshots,

    state: {

      asOfDate,

      active:
        [...active.values()]
          .sort(
            (
              a,
              b
            ) =>
              b.ratio -
              a.ratio
          )
    },

    appliedEventCount:
      relevant.length
  };
}


/*
==============================================================
Merge / Coverage
==============================================================
*/

function dedupeRows(
  rows
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    if (
      !row?.date
    ) {

      continue;
    }


    map.set(
      row.date,
      {
        ...(
          map.get(
            row.date
          )
          ||
          {}
        ),

        ...row
      }
    );
  }


  return [...map.values()]
    .sort(
      (
        a,
        b
      ) =>
        a.date
          .localeCompare(
            b.date
          )
    );
}


function mergeRows(
  existingRows,
  sources
) {

  return dedupeRows(
    [
      ...(
        existingRows ||
        []
      ),

      ...sources.flat()
    ]
  );
}


function metricCoverage(
  rows,
  field,
  statusWhenPresent = "ok"
) {

  const filtered =
    rows.filter(
      r =>
        r[field] !==
        undefined
      &&
        r[field] !==
        null
    );


  const {
    startDate,
    endDate
  } =
    minMaxDates(
      filtered
    );


  return {

    status:
      filtered.length
      ?
        statusWhenPresent
      :
        "error",

    startDate,

    endDate,

    count:
      filtered.length
  };
}


function buildPublicShortCoverage(
  jpxResult,
  shortApplied,
  priorCoverage
) {

  if (
    !jpxResult
  ) {

    return (
      priorCoverage
      ||
      {
        status:
          "error",

        startDate:
          null,

        endDate:
          null,

        eventCount:
          0
      }
    );
  }


  const hadFailures =
    jpxResult.failedFiles >
      0
    ||
    jpxResult.pageFailures >
      0;


  const totalKnownEvents =
    (
      priorCoverage?.eventCount
      ||
      0
    )
    +
    shortApplied.appliedEventCount;


  let status;


  if (
    hadFailures
  ) {

    status =
      "partial";

  }
  else if (
    shortApplied.state
      .asOfDate
  ) {

    status =
      "ok";

  }
  else if (
    jpxResult.fullBackfill
  ) {

    status =
      "no_events_in_coverage";

  }
  else {

    status =
      priorCoverage?.status
      ||
      "unknown";
  }


  return {

    status,

    startDate:
      priorCoverage?.startDate
      ||
      jpxResult.coverageStartDate,

    endDate:
      jpxResult.coverageEndDate
      ||
      priorCoverage?.endDate
      ||
      null,

    stateAsOfDate:
      shortApplied.state
        .asOfDate
      ||
      priorCoverage?.stateAsOfDate
      ||
      null,

    eventCount:
      totalKnownEvents,

    filesScanned:
      jpxResult.processedFiles,

    failedFiles:
      jpxResult.failedFiles
      +
      jpxResult.pageFailures
  };
}


async function uploadSupply(
  data
) {

  const json =
    JSON.stringify(
      data
    );


  const gzip =
    gzipSync(
      Buffer.from(
        json,
        "utf8"
      ),
      {
        level:
          9
      }
    );


  await s3.send(
    new PutObjectCommand({

      Bucket:
        BUCKET,

      Key:
        R2_KEY,

      Body:
        gzip,

      ContentType:
        "application/json",

      ContentEncoding:
        "gzip",

      CacheControl:
        "no-cache"
    })
  );


  console.log(
    `[R2] uploaded ${R2_KEY}`
  );


  console.log(
    `[R2] JSON ${Buffer.byteLength(json).toLocaleString()} bytes / gzip ${gzip.length.toLocaleString()} bytes`
  );
}


/*
==============================================================
Main
==============================================================
*/

async function main() {

  console.log(
    "=========================================="
  );

  console.log(
    `Supply fetch start: ${CODE}`
  );

  console.log(
    "=========================================="
  );


  const existing =
    await loadExistingSupply();


  const existingRows =
    Array.isArray(
      existing?.rows
    )
    ?
      existing.rows
    :
      [];


  const existingLoanCount =
    existingRows.filter(
      r =>
        r.loanRatio !==
        undefined
      &&
        r.loanRatio !==
        null
    ).length;


  const needLoanBackfill =
    existingLoanCount <
    100;


  const priorShortCoverage =
    existing?.coverage
      ?.publicShort
    ||
    null;


  const haveCompletedShortBackfill =
    Boolean(
      priorShortCoverage
      &&
      [
        "ok",
        "partial",
        "no_events_in_coverage"
      ]
      .includes(
        priorShortCoverage.status
      )
    );


  const fullShortBackfill =
    !haveCompletedShortBackfill;


  console.log(
    `[PLAN] JSF historical backfill: ${needLoanBackfill ? "YES" : "NO"} (${existingLoanCount} existing rows)`
  );


  console.log(
    `[PLAN] JPX full archive scan: ${fullShortBackfill ? "YES" : "NO"}`
  );


  const tasks = [

    fetchJsfRecentDetail(),

    fetchJsfCurrentCsv(),

    fetchYahooMarginHistory(
      10
    ),

    fetchJpxShortHistory(
      fullShortBackfill
    ),

    needLoanBackfill
      ?
        fetchJsfHistoricalCsv(
          JSF_BACKFILL_YEARS
        )
      :
        Promise.resolve(
          []
        )
  ];


  const [
    recentResult,
    currentResult,
    marginResult,
    jpxResultSettled,
    historyResult
  ] =
    await Promise.allSettled(
      tasks
    );


  const jsfRecent =
    recentResult.status ===
      "fulfilled"
    ?
      recentResult.value
    :
      [];


  const jsfCurrent =
    currentResult.status ===
      "fulfilled"
    ?
      currentResult.value
    :
      [];


  const margin =
    marginResult.status ===
      "fulfilled"
    ?
      marginResult.value
    :
      [];


  const jsfHistory =
    historyResult.status ===
      "fulfilled"
    ?
      historyResult.value
    :
      [];


  const jpxResult =
    jpxResultSettled.status ===
      "fulfilled"
    ?
      jpxResultSettled.value
    :
      null;


  for (
    const [
      label,
      result
    ]
    of [

      [
        "JSF recent",
        recentResult
      ],

      [
        "JSF current",
        currentResult
      ],

      [
        "Yahoo margin",
        marginResult
      ],

      [
        "JPX short",
        jpxResultSettled
      ],

      [
        "JSF historical",
        historyResult
      ]
    ]
  ) {

    if (
      result.status ===
      "rejected"
    ) {

      console.warn(
        `[${label} ERROR] ${result.reason?.message ?? result.reason}`
      );
    }
  }


  const previousShortState =
    existing?.shortState
    ||
    null;


  const shortApplied =
    jpxResult
    ?
      applyShortEvents(
        jpxResult.events,
        previousShortState,
        !fullShortBackfill
      )
    :
      {
        snapshots:
          [],

        state:
          previousShortState
          ||
          {
            asOfDate:
              null,

            active:
              []
          },

        appliedEventCount:
          0
      };


  const rows =
    mergeRows(
      existingRows,
      [
        shortApplied.snapshots,
        jsfHistory,
        jsfRecent,
        jsfCurrent,
        margin
      ]
    );


  let loanCoverage =
    metricCoverage(
      rows,
      "loanRatio"
    );


  if (
    loanCoverage.count >
      0
    &&
    loanCoverage.count <
      100
  ) {

    loanCoverage.status =
      "partial";
  }


  if (
    needLoanBackfill
    &&
    historyResult.status ===
      "rejected"
    &&
    loanCoverage.count >
      0
  ) {

    loanCoverage.status =
      "partial";
  }


  const marginCoverage =
    metricCoverage(
      rows,
      "marginRatio"
    );


  const publicShortCoverage =
    buildPublicShortCoverage(
      jpxResult,
      shortApplied,
      priorShortCoverage
    );


  const output = {

    schemaVersion:
      2,

    code:
      CODE,

    updatedAt:
      new Date()
        .toISOString(),

    sources: {

      publicShort:
        "JPX public short position disclosures",

      loanRatio:
        "Japan Securities Finance (JSF)",

      marginRatio:
        "Yahoo! Finance margin-trading history"
    },

    notes: {

      publicShortRatio:
        "Sum of latest disclosed positions that remain at or above 0.5%. Zero is emitted only after an explicit state can be reconstructed; no event in the available archive is not treated as zero.",

      loanRatio:
        "Fund Loan Outstanding / Stock Loan Outstanding.",

      marginRatio:
        "Margin Buying Outstanding / Margin Selling Outstanding. Weekly values are forward-filled only in the browser for chart alignment."
    },

    coverage: {

      publicShort:
        publicShortCoverage,

      loanRatio:
        loanCoverage,

      marginRatio:
        marginCoverage
    },

    shortState:
      shortApplied.state,

    rows
  };


  console.log(
    "\n=== Coverage ==="
  );


  console.log(
    JSON.stringify(
      output.coverage,
      null,
      2
    )
  );


  console.log(
    "\n=== Latest rows ==="
  );


  console.log(
    rows.slice(
      -8
    )
  );


  await uploadSupply(
    output
  );


  console.log(
    "\nDONE"
  );
}


main()
  .catch(
    error => {

      console.error(
        "\nFATAL:",
        error
      );


      process.exit(
        1
      );
    }
  );
