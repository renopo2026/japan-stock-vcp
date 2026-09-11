import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import {
  chromium
} from "playwright";

import {
  gzipSync
} from "node:zlib";

/* ==========================================================================
 * 設定
 * ========================================================================== */

const BUCKET =
  process.env.R2_BUCKET_NAME;

const ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID;

const ENDPOINT =
  process.env.R2_ENDPOINT ||
  `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const YEARS =
  Math.max(
    1,
    Number(
      process.env.TOPIX_HISTORY_YEARS ||
      10
    )
  );

const SYMBOL =
  "998405.T";

const R2_KEY =
  "benchmark/TOPIX.json.gz";

/*
 * Yahoo!ファイナンスの時系列は
 * 1ページ20件。
 */
const PAGE_SIZE =
  20;

/*
 * 1年なら通常12～13ページ程度。
 * 念のため20ページを上限にする。
 */
const MAX_PAGES_PER_WINDOW =
  20;

/*
 * 1回に取得する期間。
 */
const WINDOW_MONTHS =
  12;

/*
 * 通常ページ遷移時の待機。
 */
const NORMAL_WAIT_MIN_MS =
  3000;

const NORMAL_WAIT_MAX_MS =
  6000;

/*
 * 年区間切替時。
 */
const WINDOW_WAIT_MIN_MS =
  5000;

const WINDOW_WAIT_MAX_MS =
  8000;

/*
 * Playwrightでページ取得失敗時の
 * 最大試行回数。
 */
const MAX_NAVIGATION_ATTEMPTS =
  4;

/*
 * ページ読み込みタイムアウト。
 */
const NAVIGATION_TIMEOUT_MS =
  60000;

/* ==========================================================================
 * 環境変数チェック
 * ========================================================================== */

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

/* ==========================================================================
 * R2
 * ========================================================================== */

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

/* ==========================================================================
 * 共通関数
 * ========================================================================== */

const sleep =
  ms =>
    new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );

async function randomWait(
  minMs,
  maxMs
) {
  const wait =
    Math.floor(
      Math.random() *
      (
        maxMs -
        minMs +
        1
      )
    ) +
    minMs;

  console.log(
    `[WAIT] ${(wait / 1000).toFixed(2)} sec`
  );

  await sleep(
    wait
  );
}

function pad2(
  value
) {
  return String(
    value
  ).padStart(
    2,
    "0"
  );
}

function toIsoDate(
  date
) {
  return [
    date.getUTCFullYear(),
    pad2(
      date.getUTCMonth() + 1
    ),
    pad2(
      date.getUTCDate()
    )
  ].join("-");
}

function toYahooDate(
  date
) {
  return [
    date.getUTCFullYear(),
    pad2(
      date.getUTCMonth() + 1
    ),
    pad2(
      date.getUTCDate()
    )
  ].join("");
}

function parseYahooDate(
  value
) {
  const text =
    String(
      value ?? ""
    )
      .replace(
        /\s+/g,
        ""
      )
      .trim();

  const match =
    text.match(
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
    );

  if (
    !match
  ) {
    return null;
  }

  return (
    `${match[1]}-` +
    `${pad2(match[2])}-` +
    `${pad2(match[3])}`
  );
}

function parseNumber(
  value
) {
  const text =
    String(
      value ?? ""
    )
      .replace(
        /,/g,
        ""
      )
      .replace(
        /−/g,
        "-"
      )
      .replace(
        /—/g,
        ""
      )
      .trim();

  if (
    !text ||
    text === "-" ||
    text === "---"
  ) {
    return null;
  }

  const number =
    Number(
      text
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function subtractMonths(
  date,
  months
) {
  const out =
    new Date(
      date
    );

  out.setUTCMonth(
    out.getUTCMonth() -
    months
  );

  return out;
}

function addDays(
  date,
  days
) {
  const out =
    new Date(
      date
    );

  out.setUTCDate(
    out.getUTCDate() +
    days
  );

  return out;
}

function dedupeRows(
  rows
) {
  const map =
    new Map();

  for (
    const row of rows
  ) {
    if (
      !row?.date
    ) {
      continue;
    }

    map.set(
      row.date,
      row
    );
  }

  return [
    ...map.values()
  ].sort(
    (
      a,
      b
    ) =>
      a.date.localeCompare(
        b.date
      )
  );
}

/* ==========================================================================
 * Yahoo URL
 * ========================================================================== */

function buildHistoryUrl(
  from,
  to,
  page = 1
) {
  const params =
    new URLSearchParams({
      from:
        toYahooDate(
          from
        ),

      to:
        toYahooDate(
          to
        ),

      timeFrame:
        "d",

      page:
        String(
          page
        )
    });

  return (
    `https://finance.yahoo.co.jp/quote/` +
    `${SYMBOL}/history?` +
    params.toString()
  );
}

