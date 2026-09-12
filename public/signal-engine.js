/*
==============================================================
Signal Engine

BUY
  Trigger > Setup > Trend > 0

SELL
  VCP 5MA < VCP 25MA
  AND
  VCP N < vcpSellThreshold
  AND
  Trend_t < Trend_t-5

SELLはBUY後だけ有効。

バックテスト統計:
  Total Return
  MFE
  MAE
  Capture Ratio
  Win Rate
==============================================================
*/

(function () {

  const DEFAULT_OPTIONS = {

    /*
     * SELL条件のVCP N閾値
     */
    vcpSellThreshold:
      -0.08
  };


  function isFiniteNumber(
    value
  ) {

    return (
      typeof value ===
      "number"
      &&
      Number.isFinite(
        value
      )
    );
  }


  /*
  ============================================================
  BUY
  ============================================================
  */

  function isBuyCondition(
    row
  ) {

    if (
      ![
        row.triggerLine,
        row.setupLine,
        row.trendLine
      ].every(
        isFiniteNumber
      )
    ) {

      return false;
    }


    return (
      row.triggerLine >
      row.setupLine

      &&

      row.setupLine >
      row.trendLine

      &&

      row.trendLine >
      0
    );
  }


  /*
  ============================================================
  SELL
  ============================================================
  */

  function isSellCondition(
    rows,
    index,
    options
  ) {

    if (
      index <
      5
    ) {

      return false;
    }


    const row =
      rows[index];


    const row5 =
      rows[
        index -
        5
      ];


    if (
      ![
        row.vcp26,
        row.vcp26Ma5,
        row.vcp26Ma25,
        row.trendLine,
        row5.trendLine
      ].every(
        isFiniteNumber
      )
    ) {

      return false;
    }


    return (
      row.vcp26Ma5 <
      row.vcp26Ma25

      &&

      row.vcp26 <
      options.vcpSellThreshold

      &&

      row.trendLine <
      row5.trendLine
    );
  }


  /*
  ============================================================
  1トレードのMFE / MAE / Capture Ratio
  ============================================================
  */

  function calculateTradeStats(
    rows,
    trade
  ) {

    const start =
      trade.entryIndex;


    const end =
      trade.exitIndex ??
      (
        rows.length -
        1
      );


    if (
      start === null
      ||
      start === undefined
      ||
      end <
      start
      ||
      !isFiniteNumber(
        trade.entryPrice
      )
    ) {

      return {
        mfePct:
          null,

        maePct:
          null,

        captureRatio:
          null
      };
    }


    let highest =
      trade.entryPrice;


    let lowest =
      trade.entryPrice;


    for (
      let i =
        start;

      i <=
        end;

      i++
    ) {

      const row =
        rows[i];


      /*
       * MFEは日中高値を使用
       */
      if (
        isFiniteNumber(
          row.high
        )
      ) {

        highest =
          Math.max(
            highest,
            row.high
          );
      }


      /*
       * MAEは日中安値を使用
       */
      if (
        isFiniteNumber(
          row.low
        )
      ) {

        lowest =
          Math.min(
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
      ) *
      100;


    const maePct =
      (
        lowest /
        trade.entryPrice -
        1
      ) *
      100;


    const effectiveExitPrice =
      trade.status ===
      "OPEN"
        ? trade.currentPrice
        : trade.exitPrice;


    let captureRatio =
      null;


    /*
     * 最大含み益が存在する場合だけ
     * Capture Ratioを計算。
     */
    if (
      isFiniteNumber(
        effectiveExitPrice
      )
      &&
      highest >
      trade.entryPrice
    ) {

      captureRatio =
        (
          effectiveExitPrice -
          trade.entryPrice
        )
        /
        (
          highest -
          trade.entryPrice
        )
        *
        100;
    }


    return {

      highestPrice:
        highest,

      lowestPrice:
        lowest,

      mfePct,

      maePct,

      captureRatio
    };
  }


  /*
  ============================================================
  Strategy Summary
  ============================================================
  */

  function calculateSummary(
    trades
  ) {

    if (
      !trades.length
    ) {

      return {

        totalReturnPct:
          0,

        closedTotalReturnPct:
          0,

        averageMfePct:
          null,

        averageMaePct:
          null,

        averageCaptureRatio:
          null,

        closedTrades:
          0,

        winningTrades:
          0,

        winRate:
          null
      };
    }


    /*
     * Total Return
     *
     * トレードが重複しないため、
     * 各リターンを複利で接続する。
     */
    let totalEquity =
      1;


    let closedEquity =
      1;


    let closedTrades =
      0;


    let winningTrades =
      0;


    const mfeValues =
      [];


    const maeValues =
      [];


    const captureValues =
      [];


    for (
      const trade
      of trades
    ) {

      if (
        isFiniteNumber(
          trade.returnPct
        )
      ) {

        totalEquity *=
          (
            1 +
            trade.returnPct /
            100
          );
      }


      if (
        trade.status ===
        "CLOSED"
      ) {

        closedTrades++;


        if (
          isFiniteNumber(
            trade.returnPct
          )
        ) {

          closedEquity *=
            (
              1 +
              trade.returnPct /
              100
            );


          if (
            trade.returnPct >
            0
          ) {

            winningTrades++;
          }
        }
      }


      if (
        isFiniteNumber(
          trade.mfePct
        )
      ) {

        mfeValues.push(
          trade.mfePct
        );
      }


      if (
        isFiniteNumber(
          trade.maePct
        )
      ) {

        maeValues.push(
          trade.maePct
        );
      }


      /*
       * Capture Ratio平均は
       * CLOSEDだけを対象にする。
       *
       * OPENトレードはまだ途中なので
       * 平均値に混ぜない。
       */
      if (
        trade.status ===
        "CLOSED"
        &&
        isFiniteNumber(
          trade.captureRatio
        )
      ) {

        captureValues.push(
          trade.captureRatio
        );
      }
    }


    const average =
      values => {

        if (
          !values.length
        ) {

          return null;
        }


        return (
          values.reduce(
            (
              sum,
              value
            ) =>
              sum +
              value,

            0
          )
          /
          values.length
        );
      };


    return {

      /*
       * OPENポジションの現在損益も含む
       */
      totalReturnPct:
        (
          totalEquity -
          1
        ) *
        100,


      /*
       * 決済済みのみ
       */
      closedTotalReturnPct:
        (
          closedEquity -
          1
        ) *
        100,


      averageMfePct:
        average(
          mfeValues
        ),


      averageMaePct:
        average(
          maeValues
        ),


      averageCaptureRatio:
        average(
          captureValues
        ),


      closedTrades,


      winningTrades,


      winRate:
        closedTrades >
        0
          ? (
              winningTrades /
              closedTrades *
              100
            )
          : null
    };
  }


  /*
  ============================================================
  Evaluate
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


    let inPosition =
      false;


    let currentTrade =
      null;


    const buySignals =
      [];


    const sellSignals =
      [];


    const trades =
      [];


    /*
     * 前回計算をリセット
     */
    for (
      const row
      of rows
    ) {

      row.buyCondition =
        false;


      row.sellCondition =
        false;


      row.buySignal =
        false;


      row.sellSignal =
        false;


      row.positionState =
        false;
    }


    for (
      let i = 0;

      i <
      rows.length;

      i++
    ) {

      const row =
        rows[i];


      row.buyCondition =
        isBuyCondition(
          row
        );


      row.sellCondition =
        isSellCondition(
          rows,
          i,
          options
        );


      /*
      ========================================================
      FLAT
      ========================================================
      */

      if (
        !inPosition
      ) {

        if (
          row.buyCondition
        ) {

          row.buySignal =
            true;


          row.positionState =
            true;


          inPosition =
            true;


          const signal = {

            type:
              "BUY",

            date:
              row.date,

            price:
              row.close,

            index:
              i,

            trigger:
              row.triggerLine,

            setup:
              row.setupLine,

            trend:
              row.trendLine,

            vcpN:
              row.vcp26
          };


          buySignals.push(
            signal
          );


          currentTrade = {

            entryDate:
              row.date,

            entryPrice:
              row.close,

            entryIndex:
              i,

            exitDate:
              null,

            exitPrice:
              null,

            exitIndex:
              null,

            currentDate:
              null,

            currentPrice:
              null,

            returnPct:
              null,

            mfePct:
              null,

            maePct:
              null,

            captureRatio:
              null,

            status:
              "OPEN"
          };
        }


        continue;
      }


      /*
      ========================================================
      LONG
      ========================================================
      */

      row.positionState =
        true;


      if (
        row.sellCondition
      ) {

        row.sellSignal =
          true;


        sellSignals.push({

          type:
            "SELL",

          date:
            row.date,

          price:
            row.close,

          index:
            i,

          trend:
            row.trendLine,

          trend5:
            rows[
              i -
              5
            ]?.trendLine
            ??
            null,

          vcpN:
            row.vcp26,

          vcpThreshold:
            options.vcpSellThreshold
        });


        if (
          currentTrade
        ) {

          currentTrade.exitDate =
            row.date;


          currentTrade.exitPrice =
            row.close;


          currentTrade.exitIndex =
            i;


          currentTrade.returnPct =
            (
              row.close /
              currentTrade.entryPrice -
              1
            ) *
            100;


          currentTrade.status =
            "CLOSED";


          const stats =
            calculateTradeStats(
              rows,
              currentTrade
            );


          Object.assign(
            currentTrade,
            stats
          );


          trades.push(
            currentTrade
          );
        }


        currentTrade =
          null;


        inPosition =
          false;


        row.positionState =
          false;
      }
    }


    /*
    ==========================================================
    OPEN trade
    ==========================================================
    */

    if (
      currentTrade
    ) {

      const latest =
        rows[
          rows.length -
          1
        ];


      currentTrade.currentDate =
        latest?.date
        ??
        null;


      currentTrade.currentPrice =
        latest?.close
        ??
        null;


      currentTrade.returnPct =
        (
          isFiniteNumber(
            latest?.close
          )
          &&
          isFiniteNumber(
            currentTrade.entryPrice
          )
        )
          ? (
              latest.close /
              currentTrade.entryPrice -
              1
            ) *
            100
          : null;


      const stats =
        calculateTradeStats(
          rows,
          currentTrade
        );


      Object.assign(
        currentTrade,
        stats
      );


      trades.push(
        currentTrade
      );
    }


    const summary =
      calculateSummary(
        trades
      );


    return {

      options,

      buySignals,

      sellSignals,

      trades,

      summary,

      inPosition,

      latestBuy:
        buySignals.length
          ? buySignals[
              buySignals.length -
              1
            ]
          : null,

      latestSell:
        sellSignals.length
          ? sellSignals[
              sellSignals.length -
              1
            ]
          : null
    };
  }


  window.SignalEngine = {

    evaluate,

    isBuyCondition,

    isSellCondition
  };

})();
