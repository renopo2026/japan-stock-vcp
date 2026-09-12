/*
==============================================================
Signal Engine

BUY
  Trigger > Setup > Trend > 0

SELL
  VCP 5MA < VCP 25MA
  AND
  VCP N < vcpSellThreshold を
  BUY後に指定回数観測
  AND
  Trend_t < Trend_t-5

SELLはBUY後だけ有効。

vcpHitOccurrence
  1 = 1回目
  2 = 2回目

バックテスト統計:
  Total Return
  Closed Return
  MFE
  MAE
  Avg Capture (Winners)
  Median Capture
  Win Rate
==============================================================
*/

(function () {

  const DEFAULT_OPTIONS = {

    vcpSellThreshold:
      -0.08,

    vcpHitOccurrence:
      1
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
  Base SELL conditions

  VCPの「何回目か」は別で管理する。
  ============================================================
  */

  function getBaseSellConditions(
    rows,
    index,
    options
  ) {

    if (
      index <
      5
    ) {

      return {

        valid:
          false,

        vcpMaCross:
          false,

        vcpThreshold:
          false,

        trendDecline:
          false
      };
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

      return {

        valid:
          false,

        vcpMaCross:
          false,

        vcpThreshold:
          false,

        trendDecline:
          false
      };
    }


    const vcpMaCross =
      row.vcp26Ma5 <
      row.vcp26Ma25;


    const vcpThreshold =
      row.vcp26 <
      options.vcpSellThreshold;


    const trendDecline =
      row.trendLine <
      row5.trendLine;


    return {

      valid:
        true,

      vcpMaCross,

      vcpThreshold,

      trendDecline
    };
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

        highestPrice:
          null,

        lowestPrice:
          null,

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
  Median helper
  ============================================================
  */

  function median(
    values
  ) {

    const valid =
      values
        .filter(
          isFiniteNumber
        )
        .sort(
          (
            a,
            b
          ) =>
            a -
            b
        );


    if (
      !valid.length
    ) {

      return null;
    }


    const middle =
      Math.floor(
        valid.length /
        2
      );


    if (
      valid.length %
      2 ===
      1
    ) {

      return valid[
        middle
      ];
    }


    return (
      valid[
        middle -
        1
      ]
      +
      valid[
        middle
      ]
    )
    /
    2;
  }


  /*
  ============================================================
  Summary
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

        medianCaptureRatio:
          null,

        captureSampleCount:
          0,

        closedTrades:
          0,

        winningTrades:
          0,

        winRate:
          null
      };
    }


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


    /*
     * Captureは利益が出たCLOSEDトレードだけ。
     */
    const captureWinnerValues =
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


      if (
        trade.status ===
        "CLOSED"
        &&
        isFiniteNumber(
          trade.returnPct
        )
        &&
        trade.returnPct >
        0
        &&
        isFiniteNumber(
          trade.captureRatio
        )
      ) {

        captureWinnerValues.push(
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

      totalReturnPct:
        (
          totalEquity -
          1
        ) *
        100,


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
          captureWinnerValues
        ),


      medianCaptureRatio:
        median(
          captureWinnerValues
        ),


      captureSampleCount:
        captureWinnerValues.length,


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
      Math.max(
        1,
        Math.round(
          Number(
            options.vcpHitOccurrence
          )
          ||
          1
        )
      );


    for (
      const row
      of rows
    ) {

      row.buySignal =
        false;


      row.sellSignal =
        false;


      row.vcpHitCountAfterBuy =
        0;


      row.sellComponents =
        null;
    }


    const trades =
      [];


    const signals =
      [];


    let position =
      "FLAT";


    let activeTrade =
      null;


    let vcpHitCountAfterBuy =
      0;


    let lastBuy =
      null;


    let lastSell =
      null;


    for (
      let i = 0;

      i <
        rows.length;

      i++
    ) {

      const row =
        rows[i];


      /*
      ========================================================
      FLAT
      ========================================================
      */

      if (
        position ===
        "FLAT"
      ) {

        if (
          isBuyCondition(
            row
          )
        ) {

          row.buySignal =
            true;


          position =
            "LONG";


          vcpHitCountAfterBuy =
            0;


          row.vcpHitCountAfterBuy =
            0;


          activeTrade = {

            status:
              "OPEN",

            entryIndex:
              i,

            entryDate:
              row.date,

            entryPrice:
              row.close,

            exitIndex:
              null,

            exitDate:
              null,

            exitPrice:
              null,

            currentIndex:
              i,

            currentDate:
              row.date,

            currentPrice:
              row.close,

            returnPct:
              0,

            vcpSellThreshold:
              options.vcpSellThreshold,

            vcpHitOccurrenceSetting:
              options.vcpHitOccurrence,

            vcpHitCountAtExit:
              null,

            sellComponents:
              null
          };


          trades.push(
            activeTrade
          );


          const signal = {

            type:
              "BUY",

            index:
              i,

            date:
              row.date,

            price:
              row.close
          };


          signals.push(
            signal
          );


          lastBuy =
            signal;


          /*
           * BUY当日は
           * VCP threshold hit の
           * カウント対象にしない。
           */
          continue;
        }


        continue;
      }


      /*
      ========================================================
      LONG
      ========================================================
      */

      activeTrade.currentIndex =
        i;


      activeTrade.currentDate =
        row.date;


      activeTrade.currentPrice =
        row.close;


      if (
        isFiniteNumber(
          activeTrade.entryPrice
        )
        &&
        isFiniteNumber(
          row.close
        )
      ) {

        activeTrade.returnPct =
          (
            row.close /
            activeTrade.entryPrice -
            1
          )
          *
          100;
      }


      const base =
        getBaseSellConditions(
          rows,
          i,
          options
        );


      /*
       * BUY後の日で、
       *
       * VCP N < threshold
       *
       * になった営業日を数える。
       *
       * 「クロスした回数」ではなく
       * 「条件を満たした日数」。
       */
      if (
        base.valid
        &&
        base.vcpThreshold
      ) {

        vcpHitCountAfterBuy++;
      }


      row.vcpHitCountAfterBuy =
        vcpHitCountAfterBuy;


      const vcpOccurrenceOk =
        vcpHitCountAfterBuy >=
        options.vcpHitOccurrence;


      row.sellComponents = {

        valid:
          base.valid,

        vcpMaCross:
          base.vcpMaCross,

        vcpThresholdHit:
          base.vcpThreshold,

        vcpOccurrenceOk,

        trendDecline:
          base.trendDecline,

        vcpHitCount:
          vcpHitCountAfterBuy,

        vcpHitOccurrence:
          options.vcpHitOccurrence,

        vcpSellThreshold:
          options.vcpSellThreshold
      };


      const sell =
        (
          base.valid

          &&

          base.vcpMaCross

          &&

          base.vcpThreshold

          &&

          vcpOccurrenceOk

          &&

          base.trendDecline
        );


      if (
        !sell
      ) {

        continue;
      }


      /*
      ========================================================
      SELL
      ========================================================
      */

      row.sellSignal =
        true;


      activeTrade.status =
        "CLOSED";


      activeTrade.exitIndex =
        i;


      activeTrade.exitDate =
        row.date;


      activeTrade.exitPrice =
        row.close;


      activeTrade.currentIndex =
        i;


      activeTrade.currentDate =
        row.date;


      activeTrade.currentPrice =
        row.close;


      activeTrade.returnPct =
        (
          activeTrade.exitPrice /
          activeTrade.entryPrice -
          1
        )
        *
        100;


      activeTrade.vcpHitCountAtExit =
        vcpHitCountAfterBuy;


      activeTrade.sellComponents =
        {
          ...row.sellComponents
        };


      const signal = {

        type:
          "SELL",

        index:
          i,

        date:
          row.date,

        price:
          row.close,

        vcpHitOccurrence:
          options.vcpHitOccurrence,

        vcpHitCount:
          vcpHitCountAfterBuy,

        vcpSellThreshold:
          options.vcpSellThreshold,

        sellComponents:
          {
            ...row.sellComponents
          }
      };


      signals.push(
        signal
      );


      lastSell =
        signal;


      position =
        "FLAT";


      activeTrade =
        null;


      vcpHitCountAfterBuy =
        0;
    }


    /*
    ==========================================================
    Trade stats
    ==========================================================
    */

    for (
      const trade
      of trades
    ) {

      const stats =
        calculateTradeStats(
          rows,
          trade
        );


      Object.assign(
        trade,
        stats
      );
    }


    const summary =
      calculateSummary(
        trades
      );


    /*
    ==========================================================
    Current state
    ==========================================================
    */

    const latest =
      rows.length
        ? rows[
            rows.length -
            1
          ]
        : null;


    const currentTrade =
      trades.length
        &&
        trades[
          trades.length -
          1
        ].status ===
        "OPEN"

        ? trades[
            trades.length -
            1
          ]

        : null;


    return {

      options,

      state:
        position,

      latest,

      signals,

      trades,

      currentTrade,

      lastBuy,

      lastSell,

      summary
    };
  }

 /*
==============================================================
Public API
==============================================================
*/

window.SignalEngine = {

  evaluate,

  isBuyCondition,

  getSellComponents(
    rows,
    index,
    options = {},
    vcpHitCount = 0
  ) {

    const mergedOptions = {

      ...DEFAULT_OPTIONS,
      ...options

    };


    mergedOptions.vcpHitOccurrence =
      Math.max(
        1,
        Math.round(
          Number(
            mergedOptions.vcpHitOccurrence
          )
          ||
          1
        )
      );


    const base =
      getBaseSellConditions(
        rows,
        index,
        mergedOptions
      );


    const vcpOccurrenceOk =
      vcpHitCount >=
      mergedOptions.vcpHitOccurrence;


    return {

      valid:
        base.valid,

      vcpMaCross:
        base.vcpMaCross,

      vcpThresholdHit:
        base.vcpThreshold,

      vcpOccurrenceOk,

      trendDecline:
        base.trendDecline,

      vcpHitCount,

      vcpHitOccurrence:
        mergedOptions.vcpHitOccurrence,

      vcpSellThreshold:
        mergedOptions.vcpSellThreshold
    };
  },


  isSellCondition(
    rows,
    index,
    options = {},
    vcpHitCount = 0
  ) {

    const components =
      this.getSellComponents(
        rows,
        index,
        options,
        vcpHitCount
      );


    return (
      components.valid

      &&

      components.vcpMaCross

      &&

      components.vcpThresholdHit

      &&

      components.vcpOccurrenceOk

      &&

      components.trendDecline
    );
  }
};

})();
