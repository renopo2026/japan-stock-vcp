import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import * as cheerio from "cheerio";
import { gzipSync } from "node:zlib";

const BUCKET = process.env.R2_BUCKET_NAME;
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ENDPOINT =
  process.env.R2_ENDPOINT ||
  `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const YEARS = Math.max(
  1,
  Number(process.env.TOPIX_HISTORY_YEARS || 10)
);

const SYMBOL = "998405.T";
const R2_KEY = "benchmark/TOPIX.json.gz";
const PAGE_SIZE = 20;
const MAX_PAGES_PER_WINDOW = 20;
const WINDOW_MONTHS = 12;

if (
  !BUCKET ||
  !ACCOUNT_ID ||
  !process.env.R2_ACCESS_KEY_ID ||
  !process.env.R2_SECRET_ACCESS_KEY
) {
  throw new Error("R2 environment variables are missing");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED"
});

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/152 Safari/537.36",
  "Accept-Language":
    "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Cache-Control": "no-cache"
};

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toIsoDate(date) {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate())
  ].join("-");
}

function toYahooDate(date) {
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate())
  ].join("");
}

function parseYahooDate(value) {
  const text = String(value ?? "")
    .replace(/\s+/g, "")
    .trim();

  const match = text.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
  );

  if (!match) return null;

  return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
}

function parseNumber(value) {
  const text = String(value ?? "")
    .replace(/,/g, "")
    .replace(/−/g, "-")
    .trim();

  if (
    !text ||
    text === "-" ||
    text === "---" ||
    text === "—"
  ) {
    return null;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function subtractMonths(date, months) {
  const out = new Date(date);
  out.setUTCMonth(out.getUTCMonth() - months);
  return out;
}

function addDays(date, days) {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function buildHistoryUrl(from, to, page = 1) {
  const params = new URLSearchParams({
    from: toYahooDate(from),
    to: toYahooDate(to),
    timeFrame: "d",
    page: String(page)
  });

  return (
    `https://finance.yahoo.co.jp/quote/${SYMBOL}/history?` +
    params.toString()
  );
}

async function fetchText(url, attempts = 4) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {
    try {
      console.log(`[HTTP] ${url}`);

      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        redirect: "follow"
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      const text = await response.text();

      if (
        text.includes(
          "This site requires JavaScript to verify your browser"
        ) ||
        text.includes(
          "Enable JavaScript and cookies to continue"
        )
      ) {
        throw new Error(
          "Yahoo returned a browser-verification page"
        );
      }

      return text;
    } catch (error) {
      lastError = error;

      console.warn(
        `[HTTP] attempt ${attempt}/${attempts} failed: ` +
        `${error.message}`
      );

      if (attempt < attempts) {
        await sleep(attempt * 2500);
      }
    }
  }

  throw lastError;
}

function parseHistoryPage(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table").each((_, table) => {
    const header = [];

    $(table)
      .find("thead th")
      .each((__, th) => {
        header.push(
          $(th)
            .text()
            .replace(/\s+/g, "")
            .trim()
        );
      });

    if (!header.length) {
      const firstRow =
        $(table).find("tr").first();

      firstRow
        .find("th,td")
        .each((__, cell) => {
          header.push(
            $(cell)
              .text()
              .replace(/\s+/g, "")
              .trim()
          );
        });
    }

    const dateIndex =
      header.findIndex(value =>
        value.includes("日付")
      );

    const openIndex =
      header.findIndex(value =>
        value.includes("始値")
      );

    const highIndex =
      header.findIndex(value =>
        value.includes("高値")
      );

    const lowIndex =
      header.findIndex(value =>
        value.includes("安値")
      );

    const closeIndex =
      header.findIndex(value =>
        value.includes("終値")
      );

    if (
      dateIndex < 0 ||
      openIndex < 0 ||
      highIndex < 0 ||
      lowIndex < 0 ||
      closeIndex < 0
    ) {
      return;
    }

    $(table)
      .find("tbody tr")
      .each((__, tr) => {
        const cells = [];

        $(tr)
          .find("th,td")
          .each((___, cell) => {
            cells.push(
              $(cell)
                .text()
                .replace(/\s+/g, " ")
                .trim()
            );
          });

        const date =
          parseYahooDate(cells[dateIndex]);

        const open =
          parseNumber(cells[openIndex]);

        const high =
          parseNumber(cells[highIndex]);

        const low =
          parseNumber(cells[lowIndex]);

        const close =
          parseNumber(cells[closeIndex]);

        if (
          !date ||
          open === null ||
          high === null ||
          low === null ||
          close === null
        ) {
          return;
        }

        rows.push({
          date,
          open,
          high,
          low,
          close
        });
      });
  });

  return rows;
}

