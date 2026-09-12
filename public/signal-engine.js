/*
==============================================================
Signal Engine

BUY
  Trigger > Setup > Trend > 0

SELL mode 1（1回目）
  次の「完全SELL条件」が初めて成立した日にSELL。

  VCP 5MA < VCP 25MA
  AND
  VCP N < vcpSellThreshold
  AND
  Trend_t < Trend_t-5

SELL mode 2（2回目）
  1) 上記の完全SELL条件が初めて成立 → WARNINGをARM（まだ売らない）
  2) その後、VCP N が一度 0以上まで回復
  3) さらにその後、VCP N が 0以上 → 0未満へ再クロス
     → SELL

つまり2回目は、単純な「VCP N < threshold の2日目」ではなく、
「完全SELL警戒が1回立った後の、VCP Nの再失速」を意味する。
==============================================================
*/

(function () {

  const DEFAULT_OPTIONS = {
    vcpSellThreshold: -0.08,
    vcpHitOccurrence: 1
  };


  function isFiniteNumber(value) {
    return (
      typeof value === "number"
      &&
      Number.isFinite(value)
    );
  }


  function normalizeOccurrence(value) {
    return Number(value) === 2 ? 2 : 1;
  }


  function isBuyCondition(row) {
    if (
      ![
        row.triggerLine,
        row.setupLine,
        row.trendLine
      ].every(isFiniteNumber)
    ) {
      return false;
    }

    return (
      row.triggerLine > row.setupLine
      &&
      row.setupLine > row.trendLine
      &&
      row.trendLine > 0
    );
  }


  /*
  ============================================================
  完全SELL条件
  ============================================================
  */

  function getFullSellComponents(
    rows,
    index,
    options
  ) {
    if (index < 5) {
      return {
        valid: false,
        vcpMaCross: false,
        vcpThresholdHit: false,
        trendDecline: false,
        fullSellCandidate: false
      };
    }

    const row = rows[index];
    const row5 = rows[index - 5];

    if (
      ![
        row?.vcp26,
        row?.vcp26Ma5,
        row?.vcp26Ma25,
        row?.trendLine,
        row5?.trendLine
      ].every(isFiniteNumber)
    ) {
      return {
        valid: false,
        vcpMaCross: false,
        vcpThresholdHit: false,
        trendDecline: false,
        fullSellCandidate: false
      };
    }

    const vcpMaCross =
      row.vcp26Ma5 < row.vcp26Ma25;

    const vcpThresholdHit =
      row.vcp26 < options.vcpSellThreshold;

    const trendDecline =
      row.trendLine < row5.trendLine;

    const fullSellCandidate =
      vcpMaCross
      &&
      vcpThresholdHit
      &&
      trendDecline;

    return {
      valid: true,
      vcpMaCross,
      vcpThresholdHit,
      trendDecline,
      fullSellCandidate
    };
  }


  /*
  ============================================================
  VCP N の 0再クロス

  前日 >= 0
  当日 < 0
  ============================================================
  */

  function isVcpZeroDownCross(
    rows,
    index
  ) {
    if (index < 1) {
      return false;
    }

    const previous =
      rows[index - 1]?.vcp26;

    const current =
      rows[index]?.vcp26;

    return (
      isFiniteNumber(previous)
      &&
      isFiniteNumber(current)
      &&
      previous >= 0
      &&
      current < 0
    );
  }


  /*
  ============================================================
  Trade statistics
  ============================================================
  */

  function calculateTradeStats(
    rows,
    trade
  ) {
    const start = trade.entryIndex;

    const end =
      trade.exitIndex ??
      (rows.length - 1);

    if (
      start === null
      ||
      start === undefined
      ||
      end < start
      ||
      !isFiniteNumber(trade.entryPrice)
    ) {
      return {
        highestPrice: null,
        lowestPrice: null,
        mfePct: null,
        maePct: null,
        captureRatio: null
      };
    }

    let highest = trade.entryPrice;
    let lowest = trade.entryPrice;

    for (
      let i = start;
      i <= end;
      i++
    ) {
      const row = rows[i];

      if (isFiniteNumber(row.high)) {
        highest = Math.max(
          highest,
          row.high
        );
      }

      if (isFiniteNumber(row.low)) {
        lowest = Math.min(
          lowest,
          row.low
        );
      }
    }

    const mfePct =
      (
        highest /
        trade.entryPrice -
        1
      ) * 100;

    const maePct =
      (
        lowest /
        trade.entryPrice -
        1
      ) * 100;

    const effectiveExitPrice =
      trade.status === "OPEN"
        ? trade.currentPrice
        : trade.exitPrice;

    let captureRatio = null;

    if (
      isFiniteNumber(effectiveExitPrice)
      &&
      highest > trade.entryPrice
    ) {
      captureRatio =
        (
          effectiveExitPrice -
          trade.entryPrice
        ) /
        (
          highest -
          trade.entryPrice
        ) * 100;
    }

    return {
      highestPrice: highest,
      lowestPrice: lowest,
      mfePct,
      maePct,
      captureRatio
    };
  }


  function average(values) {
    if (!values.length) {
      return null;
    }

    return (
      values.reduce(
        (sum, value) => sum + value,
        0
      ) /
      values.length
    );
  }


  function median(values) {
    if (!values.length) {
      return null;
    }

    const sorted = [...values].sort(
      (a, b) => a - b
    );

    const middle =
      Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
      return sorted[middle];
    }

    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }


  function calculateSummary(trades) {
    if (!trades.length) {
      return {
        totalReturnPct: 0,
        closedTotalReturnPct: 0,
        averageMfePct: null,
        averageMaePct: null,
        averageCaptureRatio: null,
        medianCaptureRatio: null,
        captureSampleCount: 0,
        closedTrades: 0,
        winningTrades: 0,
        winRate: null
      };
    }

    let totalEquity = 1;
    let closedEquity = 1;
    let closedTrades = 0;
    let winningTrades = 0;

    const mfeValues = [];
    const maeValues = [];
    const winnerCaptureValues = [];

    for (const trade of trades) {
      if (isFiniteNumber(trade.returnPct)) {
        totalEquity *=
          1 + trade.returnPct / 100;
      }

      if (trade.status === "CLOSED") {
        closedTrades++;

        if (isFiniteNumber(trade.returnPct)) {
          closedEquity *=
            1 + trade.returnPct / 100;

          if (trade.returnPct > 0) {
            winningTrades++;

            if (
              isFiniteNumber(
                trade.captureRatio
              )
            ) {
              winnerCaptureValues.push(
                trade.captureRatio
              );
            }
          }
        }
      }

      if (isFiniteNumber(trade.mfePct)) {
        mfeValues.push(trade.mfePct);
      }

      if (isFiniteNumber(trade.maePct)) {
        maeValues.push(trade.maePct);
      }
    }

    return {
      totalReturnPct:
        (totalEquity - 1) * 100,

      closedTotalReturnPct:
        (closedEquity - 1) * 100,

      averageMfePct:
        average(mfeValues),

      averageMaePct:
        average(maeValues),

      averageCaptureRatio:
        average(winnerCaptureValues),

      medianCaptureRatio:
        median(winnerCaptureValues),

      captureSampleCount:
        winnerCaptureValues.length,

      closedTrades,
      winningTrades,

      winRate:
        closedTrades > 0
          ? winningTrades / closedTrades * 100
          : null
    };
  }


  /*
  ============================================================
  Main evaluation
  ============================================================
  */

  function evaluate(
    rows,
    userOptions = {}
  ) {
    const options = {
      ...DEFAULT_OPTIONS,
      ...userOptions
    };

    options.vcpHitOccurrence =
      normalizeOccurrence(
        options.vcpHitOccurrence
      );

    let inPosition = false;
    let currentTrade = null;

    /*
     * 2回目モード用ステート
     */
    let sellWarningArmed = false;
    let sellWarningDate = null;
    let sellWarningIndex = null;
    let zeroRecoverySeen = false;
    let zeroRecoveryDate = null;

    const buySignals = [];
    const sellSignals = [];
    const trades = [];


    /*
    ==========================================================
    Reset
    ==========================================================
    */

    for (const row of rows) {
      row.buyCondition = false;
      row.sellCondition = false;
      row.buySignal = false;
      row.sellSignal = false;
      row.positionState = false;

      row.fullSellCandidate = false;
      row.sellWarningArmed = false;
      row.zeroRecoverySeen = false;
      row.vcpZeroDownCross = false;
      row.sellComponents = null;

      /*
       * 旧UIとの互換用。
       * 「VCP hit count」ではなく、
       * 1回目警戒が立ったかどうかを 0/1 で保持。
       */
      row.vcpHitCountAfterBuy = 0;
    }


    /*
    ==========================================================
    Loop
    ==========================================================
    */

    for (
      let i = 0;
      i < rows.length;
      i++
    ) {
      const row = rows[i];

      row.buyCondition =
        isBuyCondition(row);


      /*
      ========================================================
      FLAT
      ========================================================
      */

      if (!inPosition) {
        if (row.buyCondition) {
          row.buySignal = true;
          row.positionState = true;
          inPosition = true;

          sellWarningArmed = false;
          sellWarningDate = null;
          sellWarningIndex = null;
          zeroRecoverySeen = false;
          zeroRecoveryDate = null;

          const signal = {
            type: "BUY",
            date: row.date,
            price: row.close,
            index: i,
            trigger: row.triggerLine,
            setup: row.setupLine,
            trend: row.trendLine,
            vcpN: row.vcp26
          };

          buySignals.push(signal);

          currentTrade = {
            entryDate: row.date,
            entryPrice: row.close,
            entryIndex: i,

            exitDate: null,
            exitPrice: null,
            exitIndex: null,

            currentDate: row.date,
            currentPrice: row.close,

            returnPct: 0,
            mfePct: null,
            maePct: null,
            captureRatio: null,

            vcpHitOccurrenceSetting:
              options.vcpHitOccurrence,

            vcpSellThreshold:
              options.vcpSellThreshold,

            sellWarningDate: null,
            zeroRecoveryDate: null,
            secondTriggerDate: null,
            exitReason: null,

            /*
             * 旧フィールド互換。
             */
            vcpHitCountAtExit: null,

            status: "OPEN"
          };
        }

        /*
         * BUY当日はSELL判定しない。
         */
        continue;
      }


      /*
      ========================================================
      LONG
      ========================================================
      */

      row.positionState = true;

      if (currentTrade) {
        currentTrade.currentDate =
          row.date;

        currentTrade.currentPrice =
          row.close;

        if (
          isFiniteNumber(
            currentTrade.entryPrice
          )
          &&
          isFiniteNumber(row.close)
        ) {
          currentTrade.returnPct =
            (
              row.close /
              currentTrade.entryPrice -
              1
            ) * 100;
        }
      }


      const components =
        getFullSellComponents(
          rows,
          i,
          options
        );

      row.fullSellCandidate =
        components.fullSellCandidate;


      /*
      ========================================================
      1回目モード

      完全SELL条件が立ったら即SELL。
      ========================================================
      */

      if (
        options.vcpHitOccurrence === 1
      ) {
        row.sellComponents = {
          ...components,
          mode: 1,
          sellWarningArmed: false,
          zeroRecoverySeen: false,
          vcpZeroDownCross: false
        };

        row.sellCondition =
          components.fullSellCandidate;
      }


      /*
      ========================================================
      2回目モード
      ========================================================
      */

      if (
        options.vcpHitOccurrence === 2
      ) {

        /*
         * STEP 1:
         * 完全SELL条件が初めて成立。
         * 警戒状態をARMするが、まだ売らない。
         */
        if (
          !sellWarningArmed
          &&
          components.fullSellCandidate
        ) {
          sellWarningArmed = true;
          sellWarningDate = row.date;
          sellWarningIndex = i;

          if (currentTrade) {
            currentTrade.sellWarningDate =
              row.date;
          }

          row.sellWarningArmed = true;
          row.vcpHitCountAfterBuy = 1;

          row.sellComponents = {
            ...components,
            mode: 2,
            sellWarningArmed: true,
            zeroRecoverySeen: false,
            vcpZeroDownCross: false,
            warningJustArmed: true
          };

          /*
           * 同じ日に2回目判定へ進ませない。
           */
          continue;
        }


        if (sellWarningArmed) {
          row.sellWarningArmed = true;
          row.vcpHitCountAfterBuy = 1;

          /*
           * STEP 2:
           * 1回目警戒成立「後」に、VCP Nが0以上へ戻ったか。
           */
          if (
            i > sellWarningIndex
            &&
            isFiniteNumber(row.vcp26)
            &&
            row.vcp26 >= 0
          ) {
            if (!zeroRecoverySeen) {
              zeroRecoverySeen = true;
              zeroRecoveryDate = row.date;

              if (currentTrade) {
                currentTrade.zeroRecoveryDate =
                  row.date;
              }
            }
          }

          row.zeroRecoverySeen =
            zeroRecoverySeen;


          /*
           * STEP 3:
           * 0以上へ回復した後、再び0を下抜けたらSELL。
           */
          const zeroDownCross =
            zeroRecoverySeen
            &&
            i > sellWarningIndex
            &&
            isVcpZeroDownCross(
              rows,
              i
            );

          row.vcpZeroDownCross =
            zeroDownCross;

          row.sellCondition =
            zeroDownCross;

          row.sellComponents = {
            ...components,
            mode: 2,
            sellWarningArmed: true,
            zeroRecoverySeen,
            vcpZeroDownCross:
              zeroDownCross,
            warningJustArmed: false
          };
        } else {
          row.sellComponents = {
            ...components,
            mode: 2,
            sellWarningArmed: false,
            zeroRecoverySeen: false,
            vcpZeroDownCross: false,
            warningJustArmed: false
          };
        }
      }


      if (!row.sellCondition) {
        continue;
      }


      /*
      ========================================================
      SELL
      ========================================================
      */

      row.sellSignal = true;

      const exitReason =
        options.vcpHitOccurrence === 1
          ? "FULL_SELL_CONDITION"
          : "VCP_ZERO_RECROSS_AFTER_WARNING";

      const sellSignal = {
        type: "SELL",
        date: row.date,
        price: row.close,
        index: i,

        exitReason,

        trend: row.trendLine,
        trend5:
          rows[i - 5]?.trendLine ?? null,

        vcpN: row.vcp26,
        vcpThreshold:
          options.vcpSellThreshold,

        vcpHitOccurrence:
          options.vcpHitOccurrence,

        sellWarningDate,
        zeroRecoveryDate,

        sellComponents: {
          ...row.sellComponents
        }
      };

      sellSignals.push(
        sellSignal
      );


      if (currentTrade) {
        currentTrade.exitDate =
          row.date;

        currentTrade.exitPrice =
          row.close;

        currentTrade.exitIndex =
          i;

        currentTrade.currentDate =
          row.date;

        currentTrade.currentPrice =
          row.close;

        currentTrade.returnPct =
          (
            row.close /
            currentTrade.entryPrice -
            1
          ) * 100;

        currentTrade.status =
          "CLOSED";

        currentTrade.exitReason =
          exitReason;

        currentTrade.sellWarningDate =
          sellWarningDate;

        currentTrade.zeroRecoveryDate =
          zeroRecoveryDate;

        currentTrade.secondTriggerDate =
          options.vcpHitOccurrence === 2
            ? row.date
            : null;

        currentTrade.vcpHitCountAtExit =
          options.vcpHitOccurrence;

        Object.assign(
          currentTrade,
          calculateTradeStats(
            rows,
            currentTrade
          )
        );

        trades.push(
          currentTrade
        );
      }


      currentTrade = null;
      inPosition = false;

      sellWarningArmed = false;
      sellWarningDate = null;
      sellWarningIndex = null;
      zeroRecoverySeen = false;
      zeroRecoveryDate = null;

      row.positionState = false;
    }


    /*
    ==========================================================
    Open trade
    ==========================================================
    */

    if (currentTrade) {
      const latest =
        rows[rows.length - 1];

      currentTrade.currentDate =
        latest?.date ?? null;

      currentTrade.currentPrice =
        latest?.close ?? null;

      currentTrade.returnPct =
        (
          isFiniteNumber(latest?.close)
          &&
          isFiniteNumber(
            currentTrade.entryPrice
          )
        )
          ? (
              latest.close /
              currentTrade.entryPrice -
              1
            ) * 100
          : null;

      currentTrade.sellWarningDate =
        sellWarningDate;

      currentTrade.zeroRecoveryDate =
        zeroRecoveryDate;

      currentTrade.vcpHitCountAtExit =
        sellWarningArmed
          ? 1
          : 0;

      Object.assign(
        currentTrade,
        calculateTradeStats(
          rows,
          currentTrade
        )
      );

      trades.push(
        currentTrade
      );
    }


    const summary =
      calculateSummary(trades);


    /*
    ==========================================================
    Sidebar / UI state
    ==========================================================
    */

    let sellStage = "WAITING_FIRST_FLAG";

    if (options.vcpHitOccurrence === 1) {
      sellStage = inPosition
        ? "WAITING_FULL_SELL"
        : "FLAT";

    } else if (!inPosition) {
      sellStage = "FLAT";

    } else if (!sellWarningArmed) {
      sellStage = "WAITING_FIRST_FLAG";

    } else if (!zeroRecoverySeen) {
      sellStage = "WARNING_ARMED_WAIT_ZERO_RECOVERY";

    } else {
      sellStage = "WAITING_ZERO_RECROSS";
    }


    return {
      options,
      buySignals,
      sellSignals,
      trades,
      summary,

      inPosition,

      /*
       * 旧UIとの互換用。
       * 2回目モードでは1回目警戒が立ったら1。
       */
      vcpHitCount:
        sellWarningArmed
          ? 1
          : 0,

      sellWarningArmed,
      sellWarningDate,
      zeroRecoverySeen,
      zeroRecoveryDate,
      sellStage,

      latestBuy:
        buySignals.length
          ? buySignals[
              buySignals.length - 1
            ]
          : null,

      latestSell:
        sellSignals.length
          ? sellSignals[
              sellSignals.length - 1
            ]
          : null,

      currentTrade:
        inPosition
          ? currentTrade
          : null
    };
  }


  /*
  ============================================================
  Public API
  ============================================================
  */

  window.SignalEngine = {
    evaluate,
    isBuyCondition,

    getFullSellComponents,
    isVcpZeroDownCross
  };

})();