/* ==========================================================================
 * Yahooページ判定
 * ========================================================================== */

async function detectBadPage(
  page
) {
  const bodyText =
    await page
      .locator(
        "body"
      )
      .innerText()
      .catch(
        () => ""
      );

  const lower =
    bodyText.toLowerCase();

  if (
    lower.includes(
      "internal server error"
    )
  ) {
    return {
      bad:
        true,

      reason:
        "Internal Server Error page"
    };
  }

  if (
    lower.includes(
      "this site requires javascript"
    )
  ) {
    return {
      bad:
        true,

      reason:
        "browser verification page"
    };
  }

  if (
    lower.includes(
      "enable javascript and cookies"
    )
  ) {
    return {
      bad:
        true,

      reason:
        "JavaScript/cookie verification page"
    };
  }

  return {
    bad:
      false,

    reason:
      null
  };
}

/* ==========================================================================
 * Playwrightページ遷移
 * ========================================================================== */

async function navigateWithRetry(
  page,
  url
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= MAX_NAVIGATION_ATTEMPTS;
    attempt++
  ) {
    try {
      console.log(
        `[BROWSER] ${url}`
      );

      const response =
        await page.goto(
          url,
          {
            waitUntil:
              "domcontentloaded",

            timeout:
              NAVIGATION_TIMEOUT_MS
          }
        );

      const status =
        response
          ? response.status()
          : null;

      console.log(
        `[BROWSER] HTTP ${status ?? "?"}`
      );

      if (
        status !== null &&
        status >= 400
      ) {
        throw new Error(
          `HTTP ${status}`
        );
      }

      /*
       * JavaScript描画を少し待つ。
       */
      await page.waitForTimeout(
        1500
      );

      const badPage =
        await detectBadPage(
          page
        );

      if (
        badPage.bad
      ) {
        throw new Error(
          badPage.reason
        );
      }

      return;
    } catch (
      error
    ) {
      lastError =
        error;

      console.warn(
        `[BROWSER] attempt ` +
        `${attempt}/${MAX_NAVIGATION_ATTEMPTS} ` +
        `failed: ` +
        `${error.message}`
      );

      if (
        attempt <
        MAX_NAVIGATION_ATTEMPTS
      ) {
        /*
         * 失敗時はかなり長めに待つ。
         *
         * 1回目 15～25秒
         * 2回目 30～50秒
         * 3回目 45～75秒
         */
        await randomWait(
          attempt * 15000,
          attempt * 25000
        );
      }
    }
  }

  throw lastError;
}

/* ==========================================================================
 * Yahoo時系列テーブルをDOMから読む
 * ========================================================================== */

async function parseHistoryTable(
  page
) {
  /*
   * Yahooページ内の全tableを調べる。
   */
  const tables =
    page.locator(
      "table"
    );

  const tableCount =
    await tables.count();

  const result =
    [];

  for (
    let tableIndex = 0;
    tableIndex < tableCount;
    tableIndex++
  ) {
    const table =
      tables.nth(
        tableIndex
      );

    const headerTexts =
      await table
        .locator(
          "thead th"
        )
        .allTextContents()
        .catch(
          () => []
        );

    let header =
      headerTexts.map(
        value =>
          String(
            value
          )
            .replace(
              /\s+/g,
              ""
            )
            .trim()
      );

    /*
     * theadがない場合に備えて、
     * 最初のtrも確認する。
     */
    if (
      !header.length
    ) {
      const firstRow =
        table
          .locator(
            "tr"
          )
          .first();

      const texts =
        await firstRow
          .locator(
            "th,td"
          )
          .allTextContents()
          .catch(
            () => []
          );

      header =
        texts.map(
          value =>
            String(
              value
            )
              .replace(
                /\s+/g,
                ""
              )
              .trim()
        );
    }

    const dateIndex =
      header.findIndex(
        value =>
          value.includes(
            "日付"
          )
      );

    const openIndex =
      header.findIndex(
        value =>
          value.includes(
            "始値"
          )
      );

    const highIndex =
      header.findIndex(
        value =>
          value.includes(
            "高値"
          )
      );

    const lowIndex =
      header.findIndex(
        value =>
          value.includes(
            "安値"
          )
      );

    const closeIndex =
      header.findIndex(
        value =>
          value.includes(
            "終値"
          )
      );

    if (
      dateIndex < 0 ||
      openIndex < 0 ||
      highIndex < 0 ||
      lowIndex < 0 ||
      closeIndex < 0
    ) {
      continue;
    }

    const bodyRows =
      table.locator(
        "tbody tr"
      );

    const rowCount =
      await bodyRows.count();

    for (
      let rowIndex = 0;
      rowIndex < rowCount;
      rowIndex++
    ) {
      const tr =
        bodyRows.nth(
          rowIndex
        );

      const cells =
        await tr
          .locator(
            "th,td"
          )
          .allTextContents();

      const date =
        parseYahooDate(
          cells[
            dateIndex
          ]
        );

      const open =
        parseNumber(
          cells[
            openIndex
          ]
        );

      const high =
        parseNumber(
          cells[
            highIndex
          ]
        );

      const low =
        parseNumber(
          cells[
            lowIndex
          ]
        );

      const close =
        parseNumber(
          cells[
            closeIndex
          ]
        );

      if (
        !date ||
        open === null ||
        high === null ||
        low === null ||
        close === null
      ) {
        continue;
      }

      result.push({
        date,
        open,
        high,
        low,
        close
      });
    }
  }

  return dedupeRows(
    result
  );
}

