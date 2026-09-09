import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import { gzipSync } from "node:zlib";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME
} = process.env;

// ------------------------------
// 基本設定
// ------------------------------

const CODE = process.env.STOCK_CODE || "7203";
const SYMBOL = `${CODE}.T`;
const YEARS = 10;

// ------------------------------
// 環境変数確認
// ------------------------------

for (const [name, value] of Object.entries({
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME
})) {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
}

// ------------------------------
// R2
// ------------------------------

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,

  // R2との互換性を優先
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",

  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: R2_SECRET_ACCESS_KEY.trim()
  }
});

// ------------------------------
// Yahoo Finance取得
// ------------------------------

async function fetchWithRetry(url, retries = 4) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/537.36 Chrome/152 Safari/537.36",
          "Accept": "application/json,text/plain,*/*"
        }
      });

      if (response.ok) {
        return response;
      }

      lastError = new Error(
        `Yahoo Finance HTTP ${response.status} ${response.statusText}`
      );

      if (![429, 500, 502, 503, 504].includes(response.status)) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) {
      const waitMs = 2000 * attempt;
      console.log(`Retry ${attempt}/${retries} after ${waitMs} ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}

async function fetchYahoo(symbol) {
  const now = Math.floor(Date.now() / 1000);

  const tenYearsAgo = new Date();
  tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - YEARS);

  // 移動平均・VCP計算の余裕を確保
  tenYearsAgo.setUTCMonth(tenYearsAgo.getUTCMonth() - 4);

  const period1 = Math.floor(tenYearsAgo.getTime() / 1000);
  const period2 = now + 86400;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(symbol)}` +
    `?period1=${period1}` +
    `&period2=${period2}` +
    `&interval=1d` +
    `&events=splits` +
    `&includeAdjustedClose=true`;

  console.log(`Fetching Yahoo Finance: ${symbol}`);

  const response = await fetchWithRetry(url);
  const json = await response.json();

  if (json.chart?.error) {
    throw new Error(
      `Yahoo error: ${JSON.stringify(json.chart.error)}`
    );
  }

  const result = json.chart?.result?.[0];

  if (!result) {
    throw new Error("Yahoo Finance returned no chart result");
  }

  return result;
}

// ------------------------------
// 日付変換
// ------------------------------

function toTokyoDate(timestamp) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp * 1000));
}

// ------------------------------
// 株式分割
// ------------------------------

function parseSplitRatio(split) {
  if (
    Number.isFinite(split?.numerator) &&
    Number.isFinite(split?.denominator) &&
    split.denominator !== 0
  ) {
    return split.numerator / split.denominator;
  }

  if (typeof split?.splitRatio === "string") {
    const parts = split.splitRatio.split(":");

    if (parts.length === 2) {
      const numerator = Number(parts[0]);
      const denominator = Number(parts[1]);

      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        denominator !== 0
      ) {
        return numerator / denominator;
      }
    }
  }

  return 1;
}

