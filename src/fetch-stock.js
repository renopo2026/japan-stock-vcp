import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import { gzipSync } from "node:zlib";
import YahooFinance from "yahoo-finance2";

// ============================================================
// Yahoo Finance
// ============================================================

const yahooFinance = new YahooFinance();

// ============================================================
// 基本設定
// ============================================================

const CODE = process.env.STOCK_CODE || "7203";
const SYMBOL = `${CODE}.T`;

const SAVE_YEARS = 10;

// VCPを保存期間の初日から計算できるように、
// 保存期間よりさらに約1年多くYahooから取得する。
const WARMUP_MONTHS = 12;

// ============================================================
// R2環境変数
// ============================================================

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME
} = process.env;

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

// ============================================================
// Cloudflare R2クライアント
// ============================================================

const r2 = new S3Client({
  region: "auto",

  endpoint:
    `https://${R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,

  // Cloudflare R2との互換性を優先
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",

  credentials: {
    accessKeyId:
      R2_ACCESS_KEY_ID.trim(),

    secretAccessKey:
      R2_SECRET_ACCESS_KEY.trim()
  }
});

// ============================================================
// Utility
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isFiniteNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

// ============================================================
// Yahoo Finance取得
// ============================================================

async function fetchYahoo(symbol) {

  const start = new Date();

  // 10年前へ
  start.setUTCFullYear(
    start.getUTCFullYear() - SAVE_YEARS
  );

  // VCPウォームアップ期間をさらに追加
  start.setUTCMonth(
    start.getUTCMonth() - WARMUP_MONTHS
  );

  // 当日データを確実に期間内へ入れるため翌日まで指定
  const end = new Date(
    Date.now() +
    24 * 60 * 60 * 1000
  );

  /*
   * Yahooから429等が返った場合の待機時間。
   *
   * attempt 1 : 即実行
   * attempt 2 : 30秒後
   * attempt 3 : 90秒後
   * attempt 4 : 180秒後
   */
  const waits = [
    0,
    30_000,
    90_000,
    180_000
  ];

  let lastError;

  for (
    let attempt = 0;
    attempt < waits.length;
    attempt++
  ) {

    if (waits[attempt] > 0) {

      console.log(
        `Waiting ${waits[attempt] / 1000}s before retry...`
      );

      await sleep(waits[attempt]);
    }

    try {

      console.log(
        `Fetching Yahoo Finance: ${symbol} ` +
        `(attempt ${attempt + 1}/${waits.length})`
      );

      const result =
        await yahooFinance.chart(
          symbol,
          {
            period1: start,
            period2: end,

            interval: "1d",

            includePrePost: false,

            // 株式分割情報も取得する
            events: "div|split",

            // timestamp / indicators形式で取得
            return: "object",

            lang: "en-US"
          }
        );

      if (!result) {
        throw new Error(
          "Yahoo Finance returned no result"
        );
      }

      if (
        !Array.isArray(result.timestamp) ||
        result.timestamp.length === 0
      ) {
        throw new Error(
          "Yahoo Finance returned no timestamps"
        );
      }

      if (
        !result.indicators?.quote?.[0]
      ) {
        throw new Error(
          "Yahoo Finance returned no OHLCV data"
        );
      }

      console.log(
        `Yahoo Finance OK: ${result.timestamp.length} raw rows`
      );

      return result;

    } catch (error) {

      lastError = error;

      const message =
        String(
          error?.message ??
          error
        );

      console.error(
        `Yahoo attempt ${attempt + 1} failed: ${message}`
      );

      /*
       * Yahoo側の一時的アクセス制限なら再試行。
       *
       * GitHub Actions共有IP自体が規制されている場合は、
       * 最終的に全試行が失敗する。
       */
      const retryable =
        /429|Too Many Requests|crumb|cookie|401|403|Unauthorized|Forbidden|ECONNRESET|ETIMEDOUT|fetch failed/i
          .test(message);

      if (!retryable) {
        throw error;
      }
    }
  }

  throw lastError;
}

// ============================================================
// Unix timestamp → 日本時間 YYYY-MM-DD
// ============================================================

function toTokyoDate(timestamp) {

  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(
    new Date(timestamp * 1000)
  );
}

// ============================================================
// Date / timestamp正規化
// ============================================================

function normalizeTimestamp(value) {

  if (value instanceof Date) {
    return Math.floor(
      value.getTime() / 1000
    );
  }

  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return NaN;
  }

  // ミリ秒なら秒へ変換
  if (number > 1_000_000_000_000) {
    return Math.floor(
      number / 1000
    );
  }

  return Math.floor(number);
}

// ============================================================
// 株式分割比率
// ============================================================

function parseSplitRatio(split) {

  if (
    isFiniteNumber(split?.numerator) &&
    isFiniteNumber(split?.denominator) &&
    split.denominator !== 0
  ) {
    return (
      split.numerator /
      split.denominator
    );
  }

  if (
    typeof split?.splitRatio === "string"
  ) {

    const parts =
      split.splitRatio.split(":");

    if (parts.length === 2) {

      const numerator =
        Number(parts[0]);

      const denominator =
        Number(parts[1]);

      if (
        Number.isFinite(numerator) &&
        Number.isFinite(denominator) &&
        denominator !== 0
      ) {
        return (
          numerator /
          denominator
        );
      }
    }
  }

  return 1;
}

// ============================================================
// Yahooの株式分割イベント
// ============================================================

function getSplits(result) {

  const source =
    result.events?.splits ?? {};

  return Object.values(source)
    .map(split => {

      const timestamp =
        normalizeTimestamp(
          split.date
        );

      return {
        timestamp,

        date:
          Number.isFinite(timestamp)
            ? toTokyoDate(timestamp)
            : null,

        numerator:
          split.numerator ?? null,

        denominator:
          split.denominator ?? null,

        ratio:
          parseSplitRatio(split),

        splitRatio:
          split.splitRatio ?? null
      };
    })
    .filter(split =>
      Number.isFinite(
        split.timestamp
      )
    )
    .sort(
      (a, b) =>
        a.timestamp -
        b.timestamp
    );
}

// ============================================================
// Yahooデータ → 日足
// ============================================================

function buildRows(result) {

  const timestamps =
    result.timestamp ?? [];

  const quote =
    result.indicators?.quote?.[0];

  if (!quote) {
    throw new Error(
      "Yahoo quote data is missing"
    );
  }

  const splits =
    getSplits(result);

  console.log(
    `Split events: ${splits.length}`
  );

  const rows = [];

  for (
    let i = 0;
    i < timestamps.length;
    i++
  ) {

    const timestamp =
      timestamps[i];

    const open =
      quote.open?.[i];

    const high =
      quote.high?.[i];

    const low =
      quote.low?.[i];

    const close =
      quote.close?.[i];

    const volume =
      quote.volume?.[i];

    /*
     * Yahooでは日足履歴のOHLCが
     * 株式分割を反映した系列として提供される。
     *
     * ここでsplit比率を再適用すると
     * 二重調整になる可能性があるため、
     * Yahooから得たOHLCVをそのまま採用する。
     */

    if (
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close) ||
      !isFiniteNumber(volume)
    ) {
      continue;
    }

    if (
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0
    ) {
      continue;
    }

    rows.push({
      timestamp,

      date:
        toTokyoDate(timestamp),

      open,
      high,
      low,
      close,

      volume:
        Math.round(volume)
    });
  }

  if (!rows.length) {
    throw new Error(
      "No valid Yahoo price rows"
    );
  }

  // 念のため日付順に並べる
  rows.sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

  return {
    rows,
    splits
  };
}

// ============================================================
// 平均
// ============================================================

function average(values) {

  if (!values.length) {
    return null;
  }

  if (
    !values.every(
      isFiniteNumber
    )
  ) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length
  );
}

// ============================================================
// 移動平均
// ============================================================

function rollingAverage(
  rows,
  index,
  field,
  period
) {

  if (
    index <
    period - 1
  ) {
    return null;
  }

  const values =
    rows
      .slice(
        index - period + 1,
        index + 1
      )
      .map(
        row =>
          row[field]
      );

  return average(values);
}

// ============================================================
// Percentile.INC相当
// ============================================================

function percentileInc(
  values,
  percentile
) {

  if (!values.length) {
    return null;
  }

  // 今回は欠損を無視して計算せず、
  // 全データが揃っていることを要求する。
  if (
    !values.every(
      isFiniteNumber
    )
  ) {
    return null;
  }

  const sorted =
    [...values]
      .sort(
        (a, b) =>
          a - b
      );

  if (
    sorted.length === 1
  ) {
    return sorted[0];
  }

  const rank =
    percentile *
    (sorted.length - 1);

  const lower =
    Math.floor(rank);

  const upper =
    Math.ceil(rank);

  if (
    lower === upper
  ) {
    return sorted[lower];
  }

  const weight =
    rank - lower;

  return (
    sorted[lower] *
      (1 - weight) +
    sorted[upper] *
      weight
  );
}

// ============================================================
// 120営業日のPercentile
// ============================================================

function rollingPercentile120(
  rows,
  index,
  field
) {

  const PERIOD = 120;

  if (
    index <
    PERIOD - 1
  ) {
    return null;
  }

  const values =
    rows
      .slice(
        index - PERIOD + 1,
        index + 1
      )
      .map(
        row =>
          row[field]
      );

  // 120個すべて有効値でなければ判定しない
  if (
    values.length !== PERIOD ||
    !values.every(
      isFiniteNumber
    )
  ) {
    return null;
  }

  return percentileInc(
    values,
    0.10
  );
}

// ============================================================
// VCP・移動平均等
// ============================================================

function calculateIndicators(rows) {

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {

    const row =
      rows[i];

    // --------------------------------------------------------
    // 移動平均
    // --------------------------------------------------------

    row.ma5 =
      rollingAverage(
        rows,
        i,
        "close",
        5
      );

    row.ma25 =
      rollingAverage(
        rows,
        i,
        "close",
        25
      );

    row.ma50 =
      rollingAverage(
        rows,
        i,
        "close",
        50
      );

    row.highMa5 =
      rollingAverage(
        rows,
        i,
        "high",
        5
      );

    row.lowMa5 =
      rollingAverage(
        rows,
        i,
        "low",
        5
      );

    // --------------------------------------------------------
    // 50日平均出来高
    // --------------------------------------------------------

    row.volumeMa50 =
      rollingAverage(
        rows,
        i,
        "volume",
        50
      );

    // --------------------------------------------------------
    // G列
    //
    // (高値 - 安値) / 終値
    // --------------------------------------------------------

    row.rangeRatio =
      row.close > 0
        ? (
            row.high -
            row.low
          ) /
          row.close
        : null;

    // --------------------------------------------------------
    // I列
    //
    // 当日出来高 / 50日平均出来高
    // --------------------------------------------------------

    row.relativeVolume =
      isFiniteNumber(
        row.volumeMa50
      ) &&
      row.volumeMa50 > 0
        ? (
            row.volume /
            row.volumeMa50
          )
        : null;

    // --------------------------------------------------------
    // J列
    //
    // 相対出来高の20日平均
    //
    // volumeMa50が最初に計算できるのが index 49。
    // そこから20個必要なので最初の有効値は index 68。
    // --------------------------------------------------------

    if (i >= 68) {

      const values =
        rows
          .slice(
            i - 19,
            i + 1
          )
          .map(
            item =>
              item.relativeVolume
          );

      row.relativeVolumeMa20 =
        average(values);

    } else {

      row.relativeVolumeMa20 =
        null;
    }

    // --------------------------------------------------------
    // K列：日次VCP
    //
    // 値幅率 ×
    // (相対出来高 / 相対出来高20日平均)
    // --------------------------------------------------------

    row.dailyVcp =
      isFiniteNumber(
        row.rangeRatio
      ) &&
      isFiniteNumber(
        row.relativeVolume
      ) &&
      isFiniteNumber(
        row.relativeVolumeMa20
      ) &&
      row.relativeVolumeMa20 > 0
        ? (
            row.rangeRatio *
            (
              row.relativeVolume /
              row.relativeVolumeMa20
            )
          )
        : null;

    // --------------------------------------------------------
    // L列：陽線VCP
    // --------------------------------------------------------

    row.upVcp =
      isFiniteNumber(
        row.dailyVcp
      ) &&
      row.close >
      row.open
        ? row.dailyVcp
        : (
            isFiniteNumber(
              row.dailyVcp
            )
              ? 0
              : null
          );

    // --------------------------------------------------------
    // M列：陰線VCP
    // --------------------------------------------------------

    row.downVcp =
      isFiniteNumber(
        row.dailyVcp
      ) &&
      row.close <
      row.open
        ? row.dailyVcp
        : (
            isFiniteNumber(
              row.dailyVcp
            )
              ? 0
              : null
          );

    // --------------------------------------------------------
    // N列
    //
    // 陽線VCP26日合計
    // -
    // 陰線VCP26日合計
    //
    // dailyVcp最初の有効値 index 68
    // + 26営業日 → index 93から完全な26日窓
    // --------------------------------------------------------

    if (i >= 93) {

      const window =
        rows.slice(
          i - 25,
          i + 1
        );

      const valid =
        window.every(
          item =>
            isFiniteNumber(
              item.upVcp
            ) &&
            isFiniteNumber(
              item.downVcp
            )
        );

      if (valid) {

        const upSum =
          window.reduce(
            (sum, item) =>
              sum +
              item.upVcp,
            0
          );

        const downSum =
          window.reduce(
            (sum, item) =>
              sum +
              item.downVcp,
            0
          );

        row.vcp26 =
          upSum -
          downSum;

      } else {

        row.vcp26 =
          null;
      }

    } else {

      row.vcp26 =
        null;
    }

    // --------------------------------------------------------
    // VCP26の5日変化量
    //
    // N(t) - N(t-5)
    //
    // vcp26がindex 93からなので、
    // 完全な5日前比較はindex 98から。
    // --------------------------------------------------------

    row.vcp26Delta5 =
      i >= 5 &&
      isFiniteNumber(
        row.vcp26
      ) &&
      isFiniteNumber(
        rows[i - 5].vcp26
      )
        ? (
            row.vcp26 -
            rows[i - 5].vcp26
          )
        : null;

    // --------------------------------------------------------
    // 日次VCP：
    // 直近120営業日の10パーセンタイル
    //
    // 120個全部揃っている場合のみ計算
    // --------------------------------------------------------

    row.dailyVcpP10 =
      rollingPercentile120(
        rows,
        i,
        "dailyVcp"
      );

    // --------------------------------------------------------
    // 26日累積差の5日変化：
    // 直近120営業日の10パーセンタイル
    // --------------------------------------------------------

    row.vcp26Delta5P10 =
      rollingPercentile120(
        rows,
        i,
        "vcp26Delta5"
      );

    // --------------------------------------------------------
    // VCP候補
    //
    // ① 日次VCPが直近120営業日の下位10%
    //
    // ② VCP26の5日変化量が
    //    直近120営業日の下位10%
    //
    // 両方を満たす
    // --------------------------------------------------------

    row.vcpCandidate =
      isFiniteNumber(
        row.dailyVcp
      ) &&
      isFiniteNumber(
        row.dailyVcpP10
      ) &&
      isFiniteNumber(
        row.vcp26Delta5
      ) &&
      isFiniteNumber(
        row.vcp26Delta5P10
      ) &&
      row.dailyVcp <=
        row.dailyVcpP10 &&
      row.vcp26Delta5 <=
        row.vcp26Delta5P10;
  }

  return rows;
}

// ============================================================
// 保存期間を直近10年間に絞る
// ============================================================

function trimToSavedPeriod(rows) {

  const cutoff =
    new Date();

  cutoff.setUTCFullYear(
    cutoff.getUTCFullYear() -
    SAVE_YEARS
  );

  const cutoffTimestamp =
    Math.floor(
      cutoff.getTime() /
      1000
    );

  return rows.filter(
    row =>
      row.timestamp >=
      cutoffTimestamp
  );
}

// ============================================================
// データ検証
// ============================================================

function validateRows(rows) {

  if (!rows.length) {
    throw new Error(
      "No price rows generated"
    );
  }

  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    if (
      rows[i].timestamp <=
      rows[i - 1].timestamp
    ) {
      throw new Error(
        `Timestamp order error at ${rows[i].date}`
      );
    }
  }

  const duplicateDates =
    new Set();

  const seen =
    new Set();

  for (const row of rows) {

    if (
      seen.has(row.date)
    ) {
      duplicateDates.add(
        row.date
      );
    }

    seen.add(
      row.date
    );
  }

  if (
    duplicateDates.size > 0
  ) {
    throw new Error(
      `Duplicate dates detected: ${
        [...duplicateDates]
          .slice(0, 10)
          .join(", ")
      }`
    );
  }
}

// ============================================================
// メイン処理
// ============================================================

async function main() {

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    `START ${SYMBOL}`
  );
  console.log(
    "========================================"
  );

  // ----------------------------------------------------------
  // Yahoo取得
  // ----------------------------------------------------------

  const result =
    await fetchYahoo(
      SYMBOL
    );

  // ----------------------------------------------------------
  // OHLCV作成
  // ----------------------------------------------------------

  const {
    rows: rawRows,
    splits
  } =
    buildRows(
      result
    );

  console.log(
    `Valid OHLCV rows before trim: ${rawRows.length}`
  );

  // ----------------------------------------------------------
  // 指標計算
  //
  // 10年へ切る前に計算する。
  // これにより10年前の保存開始地点でも
  // ウォームアップ済み指標を利用できる。
  // ----------------------------------------------------------

  calculateIndicators(
    rawRows
  );

  // ----------------------------------------------------------
  // 保存期間を10年へ
  // ----------------------------------------------------------

  const rows =
    trimToSavedPeriod(
      rawRows
    );

  validateRows(
    rows
  );

  // ----------------------------------------------------------
  // 最新データ
  // ----------------------------------------------------------

  const latest =
    rows[
      rows.length - 1
    ];

  // ----------------------------------------------------------
  // VCP候補件数
  // ----------------------------------------------------------

  const candidateRows =
    rows.filter(
      row =>
        row.vcpCandidate
    );

  // ----------------------------------------------------------
  // 出力JSON
  // ----------------------------------------------------------

  const output = {

    schemaVersion: 2,

    code: CODE,

    symbol: SYMBOL,

    name:
      result.meta?.longName ??
      result.meta?.shortName ??
      null,

    exchange:
      result.meta?.exchangeName ??
      null,

    fullExchangeName:
      result.meta?.fullExchangeName ??
      null,

    instrumentType:
      result.meta?.instrumentType ??
      null,

    currency:
      result.meta?.currency ??
      "JPY",

    source:
      "Yahoo Finance via yahoo-finance2",

    interval:
      "1d",

    adjustment: {

      /*
       * Yahoo Finance ChartのOHLCVをそのまま使用。
       *
       * OHLCについては株式分割を反映した履歴系列。
       * Adj Closeは使用しないため、
       * 配当込み総収益調整にはしない。
       */

      price:
        "Yahoo Finance historical OHLC; split-adjusted series",

      volume:
        "Yahoo Finance historical volume as provided",

      dividendAdjusted:
        false,

      manuallySplitAdjusted:
        false
    },

    fetchedAt:
      new Date()
        .toISOString(),

    startDate:
      rows[0].date,

    endDate:
      latest.date,

    rowCount:
      rows.length,

    splitCount:
      splits.length,

    splits,

    vcpDefinition: {

      rangeRatio:
        "(high-low)/close",

      volumeMa50:
        "50-day average volume",

      relativeVolume:
        "volume/volumeMa50",

      relativeVolumeMa20:
        "20-day average relativeVolume",

      dailyVcp:
        "rangeRatio*(relativeVolume/relativeVolumeMa20)",

      vcp26:
        "26-day sum(upVcp)-26-day sum(downVcp)",

      vcp26Delta5:
        "vcp26(t)-vcp26(t-5)",

      candidate:
        "dailyVcp <= 120-day P10 AND vcp26Delta5 <= 120-day P10"
    },

    candidateCount:
      candidateRows.length,

    latest: {

      date:
        latest.date,

      close:
        latest.close,

      volume:
        latest.volume,

      ma5:
        latest.ma5,

      ma25:
        latest.ma25,

      ma50:
        latest.ma50,

      highMa5:
        latest.highMa5,

      lowMa5:
        latest.lowMa5,

      dailyVcp:
        latest.dailyVcp,

      dailyVcpP10:
        latest.dailyVcpP10,

      vcp26:
        latest.vcp26,

      vcp26Delta5:
        latest.vcp26Delta5,

      vcp26Delta5P10:
        latest.vcp26Delta5P10,

      vcpCandidate:
        latest.vcpCandidate
    },

    data:
      rows
  };

  // ----------------------------------------------------------
  // JSON化
  // ----------------------------------------------------------

  const json =
    JSON.stringify(
      output
    );

  const jsonBytes =
    Buffer.byteLength(
      json,
      "utf8"
    );

  // ----------------------------------------------------------
  // gzip
  // ----------------------------------------------------------

  const compressed =
    gzipSync(
      Buffer.from(
        json,
        "utf8"
      ),
      {
        level: 9
      }
    );

  // ----------------------------------------------------------
  // R2保存先
  // ----------------------------------------------------------

  const key =
    `stocks/${CODE}.json.gz`;

  // ----------------------------------------------------------
  // R2へPUT
  // ----------------------------------------------------------

  await r2.send(
    new PutObjectCommand({
      Bucket:
        R2_BUCKET_NAME.trim(),

      Key:
        key,

      Body:
        compressed,

      ContentType:
        "application/json",

      ContentEncoding:
        "gzip",

      CacheControl:
        "no-cache",

      Metadata: {
        code:
          CODE,

        symbol:
          SYMBOL,

        source:
          "yahoo-finance2",

        interval:
          "1d"
      }
    })
  );

  // ----------------------------------------------------------
  // 実行結果
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "SUCCESS"
  );
  console.log(
    "========================================"
  );

  console.log(
    `Code: ${CODE}`
  );

  console.log(
    `Symbol: ${SYMBOL}`
  );

  console.log(
    `Name: ${output.name}`
  );

  console.log(
    `Rows: ${rows.length}`
  );

  console.log(
    `Start: ${rows[0].date}`
  );

  console.log(
    `End: ${latest.date}`
  );

  console.log(
    `Latest close: ${latest.close}`
  );

  console.log(
    `Split events: ${splits.length}`
  );

  console.log(
    `VCP candidates in saved period: ${candidateRows.length}`
  );

  console.log(
    `Latest VCP candidate: ${latest.vcpCandidate}`
  );

  console.log(
    `JSON size: ${jsonBytes} bytes`
  );

  console.log(
    `GZIP size: ${compressed.length} bytes`
  );

  console.log(
    `Compression ratio: ${(
      (
        compressed.length /
        jsonBytes
      ) *
      100
    ).toFixed(1)}%`
  );

  console.log(
    `Uploaded: ${key}`
  );

  console.log(
    "========================================"
  );
}

// ============================================================
// 実行
// ============================================================

main()
  .catch(error => {

    console.error("");
    console.error(
      "========================================"
    );

    console.error(
      "ERROR"
    );

    console.error(
      "========================================"
    );

    console.error(
      error
    );

    process.exit(1);
  });