/* ==========================================================================
 * 1年間の取得
 * ========================================================================== */

async function fetchWindow(
  page,
  from,
  to
) {
  console.log(
    `\n==================================================`
  );

  console.log(
    `TOPIX ${toIsoDate(from)} .. ${toIsoDate(to)}`
  );

  console.log(
    `==================================================`
  );

  const all =
    [];

  let previousFingerprint =
    null;

  for (
    let pageNumber = 1;
    pageNumber <= MAX_PAGES_PER_WINDOW;
    pageNumber++
  ) {
    const url =
      buildHistoryUrl(
        from,
        to,
        pageNumber
      );

    await navigateWithRetry(
      page,
      url
    );

    const rows =
      await parseHistoryTable(
        page
      );

    if (
      !rows.length
    ) {
      console.log(
        `[TOPIX] page ${pageNumber}: ` +
        `0 rows -> stop`
      );

      break;
    }

    const fingerprint =
      rows
        .map(
          row =>
            row.date
        )
        .join("|");

    if (
      fingerprint ===
      previousFingerprint
    ) {
      console.log(
        `[TOPIX] page ${pageNumber}: ` +
        `duplicate page -> stop`
      );

      break;
    }

    previousFingerprint =
      fingerprint;

    all.push(
      ...rows
    );

    const dates =
      rows
        .map(
          row =>
            row.date
        )
        .sort();

    console.log(
      `[TOPIX] page ${pageNumber}: ` +
      `${rows.length} rows ` +
      `(${dates[0]}..` +
      `${dates[dates.length - 1]})`
    );

    if (
      rows.length <
      PAGE_SIZE
    ) {
      break;
    }

    /*
     * 次ページへ行く前に
     * 3～6秒ランダム待機。
     */
    await randomWait(
      NORMAL_WAIT_MIN_MS,
      NORMAL_WAIT_MAX_MS
    );
  }

  const rows =
    dedupeRows(
      all
    ).filter(
      row =>
        row.date >=
          toIsoDate(
            from
          ) &&
        row.date <=
          toIsoDate(
            to
          )
    );

  console.log(
    `[TOPIX] window result: ` +
    `${rows.length} rows`
  );

  return rows;
}

/* ==========================================================================
 * 10年バックフィル
 * ========================================================================== */

async function fetchTopixHistory(
  page
) {
  const now =
    new Date();

  const requestedStart =
    new Date(
      now
    );

  requestedStart.setUTCFullYear(
    requestedStart.getUTCFullYear() -
    YEARS
  );

  const all =
    [];

  let windowEnd =
    new Date(
      now
    );

  while (
    windowEnd >
    requestedStart
  ) {
    let windowStart =
      subtractMonths(
        windowEnd,
        WINDOW_MONTHS
      );

    if (
      windowStart <
      requestedStart
    ) {
      windowStart =
        new Date(
          requestedStart
        );
    }

    const rows =
      await fetchWindow(
        page,
        windowStart,
        windowEnd
      );

    /*
     * 1年で通常200営業日以上ある。
     * 極端に少なければ異常扱い。
     */
    if (
      rows.length <
      180
    ) {
      throw new Error(
        `TOPIX window returned too few rows: ` +
        `${toIsoDate(windowStart)}..` +
        `${toIsoDate(windowEnd)} ` +
        `rows=${rows.length}`
      );
    }

    all.push(
      ...rows
    );

    windowEnd =
      addDays(
        windowStart,
        -1
      );

    /*
     * 次の年区間へ移る前に
     * 5～8秒待機。
     */
    await randomWait(
      WINDOW_WAIT_MIN_MS,
      WINDOW_WAIT_MAX_MS
    );
  }

  const rows =
    dedupeRows(
      all
    );

  /*
   * 10年なら通常2,400営業日前後。
   *
   * 最低でも年200営業日は必要とする。
   */
  if (
    rows.length <
    YEARS * 200
  ) {
    throw new Error(
      `TOPIX row count is unexpectedly small: ` +
      `${rows.length}`
    );
  }

  /*
   * 最古日が要求開始日から
   * 20日以内にあることを確認。
   */
  const startTolerance =
    new Date(
      requestedStart
    );

  startTolerance.setUTCDate(
    startTolerance.getUTCDate() +
    20
  );

  if (
    rows[0].date >
    toIsoDate(
      startTolerance
    )
  ) {
    throw new Error(
      `TOPIX history did not reach requested start. ` +
      `first=${rows[0].date}, ` +
      `requested=${toIsoDate(requestedStart)}`
    );
  }

  return rows;
}