function getSplits(result) {
  const source = result.events?.splits ?? {};

  return Object.values(source)
    .map(split => ({
      timestamp: Number(split.date),
      date: toTokyoDate(Number(split.date)),
      ratio: parseSplitRatio(split),
      splitRatio: split.splitRatio ?? null
    }))
    .filter(
      split =>
        Number.isFinite(split.timestamp) &&
        Number.isFinite(split.ratio) &&
        split.ratio > 0
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ------------------------------
// 分割調整
// 配当調整は行わない
// ------------------------------

function splitAdjustmentFactor(timestamp, splits) {
  let factor = 1;

  for (const split of splits) {
    if (split.timestamp > timestamp) {
      factor *= split.ratio;
    }
  }

  return factor;
}

// ------------------------------
// 単純移動平均
// ------------------------------

function average(values) {
  if (!values.length) return null;

  const valid = values.filter(Number.isFinite);

  if (valid.length !== values.length) return null;

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function rollingAverage(rows, index, field, period) {
  if (index < period - 1) return null;

  const values = rows
    .slice(index - period + 1, index + 1)
    .map(row => row[field]);

  return average(values);
}

// ------------------------------
// Percentile.INC相当
// ------------------------------

function percentileInc(values, p) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return null;

  if (sorted.length === 1) return sorted[0];

  const rank = p * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = rank - lower;

  return (
    sorted[lower] * (1 - weight) +
    sorted[upper] * weight
  );
}

// ------------------------------
// Yahooデータ → 調整済み日足
// ------------------------------

function buildRows(result) {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];

  if (!quote) {
    throw new Error("Yahoo quote data is missing");
  }

  const splits = getSplits(result);

  console.log(`Split events: ${splits.length}`);

  const rows = [];

  for (let i = 0; i < timestamps.length; i++) {
    const timestamp = timestamps[i];

    const rawOpen = quote.open?.[i];
    const rawHigh = quote.high?.[i];
    const rawLow = quote.low?.[i];
    const rawClose = quote.close?.[i];
    const rawVolume = quote.volume?.[i];

    // 休場日・欠損値除外
    if (
      !Number.isFinite(rawOpen) ||
      !Number.isFinite(rawHigh) ||
      !Number.isFinite(rawLow) ||
      !Number.isFinite(rawClose) ||
      !Number.isFinite(rawVolume)
    ) {
      continue;
    }

    const factor = splitAdjustmentFactor(timestamp, splits);

    rows.push({
      timestamp,
      date: toTokyoDate(timestamp),

      // 分割調整後OHLC
      open: rawOpen / factor,
      high: rawHigh / factor,
      low: rawLow / factor,
      close: rawClose / factor,

      // 分割調整後出来高
      volume: Math.round(rawVolume * factor),

      splitAdjustmentFactor: factor
    });
  }

  return {
    rows,
    splits
  };
}

// ------------------------------
// 指標計算
// ------------------------------

function calculateIndicators(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    row.ma5 = rollingAverage(rows, i, "close", 5);
    row.ma25 = rollingAverage(rows, i, "close", 25);
    row.ma50 = rollingAverage(rows, i, "close", 50);

    row.highMa5 = rollingAverage(rows, i, "high", 5);
    row.lowMa5 = rollingAverage(rows, i, "low", 5);

    row.volumeMa50 =
      rollingAverage(rows, i, "volume", 50);

    // G列
    row.rangeRatio =
      row.close > 0
        ? (row.high - row.low) / row.close
        : null;

    // I列
    row.relativeVolume =
      Number.isFinite(row.volumeMa50) &&
      row.volumeMa50 > 0
        ? row.volume / row.volumeMa50
        : null;

    // J列
    if (i >= 68) {
      const values = rows
        .slice(i - 19, i + 1)
        .map(x => x.relativeVolume);

      row.relativeVolumeMa20 = average(values);
    } else {
      row.relativeVolumeMa20 = null;
    }

    // K列
    row.dailyVcp =
      Number.isFinite(row.rangeRatio) &&
      Number.isFinite(row.relativeVolume) &&
      Number.isFinite(row.relativeVolumeMa20) &&
      row.relativeVolumeMa20 > 0
        ? row.rangeRatio *
          (row.relativeVolume / row.relativeVolumeMa20)
        : null;

    // L / M列
    row.upVcp =
      Number.isFinite(row.dailyVcp) &&
      row.close > row.open
        ? row.dailyVcp
        : 0;

    row.downVcp =
      Number.isFinite(row.dailyVcp) &&
      row.close < row.open
        ? row.dailyVcp
        : 0;

    // N列
    if (i >= 93) {
      const window = rows.slice(i - 25, i + 1);

      const upSum = window.reduce(
        (sum, x) => sum + (x.upVcp || 0),
        0
      );

      const downSum = window.reduce(
        (sum, x) => sum + (x.downVcp || 0),
        0
      );

      row.vcp26 = upSum - downSum;
    } else {
      row.vcp26 = null;
    }

    // 5日前との差
    row.vcp26Delta5 =
      i >= 5 &&
      Number.isFinite(row.vcp26) &&
      Number.isFinite(rows[i - 5].vcp26)
        ? row.vcp26 - rows[i - 5].vcp26
        : null;

    // 日次VCP 120日10パーセンタイル
    if (i >= 119) {
      const values = rows
        .slice(i - 119, i + 1)
        .map(x => x.dailyVcp);

      row.dailyVcpP10 = percentileInc(values, 0.1);
    } else {
      row.dailyVcpP10 = null;
    }

    // 26日累積差5日変化の120日10パーセンタイル
    if (i >= 119) {
      const values = rows
        .slice(i - 119, i + 1)
        .map(x => x.vcp26Delta5);

      row.vcp26Delta5P10 = percentileInc(values, 0.1);
    } else {
      row.vcp26Delta5P10 = null;
    }

    // 正式なVCP候補条件
    row.vcpCandidate =
      Number.isFinite(row.dailyVcp) &&
      Number.isFinite(row.dailyVcpP10) &&
      Number.isFinite(row.vcp26Delta5) &&
      Number.isFinite(row.vcp26Delta5P10) &&
      row.dailyVcp <= row.dailyVcpP10 &&
      row.vcp26Delta5 <= row.vcp26Delta5P10;
  }

  return rows;
}