function dedupeRows(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!row?.date) continue;
    map.set(row.date, row);
  }

  return [...map.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date)
  );
}

async function fetchWindow(from, to) {
  const all = [];
  let previousFingerprint = null;

  console.log(
    `\n=== TOPIX ${toIsoDate(from)} .. ${toIsoDate(to)} ===`
  );

  for (
    let page = 1;
    page <= MAX_PAGES_PER_WINDOW;
    page++
  ) {
    const url =
      buildHistoryUrl(from, to, page);

    const html =
      await fetchText(url);

    const rows =
      parseHistoryPage(html);

    if (!rows.length) {
      console.log(
        `[TOPIX] page ${page}: 0 rows -> stop`
      );

      break;
    }

    const fingerprint =
      rows
        .map(row => row.date)
        .join("|");

    if (
      fingerprint ===
      previousFingerprint
    ) {
      console.log(
        `[TOPIX] page ${page}: duplicate page -> stop`
      );

      break;
    }

    previousFingerprint =
      fingerprint;

    all.push(...rows);

    console.log(
      `[TOPIX] page ${page}: ${rows.length} rows ` +
      `(${rows[rows.length - 1].date}..${rows[0].date})`
    );

    if (rows.length < PAGE_SIZE) {
      break;
    }

    await sleep(700);
  }

  return dedupeRows(all).filter(
    row =>
      row.date >= toIsoDate(from) &&
      row.date <= toIsoDate(to)
  );
}

async function fetchTopixHistory() {
  const now = new Date();

  const requestedStart =
    new Date(now);

  requestedStart.setUTCFullYear(
    requestedStart.getUTCFullYear() -
      YEARS
  );

  const all = [];

  let windowEnd = now;

  while (
    windowEnd > requestedStart
  ) {
    let windowStart =
      subtractMonths(
        windowEnd,
        WINDOW_MONTHS
      );

    if (
      windowStart < requestedStart
    ) {
      windowStart =
        requestedStart;
    }

    const rows =
      await fetchWindow(
        windowStart,
        windowEnd
      );

    all.push(...rows);

    console.log(
      `[TOPIX] window result: ${rows.length} rows`
    );

    windowEnd =
      addDays(windowStart, -1);

    await sleep(1000);
  }

  const rows =
    dedupeRows(all);

  if (
    rows.length < YEARS * 200
  ) {
    throw new Error(
      `TOPIX row count is unexpectedly small: ${rows.length}`
    );
  }

  const startTolerance =
    new Date(requestedStart);

  startTolerance.setUTCDate(
    startTolerance.getUTCDate() + 20
  );

  if (
    rows[0].date >
    toIsoDate(startTolerance)
  ) {
    throw new Error(
      `TOPIX history did not reach requested start. ` +
      `first=${rows[0].date}, ` +
      `requested=${toIsoDate(requestedStart)}`
    );
  }

  return rows;
}

async function uploadTopix(rows) {
  const output = {
    schemaVersion: 1,
    code: "TOPIX",
    symbol: SYMBOL,
    name: "TOPIX",
    source:
      "Yahoo! Finance Japan",
    updatedAt:
      new Date().toISOString(),
    requestedYears: YEARS,
    startDate:
      rows[0]?.date ?? null,
    endDate:
      rows[rows.length - 1]?.date ?? null,
    rowCount:
      rows.length,
    data:
      rows
  };

  const body =
    gzipSync(
      Buffer.from(
        JSON.stringify(output),
        "utf8"
      ),
      {
        level: 9
      }
    );

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: R2_KEY,
      Body: body,
      ContentType:
        "application/json; charset=utf-8",
      ContentEncoding:
        "gzip",
      CacheControl:
        "public, max-age=1800"
    })
  );

  console.log(
    `\n[R2] uploaded ${R2_KEY}: ` +
    `${rows.length} rows ` +
    `(${output.startDate}..${output.endDate})`
  );
}

async function main() {
  console.log(
    `TOPIX source: Yahoo! Finance Japan ${SYMBOL}`
  );

  console.log(
    `History years: ${YEARS}`
  );

  const rows =
    await fetchTopixHistory();

  console.log(
    "\n=== TOPIX coverage ==="
  );

  console.log({
    rowCount:
      rows.length,
    startDate:
      rows[0]?.date,
    endDate:
      rows[rows.length - 1]?.date
  });

  console.log(
    "\n=== Latest TOPIX rows ==="
  );

  console.log(
    rows.slice(-5)
  );

  await uploadTopix(rows);

  console.log("\nDONE");
}

main().catch(error => {
  console.error(
    "\nFATAL:",
    error
  );

  process.exit(1);
});