/* ==========================================================================
 * R2保存
 * ========================================================================== */

async function uploadTopix(
  rows
) {
  const output = {
    schemaVersion:
      1,

    code:
      "TOPIX",

    symbol:
      SYMBOL,

    name:
      "TOPIX",

    source:
      "Yahoo! Finance Japan via Playwright",

    updatedAt:
      new Date().toISOString(),

    requestedYears:
      YEARS,

    startDate:
      rows[0]?.date ??
      null,

    endDate:
      rows[
        rows.length - 1
      ]?.date ??
      null,

    rowCount:
      rows.length,

    data:
      rows
  };

  const json =
    JSON.stringify(
      output
    );

  const body =
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
        body,

      ContentType:
        "application/json; charset=utf-8",

      ContentEncoding:
        "gzip",

      CacheControl:
        "public, max-age=1800"
    })
  );

  console.log(
    `\n[R2] uploaded ` +
    `${R2_KEY}: ` +
    `${rows.length} rows ` +
    `(${output.startDate}..` +
    `${output.endDate})`
  );
}

/* ==========================================================================
 * main
 * ========================================================================== */

async function main() {
  console.log(
    `TOPIX source: ` +
    `Yahoo! Finance Japan ${SYMBOL}`
  );

  console.log(
    `Acquisition method: ` +
    `Playwright Chromium`
  );

  console.log(
    `History years: ` +
    `${YEARS}`
  );

  console.log(
    `Normal page wait: ` +
    `${NORMAL_WAIT_MIN_MS / 1000}-` +
    `${NORMAL_WAIT_MAX_MS / 1000} sec`
  );

  /*
   * Chromium起動。
   */
  const browser =
    await chromium.launch({
      headless:
        true,

      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

  /*
   * 同じcontextを10年間使う。
   *
   * Cookieやセッションを
   * 途中で捨てないことが重要。
   */
  const context =
    await browser.newContext({
      locale:
        "ja-JP",

      timezoneId:
        "Asia/Tokyo",

      userAgent:
        "Mozilla/5.0 " +
        "(Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 " +
        "(KHTML, like Gecko) " +
        "Chrome/152.0.0.0 Safari/537.36",

      viewport: {
        width:
          1440,

        height:
          1000
      },

      extraHTTPHeaders: {
        "Accept-Language":
          "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5"
      }
    });

  const page =
    await context.newPage();

  page.setDefaultTimeout(
    30000
  );

  page.setDefaultNavigationTimeout(
    NAVIGATION_TIMEOUT_MS
  );

  /*
   * console/debug用。
   */
  page.on(
    "console",
    message => {
      const type =
        message.type();

      if (
        type === "error" ||
        type === "warning"
      ) {
        console.log(
          `[PAGE ${type}] ` +
          message.text()
        );
      }
    }
  );

  try {
    /*
     * 最初にYahoo TOPIXトップへアクセスして
     * Cookie / セッションを作る。
     */
    const warmupUrl =
      `https://finance.yahoo.co.jp/quote/${SYMBOL}`;

    console.log(
      `\n[BROWSER] warmup`
    );

    await navigateWithRetry(
      page,
      warmupUrl
    );

    /*
     * 時系列取得開始前に待機。
     */
    await randomWait(
      5000,
      8000
    );

    const rows =
      await fetchTopixHistory(
        page
      );

    console.log(
      "\n=== TOPIX coverage ==="
    );

    console.log({
      rowCount:
        rows.length,

      startDate:
        rows[0]?.date,

      endDate:
        rows[
          rows.length - 1
        ]?.date
    });

    console.log(
      "\n=== Latest TOPIX rows ==="
    );

    console.log(
      rows.slice(
        -5
      )
    );

    console.log(
      "\n=== Oldest TOPIX rows ==="
    );

    console.log(
      rows.slice(
        0,
        5
      )
    );

    await uploadTopix(
      rows
    );

    console.log(
      "\nDONE"
    );
  } finally {
    await context
      .close()
      .catch(
        () => {}
      );

    await browser
      .close()
      .catch(
        () => {}
      );
  }
}

main().catch(
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
