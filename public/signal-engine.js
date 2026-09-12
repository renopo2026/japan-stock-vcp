/*
==============================================================
Signal Engine

売買シグナル判定だけを担当する。

チャート描画・TOPIX取得・VCP計算などは
index.html側で担当する。

入力:
  rows

必要なrow項目:
  date
  close
  vcp26
  vcp26Ma5
  vcp26Ma25
  trendLine
  setupLine
  triggerLine

出力:
  BUY / SELLの日付
  トレード一覧
  現在のポジション状態
==============================================================
*/

(function () {

  function isFiniteNumber(value) {
    return (
      typeof value === "number" &&
      Number.isFinite(value)
    );
  }


  /*
  ============================================================
  BUY条件

  Trigger > Setup > Trend > 0
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
  SELL条件

  VCP 5MA < VCP 25MA

  AND

  VCP N < 0

  AND

  Trend_t < Trend_t-5
  ============================================================
  */

  function isSellCondition(
    rows,
    index
  ) {

    if (
      index < 5
    ) {
      return false;
    }


    const row =
      rows[index];


    const row5 =
      rows[index - 5];


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
      0

      &&

      row.trendLine <
      row5.trendLine
    );
  }


  /*
  ============================================================
  メイン判定

  State Machine

  FLAT
    ↓ BUY
  LONG
    ↓ SELL
  FLAT

  SELLはLONG時しか出さない。
  ============================================================
  */

  function evaluate(
    rows
  ) {

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
     * 既存シグナルを初期化。
     */
    for (
      const row of rows
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
      i < rows.length;
      i++
    ) {

      const row =
        rows[i];


      /*
       * 条件そのものは
       * 保有状態に関係なく計算しておく。
       */
      row.buyCondition =
        isBuyCondition(
          row
        );


      row.sellCondition =
        isSellCondition(
          rows,
          i
        );


      /*
      ========================================================
      未保有
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
              row.vcp26,

            vcp5Ma:
              row.vcp26Ma5,

            vcp25Ma:
              row.vcp26Ma25
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

            returnPct:
              null,

            status:
              "OPEN"
          };
        }

        continue;
      }


      /*
      ========================================================
      保有中
      ========================================================
      */

      row.positionState =
        true;


      /*
       * BUY済みなので
       * SELL条件を評価する。
       */
      if (
        row.sellCondition
      ) {

        row.sellSignal =
          true;


        const signal = {
          type:
            "SELL",

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

          trend5:
            rows[i - 5]
              ?.trendLine ??
            null,

          vcpN:
            row.vcp26,

          vcp5Ma:
            row.vcp26Ma5,

          vcp25Ma:
            row.vcp26Ma25
        };


        sellSignals.push(
          signal
        );


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


          trades.push(
            currentTrade
          );
        }


        currentTrade =
          null;


        inPosition =
          false;


        /*
         * SELLした当日は
         * positionStateをfalseにする。
         */
        row.positionState =
          false;
      }
    }


    /*
     * 最後までSELLされていなければ
     * OPENトレードとして追加。
     */
    if (
      currentTrade
    ) {

      const latest =
        rows[
          rows.length - 1
        ];


      currentTrade.currentDate =
        latest?.date ??
        null;


      currentTrade.currentPrice =
        latest?.close ??
        null;


      currentTrade.returnPct =
        (
          isFiniteNumber(
            latest?.close
          ) &&
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


      trades.push(
        currentTrade
      );
    }


    return {

      buySignals,

      sellSignals,

      trades,

      inPosition,

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
          : null
    };
  }


  /*
  ============================================================
  外部公開
  ============================================================
  */

  window.SignalEngine = {

    evaluate,

    isBuyCondition,

    isSellCondition
  };

})();
