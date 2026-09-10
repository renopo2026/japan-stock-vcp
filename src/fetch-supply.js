import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import * as XLSX from "xlsx";

import {
  gzipSync,
  gunzipSync
} from "node:zlib";


/*
==============================================================
設定
==============================================================
*/

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


/*
==============================================================
R2
==============================================================
*/

const s3 =
  new S3Client({

    region:
      "auto",

    endpoint:
      ENDPOINT,

    credentials: {

      accessKeyId:
        process.env
          .R2_ACCESS_KEY_ID,

      secretAccessKey:
        process.env
          .R2_SECRET_ACCESS_KEY
    },

    requestChecksumCalculation:
      "WHEN_REQUIRED",

    responseChecksumValidation:
      "WHEN_REQUIRED"
  });


const R2_KEY =
  `supply/${CODE}.json.gz`;


/*
==============================================================
HTTP
==============================================================
*/

const DEFAULT_HEADERS = {

  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 Chrome/152 Safari/537.36",

  "Accept-Language":
    "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5"
};


function sleep(
  ms
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
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
        `[HTTP] attempt ${attempt}/${attempts} failed:`,
        error.message
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

  const response =
    await fetchResponse(
      url
    );


  return await response.text();
}


async function fetchBuffer(
  url
) {

  const response =
    await fetchResponse(
      url
    );


  return Buffer.from(
    await response.arrayBuffer()
  );
}


/*
==============================================================
Utility
==============================================================
*/

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


  /*
    JPX資料によっては
    旧来コードを5桁表示する場合がある。
    例：99840 → 9984
  */

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


  let match =
    text.match(
      /(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/
    );


  if (
    match
  ) {

    return (
      `${match[1]}-` +
      `${String(match[2]).padStart(2, "0")}-` +
      `${String(match[3]).padStart(2, "0")}`
    );
  }


  match =
    text.match(
      /^(\d{4})(\d{2})(\d{2})$/
    );


  if (
    match
  ) {

    return (
      `${match[1]}-` +
      `${match[2]}-` +
      `${match[3]}`
    );
  }


  return null;
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


/*
==============================================================
R2既存データ読込
==============================================================
*/

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


    const json =
      gunzipSync(
        bytes
      )
      .toString(
        "utf8"
      );


    const parsed =
      JSON.parse(
        json
      );


    console.log(
      `[R2] existing ${R2_KEY}: ` +
      `${parsed.rows?.length ?? 0} rows`
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
      "[R2] existing data could not be loaded:",
      error.message
    );


    return null;
  }
}


/*
==============================================================
簡易CSV parser
==============================================================
*/

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
        quoted &&
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


/*
==============================================================
日証金：
銘柄別残高一覧 zandaka.csv

A 申込日
C コード
E 市場
G 速報/確報

J 融資残高（株）
M 貸株残高（株）

貸借倍率 = J / M
==============================================================
*/