// ------------------------------
// 保存期間を直近10年に絞る
// ------------------------------

function trimToTenYears(rows) {
  const cutoff = new Date();

  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - YEARS);

  const cutoffTimestamp =
    Math.floor(cutoff.getTime() / 1000);

  return rows.filter(
    row => row.timestamp >= cutoffTimestamp
  );
}

// ------------------------------
// メイン処理
// ------------------------------

async function main() {
  const result = await fetchYahoo(SYMBOL);

  const {
    rows: rawRows,
    splits
  } = buildRows(result);

  calculateIndicators(rawRows);

  const rows = trimToTenYears(rawRows);

  if (!rows.length) {
    throw new Error("No price rows generated");
  }

  const latest = rows[rows.length - 1];

  const output = {
    schemaVersion: 1,

    code: CODE,
    symbol: SYMBOL,

    name:
      result.meta?.longName ??
      result.meta?.shortName ??
      null,

    exchange:
      result.meta?.exchangeName ??
      null,

    currency:
      result.meta?.currency ??
      "JPY",

    source: "Yahoo Finance",

    interval: "1d",

    adjustment: {
      price: "split-adjusted only",
      volume: "split-adjusted",
      dividendAdjusted: false
    },

    fetchedAt:
      new Date().toISOString(),

    startDate: rows[0].date,
    endDate: latest.date,

    rowCount: rows.length,

    splits,

    latest: {
      date: latest.date,
      close: latest.close,
      volume: latest.volume,
      dailyVcp: latest.dailyVcp,
      vcp26: latest.vcp26,
      vcp26Delta5: latest.vcp26Delta5,
      vcpCandidate: latest.vcpCandidate
    },

    data: rows
  };

  const json =
    JSON.stringify(output);

  const compressed =
    gzipSync(Buffer.from(json, "utf8"), {
      level: 9
    });

  const key =
    `stocks/${CODE}.json.gz`;

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME.trim(),
      Key: key,
      Body: compressed,

      ContentType: "application/json",
      ContentEncoding: "gzip",

      CacheControl: "no-cache",

      Metadata: {
        code: CODE,
        symbol: SYMBOL,
        source: "yahoo-finance"
      }
    })
  );

  console.log("");
  console.log("=== SUCCESS ===");
  console.log(`Code: ${CODE}`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Start: ${rows[0].date}`);
  console.log(`End: ${latest.date}`);
  console.log(`Latest close: ${latest.close}`);
  console.log(`Splits: ${splits.length}`);

  console.log(
    `Latest VCP candidate: ${latest.vcpCandidate}`
  );

  console.log(
    `JSON size: ${Buffer.byteLength(json)} bytes`
  );

  console.log(
    `GZIP size: ${compressed.length} bytes`
  );

  console.log(
    `Compression ratio: ${(
      compressed.length /
      Buffer.byteLength(json) *
      100
    ).toFixed(1)}%`
  );

  console.log(
    `Uploaded: ${key}`
  );
}

main().catch(error => {
  console.error("ERROR:", error);
  process.exit(1);
});
