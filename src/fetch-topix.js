import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";
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

const R2_KEY = "benchmark/TOPIX.json.gz";
const STOOQ_SYMBOL = "^tpx";

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

function yyyymmdd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function parseNumber(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim());

  if (lines.length < 2) {
    throw new Error("Stooq returned no TOPIX rows");
  }

  const header = lines[0]
    .split(",")
    .map(v => v.trim().toLowerCase());

  const indexOf = name => header.indexOf(name.toLowerCase());

  const iDate = indexOf("date");
  const iOpen = indexOf("open");
  const iHigh = indexOf("high");
  const iLow = indexOf("low");
  const iClose = indexOf("close");
  const iVolume = indexOf("volume");

  if (
    iDate < 0 ||
    iOpen < 0 ||
    iHigh < 0 ||
    iLow < 0 ||
    iClose < 0
  ) {
    throw new Error(
      `Unexpected Stooq CSV header: ${lines[0]}`
    );
  }

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = isoDate(cols[iDate]);
    const open = parseNumber(cols[iOpen]);
    const high = parseNumber(cols[iHigh]);
    const low = parseNumber(cols[iLow]);
    const close = parseNumber(cols[iClose]);
    const volume =
      iVolume >= 0 ? parseNumber(cols[iVolume]) : null;

    if (
      !date ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }

    rows.push({
      date,
      open,
      high,
      low,
      close,
      volume
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  const deduped = [];
  for (const row of rows) {
    if (
      deduped.length &&
      deduped[deduped.length - 1].date === row.date
    ) {
      deduped[deduped.length - 1] = row;
    } else {
      deduped.push(row);
    }
  }

  if (deduped.length < 200) {
    throw new Error(
      `TOPIX row count is unexpectedly small: ${deduped.length}`
    );
  }

  return deduped;
}

async function fetchTopix() {
  const end = new Date();
  const start = new Date(end);

  start.setUTCFullYear(start.getUTCFullYear() - YEARS);
  start.setUTCDate(start.getUTCDate() - 14);

  const url =
    "https://stooq.com/q/d/l/" +
    `?s=${encodeURIComponent(STOOQ_SYMBOL)}` +
    `&d1=${yyyymmdd(start)}` +
    `&d2=${yyyymmdd(end)}` +
    "&i=d";

  console.log(`[TOPIX] fetching ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 Chrome/152 Safari/537.36",
      "Accept-Language":
        "ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.5"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(
      `Stooq TOPIX HTTP ${response.status} ${response.statusText}`
    );
  }

  const text = await response.text();

  return parseCsv(text);
}

async function uploadTopix(rows) {
  const output = {
    schemaVersion: 1,
    code: "TOPIX",
    symbol: "^TPX",
    name: "TOPIX",
    source: "Stooq",
    updatedAt: new Date().toISOString(),
    startDate: rows[0]?.date ?? null,
    endDate: rows[rows.length - 1]?.date ?? null,
    rowCount: rows.length,
    data: rows
  };

  const body = gzipSync(
    Buffer.from(JSON.stringify(output), "utf8"),
    { level: 9 }
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: R2_KEY,
      Body: body,
      ContentType: "application/json; charset=utf-8",
      ContentEncoding: "gzip",
      CacheControl: "public, max-age=1800"
    })
  );

  console.log(
    `[R2] uploaded ${R2_KEY}: ` +
    `${rows.length} rows ` +
    `(${output.startDate}..${output.endDate})`
  );
}

async function main() {
  const rows = await fetchTopix();

  await uploadTopix(rows);

  console.log("DONE");
}

main().catch(error => {
  console.error("FATAL:", error);
  process.exit(1);
});