async function fetchJsfCurrentCsv() {

  console.log(
    "\n=== JSF zandaka.csv ==="
  );


  const buffer =
    await fetchBuffer(
      "https://www.taisyaku.jp/data/zandaka.csv"
    );


  /*
    日証金CSVは日本語Windows系文字コードを
    考慮してCP932でdecode
  */

  const text =
    iconv.decode(
      buffer,
      "cp932"
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


    const code =
      normalizeCode(
        row[2]
      );


    if (
      code !==
      CODE
    ) {

      continue;
    }


    const market =
      cleanText(
        row[4]
      );


    if (
      !market.includes(
        "東証"
      )
    ) {

      continue;
    }


    const date =
      normalizeDate(
        row[0]
      );


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


    if (
      !date
    ) {

      continue;
    }


    candidates.push({

      date,

      status,

      loanBalance,

      stockLoanBalance,

      loanRatio:
        (
          stockLoanBalance !==
            null
          &&
          stockLoanBalance >
            0
          &&
          loanBalance !==
            null
        )
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


  /*
    同一銘柄について速報と確報があれば
    確報を優先
  */

  candidates.sort(
    (a, b) => {

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
      ) {

        return -1;
      }


      return 1;
    }
  );


  if (
    !candidates.length
  ) {

    console.warn(
      `[JSF] ${CODE} not found`
    );


    return [];
  }


  console.log(
    "[JSF] latest:",
    candidates[0]
  );


  return [
    candidates[0]
  ];
}


/*
==============================================================
HTML Tableのrowspan / colspan展開
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
    .find("tr")
    .each(
      (_, tr) => {

        const row =
          [];


        let col =
          0;


        const placePending =
          () => {

            while (
              spans[col]
              &&
              spans[col]
                .remaining >
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
            (_, cell) => {

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
日証金：
銘柄詳細ページから直近7営業日前後を取得

初回のチャートが1点だけにならないよう
直近データをseedする。
==============================================================
*/

async function fetchJsfRecentDetail() {

  console.log(
    "\n=== JSF detail page ==="
  );


  const url =
    `https://www.taisyaku.jp/app/stock/detail/${CODE}-01`;


  const html =
    await fetchText(
      url
    );


  const $ =
    cheerio.load(
      html
    );


  let bestGrid =
    null;


  $("table")
    .each(
      (_, table) => {

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

    console.warn(
      "[JSF] detail table not found"
    );


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
          item =>
            item.date
        );


    break;
  }


  if (
    !dateColumns.length
  ) {

    console.warn(
      "[JSF] dates not found"
    );


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
        value =>
          cleanText(
            value
          ) ===
          "融資"
      )
    ) {

      section =
        "fund";
    }


    if (
      row.some(
        value =>
          cleanText(
            value
          ) ===
          "貸株"
      )
    ) {

      section =
        "stock";
    }


    const isBalanceRow =
      row.some(
        value =>
          cleanText(
            value
          ) ===
          "残高"
      );


    if (
      !isBalanceRow
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
        row =>
          row.loanBalance !==
            undefined
          &&
          row.stockLoanBalance !==
            undefined
      )
      .map(
        row => ({

          ...row,

          loanRatio:
            row.stockLoanBalance >
            0
            ?
              round(
                row.loanBalance /
                row.stockLoanBalance,
                6
              )
            :
              null
        })
      )
      .sort(
        (a, b) =>
          a.date
            .localeCompare(
              b.date
            )
      );


  console.log(
    `[JSF] detail history: ${result.length} rows`
  );


  return result;
}


/*
==============================================================
Yahoo!ファイナンス：
信用倍率

週次信用残

売残・買残・信用倍率を取得する。

このアプリは個人利用前提。
データ自体はR2を公開しない。
==============================================================
*/

async function fetchYahooMarginHistory(
  years = 10
) {

  console.log(
    "\n=== Yahoo margin history ==="
  );


  const cutoffDate =
    new Date();


  cutoffDate.setFullYear(
    cutoffDate.getFullYear() -
    years
  );


  const cutoff =
    (
      `${cutoffDate.getFullYear()}-` +
      `${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-` +
      `${String(cutoffDate.getDate()).padStart(2, "0")}`
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
        "[Yahoo margin] stopped:",
        error.message
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
        (_, table) => {

          const headers =
            $(table)
              .find("th")
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
            .find("tbody tr")
            .each(
              (_, tr) => {

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


                /*
                  表示倍率が無い場合は
                  買残 / 売残から計算
                */

                if (
                  marginRatio ===
                    null
                  &&
                  marginSell !==
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

      console.warn(
        `[Yahoo margin] table not found on page ${page}`
      );


      break;
    }


    if (
      firstDate
    ) {

      if (
        seenPages.has(
          firstDate
        )
      ) {

        /*
          page parameterが無視された場合の
          infinite loop防止
        */

        break;
      }


      seenPages.add(
        firstDate
      );
    }


    console.log(
      `[Yahoo margin] page ${page}, ` +
      `${firstDate ?? "?"} -> ${oldestDate ?? "?"}`
    );


    if (
      oldestDate
      &&
      oldestDate <
      cutoff
    ) {

      break;
    }


    /*
      次へリンクがHTMLにある場合は
      それを優先。
    */

    let nextHref =
      null;


    $("a")
      .each(
        (
          _,
          anchor
        ) => {

          const text =
            cleanText(
              $(anchor)
                .text()
            );


          if (
            text ===
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

      /*
        fallback
      */

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
        (a, b) =>
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
JPX空売り：
ページからExcel URL取得
==============================================================
*/

function datesFromPageText(
  text
) {

  const matches =
    [
      ...text.matchAll(
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/g
      )
    ];


  return matches
    .map(
      match =>
        (
          `${match[1]}-` +
          `${String(match[2]).padStart(2, "0")}-` +
          `${String(match[3]).padStart(2, "0")}`
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
      (_, tr) => {

        const rowText =
          cleanText(
            $(tr)
              .text()
          );


        const date =
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

                  publicationDate:
                    date
                });
              }
            }
          );
      }
    );


  /*
    archiveページ候補
  */

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


/*
==============================================================
JPX空売りExcelセル
==============================================================
*/

function sheetCell(
  sheet,
  row,
  column
) {

  return sheet[
    XLSX.utils
      .encode_cell({

        r:
          row,

        c:
          column
      })
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


  if (
    !cell
  ) {

    return "";
  }


  return cleanText(
    cell.w ??
    cell.v ??
    ""
  );
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


    /*
      Excel percent
      0.0051 -> 0.51%
    */

    if (
      format.includes(
        "%"
      )
      ||
      display.includes(
        "%"
      )
    ) {

      return round(
        cell.v *
        100,
        6
      );
    }


    return round(
      cell.v,
      6
    );
  }


  const text =
    cleanText(
      cell.v
    );


  const n =
    parseNumber(
      text
    );


  if (
    n === null
  ) {

    return null;
  }


  return n;
}


/*
==============================================================
JPX空売りExcel解析

必要な列をヘッダー文字から自動判定する。
==============================================================
*/

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
        range.s.r + 20
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
          " " +
          sheetCellText(
            sheet,
            r,
            c
          );
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
        columnText[c] ||
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

      const code =
        normalizeCode(
          sheetCellText(
            sheet,
            r,
            codeCol
          )
        );


      if (
        code !==
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


      const calcDate =
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
        !calcDate
        ||
        ratio ===
          null
      ) {

        continue;
      }


      const institution =
        holderCol !==
          null
        ?
          sheetCellText(
            sheet,
            r,
            holderCol
          )
        :
          "Unknown";


      const address =
        addressCol !==
          null
        ?
          sheetCellText(
            sheet,
            r,
            addressCol
          )
        :
          "";


      events.push({

        calculationDate:
          calcDate,

        publicationDate:
          publicationDate ||
          calcDate,

        institution:
          institution ||
          "Unknown",

        address,

        ratio,

        source:
          fileUrl
      });
    }
  }


  return events;
}


/*
==============================================================
JPX公表空売りを取得

初回：
過去約13か月をbackfill

2回目以降：
現在ページのみ
==============================================================
*/

async function fetchJpxShortHistory(
  needBackfill
) {

  console.log(
    "\n=== JPX public short positions ==="
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


  if (
    needBackfill
  ) {

    const cutoffDate =
      new Date();


    cutoffDate.setMonth(
      cutoffDate.getMonth() -
      13
    );


    const cutoff =
      (
        `${cutoffDate.getFullYear()}-` +
        `${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-` +
        `${String(cutoffDate.getDate()).padStart(2, "0")}`
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


        const pageDates =
          datesFromPageText(
            page.html
          );


        if (
          pageDates.length
          &&
          Math.max(
            ...pageDates.map(
              date =>
                new Date(
                  `${date}T00:00:00Z`
                ).getTime()
            )
          )
          <
          new Date(
            `${cutoff}T00:00:00Z`
          )
          .getTime()
        ) {

          continue;
        }


        files.push(
          ...page.files
        );


        await sleep(
          150
        );

      }
      catch (
        error
      ) {

        console.warn(
          `[JPX] archive skipped ${archiveUrl}:`,
          error.message
        );
      }
    }
  }


  /*
    URL重複除去
  */

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


  for (
    let i = 0;
    i < files.length;
    i++
  ) {

    const file =
      files[i];


    try {

      const buffer =
        await fetchBuffer(
          file.url
        );


      const parsed =
        parseJpxShortWorkbook(
          buffer,
          file.publicationDate,
          file.url
        );


      if (
        parsed.length
      ) {

        console.log(
          `[JPX] ${file.publicationDate ?? "?"}: ` +
          `${parsed.length} ${CODE} records`
        );


        events.push(
          ...parsed
        );
      }

    }
    catch (
      error
    ) {

      console.warn(
        `[JPX] file skipped: ${file.url}`,
        error.message
      );
    }


    if (
      i <
      files.length - 1
    ) {

      await sleep(
        150
      );
    }
  }


  return events;
}


/*
==============================================================
空売りイベント → 状態系列

機関ごとの最新報告を保持。

最新残高割合 >= 0.5%
だけを公表残高合計へ算入。

0.5%未満への変更報告が来たら
activeから外す。
==============================================================
*/

function buildShortSnapshots(
  events
) {

  const sorted =
    [...events]
      .sort(
        (
          a,
          b
        ) => {

          const dateCompare =
            a.calculationDate
              .localeCompare(
                b.calculationDate
              );


          if (
            dateCompare !==
            0
          ) {

            return dateCompare;
          }


          return (
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
    of sorted
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


  const active =
    new Map();


  const snapshots =
    [];


  const dates =
    [...byDate.keys()]
      .sort();


  for (
    const date
    of dates
  ) {

    for (
      const event
      of byDate.get(
        date
      )
    ) {

      const key =
        (
          `${event.institution}` +
          `||${event.address}`
        );


      if (
        event.ratio >=
        0.5
      ) {

        active.set(
          key,
          {

            name:
              event.institution,

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
        .sort(
          (
            a,
            b
          ) =>
            b.ratio -
            a.ratio
        );


    const total =
      institutions.reduce(
        (
          sum,
          item
        ) =>
          sum +
          item.ratio,
        0
      );


    snapshots.push({

      date,

      publicShortRatio:
        round(
          total,
          4
        ),

      publicShortInstitutions:
        institutions
    });
  }


  console.log(
    `[JPX] snapshots: ${snapshots.length}`
  );


  return snapshots;
}


/*
==============================================================
Row Merge
==============================================================
*/

function mergeRows(
  existingRows,
  sources
) {

  const map =
    new Map();


  for (
    const row
    of existingRows ||
    []
  ) {

    if (
      !row.date
    ) {

      continue;
    }


    map.set(
      row.date,
      {
        ...row
      }
    );
  }


  for (
    const rows
    of sources
  ) {

    for (
      const row
      of rows
    ) {

      if (
        !row.date
      ) {

        continue;
      }


      const current =
        map.get(
          row.date
        )
        ||
        {
          date:
            row.date
        };


      map.set(
        row.date,
        {
          ...current,
          ...row
        }
      );
    }
  }


  return [...map.values()]
    .sort(
      (a, b) =>
        a.date
          .localeCompare(
            b.date
        )
    );
}


/*
==============================================================
Upload
==============================================================
*/

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
    `[R2] JSON ${Buffer.byteLength(json).toLocaleString()} bytes`
  );


  console.log(
    `[R2] gzip ${gzip.length.toLocaleString()} bytes`
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


  /*
    公表空売り履歴が無ければ
    初回backfill
  */

  const hasShortHistory =
    existingRows.some(
      row =>
        row.publicShortRatio !==
        undefined
    );


  const [
    jsfRecentResult,
    jsfCurrentResult,
    marginResult,
    shortEventsResult
  ] =
    await Promise.allSettled([

      fetchJsfRecentDetail(),

      fetchJsfCurrentCsv(),

      fetchYahooMarginHistory(
        10
      ),

      fetchJpxShortHistory(
        !hasShortHistory
      )
    ]);


  const jsfRecent =
    jsfRecentResult.status ===
      "fulfilled"
    ?
      jsfRecentResult.value
    :
      [];


  const jsfCurrent =
    jsfCurrentResult.status ===
      "fulfilled"
    ?
      jsfCurrentResult.value
    :
      [];


  const margin =
    marginResult.status ===
      "fulfilled"
    ?
      marginResult.value
    :
      [];


  const shortEvents =
    shortEventsResult.status ===
      "fulfilled"
    ?
      shortEventsResult.value
    :
      [];


  if (
    jsfRecentResult.status ===
    "rejected"
  ) {

    console.warn(
      "[JSF detail error]",
      jsfRecentResult.reason
        ?.message
    );
  }


  if (
    jsfCurrentResult.status ===
    "rejected"
  ) {

    console.warn(
      "[JSF CSV error]",
      jsfCurrentResult.reason
        ?.message
    );
  }


  if (
    marginResult.status ===
    "rejected"
  ) {

    console.warn(
      "[Margin error]",
      marginResult.reason
        ?.message
    );
  }


  if (
    shortEventsResult.status ===
    "rejected"
  ) {

    console.warn(
      "[JPX short error]",
      shortEventsResult.reason
        ?.message
    );
  }


  const shortSnapshots =
    buildShortSnapshots(
      shortEvents
    );


  const rows =
    mergeRows(

      existingRows,

      [
        shortSnapshots,
        jsfRecent,
        jsfCurrent,
        margin
      ]
    );


  const output = {

    schemaVersion:
      1,

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
        "Sum of latest disclosed positions that remain at or above 0.5%.",

      loanRatio:
        "Fund Loan Outstanding / Stock Loan Outstanding.",

      marginRatio:
        "Margin Buying Outstanding / Margin Selling Outstanding."
    },

    rows
  };


  console.log(
    "\n=== Result ==="
  );


  console.log(
    `rows: ${rows.length}`
  );


  if (
    rows.length
  ) {

    console.log(
      "latest:",
      rows[
        rows.length - 1
      ]
    );
  }


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
