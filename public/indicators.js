/*
==============================================================
Indicators

株価・VCP・RCI・ATR・TOPIX相対強度・Trend / Setup / Trigger
の計算だけを担当する。

売買判定は signal-engine.js、UIは signal-sidebar.js に任せる。
==============================================================
*/

(function () {

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


function toNumber(
  value
) {

  if (
    value === null
    ||
    value === undefined
    ||
    value === ""
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function percentileInc(
  values,
  p
) {

  if (
    !values.length
    ||
    !values.every(
      isFiniteNumber
    )
  ) {

    return null;
  }


  const sorted =
    [
      ...values
    ].sort(
      (
        a,
        b
      ) =>
        a -
        b
    );


  if (
    sorted.length ===
    1
  ) {

    return sorted[0];
  }


  const rank =
    p *
    (
      sorted.length -
      1
    );


  const lower =
    Math.floor(
      rank
    );


  const upper =
    Math.ceil(
      rank
    );


  if (
    lower ===
    upper
  ) {

    return sorted[
      lower
    ];
  }


  const weight =
    rank -
    lower;


  return (
    sorted[lower] *
    (
      1 -
      weight
    )
    +
    sorted[upper] *
    weight
  );
}


/*
==============================================================
Simple Moving Average
==============================================================
*/

function calculateSma(
  rows,
  key,
  period
) {

  const result =
    new Array(
      rows.length
    ).fill(
      null
    );


  for (
    let i =
      period -
      1;

    i <
      rows.length;

    i++
  ) {

    const values =
      rows
        .slice(
          i -
          period +
          1,

          i +
          1
        )
        .map(
          row =>
            row[key]
        );


    if (
      values.every(
        isFiniteNumber
      )
    ) {

      result[i] =
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
        period;
    }
  }


  return result;
}


function calculateSmaValues(
  values,
  period
) {

  const result =
    new Array(
      values.length
    ).fill(
      null
    );


  let sum =
    0;


  let validCount =
    0;


  for (
    let i = 0;

    i <
      values.length;

    i++
  ) {

    const value =
      values[i];


    if (
      isFiniteNumber(
        value
      )
    ) {

      sum +=
        value;

      validCount++;
    }


    if (
      i >=
      period
    ) {

      const old =
        values[
          i -
          period
        ];


      if (
        isFiniteNumber(
          old
        )
      ) {

        sum -=
          old;

        validCount--;
      }
    }


    if (
      i >=
      period -
      1
      &&
      validCount ===
      period
    ) {

      result[i] =
        sum /
        period;
    }
  }


  return result;
}


/*
==============================================================
RCI
==============================================================
*/

function calculateRci(
  rows,
  period
) {

  const result =
    new Array(
      rows.length
    ).fill(
      null
    );


  for (
    let i =
      period -
      1;

    i <
      rows.length;

    i++
  ) {

    const prices =
      rows
        .slice(
          i -
          period +
          1,

          i +
          1
        )
        .map(
          row =>
            row.close
        );


    if (
      !prices.every(
        isFiniteNumber
      )
    ) {

      continue;
    }


    const sorted =
      prices
        .map(
          (
            value,
            index
          ) => ({

            value,
            index

          })
        )
        .sort(
          (
            a,
            b
          ) =>
            a.value -
            b.value
        );


    const priceRanks =
      new Array(
        period
      );


    for (
      let p = 0;

      p <
      period;
    ) {

      let q =
        p +
        1;


      while (
        q <
        period
        &&
        sorted[q].value ===
        sorted[p].value
      ) {

        q++;
      }


      const averageRank =
        (
          (
            p +
            1
          )
          +
          q
        )
        /
        2;


      for (
        let k = p;

        k <
        q;

        k++
      ) {

        priceRanks[
          sorted[k].index
        ] =
          averageRank;
      }


      p =
        q;
    }


    let sumD2 =
      0;


    for (
      let j = 0;

      j <
      period;

      j++
    ) {

      const timeRank =
        j +
        1;


      const difference =
        timeRank -
        priceRanks[j];


      sumD2 +=
        difference *
        difference;
    }


    result[i] =
      (
        1 -
        (
          6 *
          sumD2
        )
        /
        (
          period *
          (
            period *
            period -
            1
          )
        )
      )
      *
      100;
  }


  return result;
}


/*
==============================================================
Rolling Z-score
==============================================================
*/

function calculateRollingZ(
  values,
  period = 252,
  minValid = 60
) {

  const result =
    new Array(
      values.length
    ).fill(
      null
    );


  for (
    let i = 0;

    i <
      values.length;

    i++
  ) {

    const start =
      Math.max(
        0,

        i -
        period +
        1
      );


    const window =
      values
        .slice(
          start,

          i +
          1
        )
        .filter(
          isFiniteNumber
        );


    if (
      window.length <
      Math.min(
        minValid,
        period
      )
    ) {

      continue;
    }


    const mean =
      window.reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,

        0
      )
      /
      window.length;


    const variance =
      window.reduce(
        (
          sum,
          value
        ) =>
          sum +
          (
            value -
            mean
          )
          *
          (
            value -
            mean
          ),

        0
      )
      /
      window.length;


    const sd =
      Math.sqrt(
        variance
      );


    if (
      !(
        sd >
        0
      )
      ||
      !isFiniteNumber(
        values[i]
      )
    ) {

      continue;
    }


    result[i] =
      (
        values[i] -
        mean
      )
      /
      sd;
  }


  return result;
}


function smoothZ(
  z
) {

  return isFiniteNumber(
    z
  )
    ? Math.tanh(
        z /
        2
      )
    : null;
}


/*
==============================================================
ATR
==============================================================
*/

function calculateAtr(
  rows,
  period
) {

  const trueRange =
    new Array(
      rows.length
    ).fill(
      null
    );


  for (
    let i = 0;

    i <
      rows.length;

    i++
  ) {

    if (
      !isFiniteNumber(
        rows[i].high
      )
      ||
      !isFiniteNumber(
        rows[i].low
      )
    ) {

      continue;
    }


    if (
      i ===
      0
      ||
      !isFiniteNumber(
        rows[
          i -
          1
        ].close
      )
    ) {

      trueRange[i] =
        rows[i].high -
        rows[i].low;


      continue;
    }


    trueRange[i] =
      Math.max(

        rows[i].high -
        rows[i].low,

        Math.abs(
          rows[i].high -
          rows[
            i -
            1
          ].close
        ),

        Math.abs(
          rows[i].low -
          rows[
            i -
            1
          ].close
        )
      );
  }


  return calculateSmaValues(
    trueRange,
    period
  );
}


/*
==============================================================
Indicators

ここでは指標だけを計算する。

BUY / SELL判定は
signal-engine.jsに任せる。
==============================================================
*/

function prepareIndicators(
  rows,
  topixRows = []
) {


  /*
  ============================================================
  52週高値・既存VCP
  ============================================================
  */

  for (
    let i = 0;

    i <
      rows.length;

    i++
  ) {


    /*
     * 表示用52週高値
     */
    if (
      i >=
      251
    ) {

      let maxHigh =
        -Infinity;


      for (
        let j =
          i -
          251;

        j <=
          i;

        j++
      ) {

        maxHigh =
          Math.max(
            maxHigh,
            rows[j].high
          );
      }


      rows[i].high52 =
        maxHigh;

    } else {

      rows[i].high52 =
        null;
    }


    /*
     * シグナル計算用52週高値
     *
     * 当日除外。
     */
    if (
      i >=
      252
    ) {

      let maxHighPrev =
        -Infinity;


      for (
        let j =
          i -
          252;

        j <=
          i -
          1;

        j++
      ) {

        maxHighPrev =
          Math.max(
            maxHighPrev,
            rows[j].high
          );
      }


      rows[i].high52Prev =
        maxHighPrev;

    } else {

      rows[i].high52Prev =
        null;
    }


    /*
     * 将来的なBUY条件変更用。
     */
    if (
      i >=
      20
    ) {

      let maxHigh20Prev =
        -Infinity;


      for (
        let j =
          i -
          20;

        j <=
          i -
          1;

        j++
      ) {

        maxHigh20Prev =
          Math.max(
            maxHigh20Prev,
            rows[j].high
          );
      }


      rows[i].high20Prev =
        maxHigh20Prev;

    } else {

      rows[i].high20Prev =
        null;
    }


    if (
      !isFiniteNumber(
        rows[i].vcp26Delta5
      )
      &&
      i >=
      5
      &&
      isFiniteNumber(
        rows[i].vcp26
      )
      &&
      isFiniteNumber(
        rows[
          i -
          5
        ].vcp26
      )
    ) {

      rows[i].vcp26Delta5 =
        rows[i].vcp26 -
        rows[
          i -
          5
        ].vcp26;
    }


    if (
      i >=
      119
    ) {

      const values =
        rows
          .slice(
            i -
            119,

            i +
            1
          )
          .map(
            row =>
              row.vcp26Delta5
          );


      rows[i].deltaP10 =
        percentileInc(
          values,
          .10
        );


      rows[i].deltaP90 =
        percentileInc(
          values,
          .90
        );

    } else {

      rows[i].deltaP10 =
        null;


      rows[i].deltaP90 =
        null;
    }


    const contraction =
      isFiniteNumber(
        rows[i].dailyVcp
      )
      &&
      isFiniteNumber(
        rows[i].dailyVcpP10
      )
      &&
      rows[i].dailyVcp <=
      rows[i].dailyVcpP10;


    /*
     * 旧候補。
     *
     * 現在の売買シグナルには使用しない。
     */
    rows[i].buyCandidate =
      contraction
      &&
      isFiniteNumber(
        rows[i].vcp26Delta5
      )
      &&
      isFiniteNumber(
        rows[i].deltaP90
      )
      &&
      rows[i].vcp26Delta5 >=
      rows[i].deltaP90;


    rows[i].sellCandidate =
      contraction
      &&
      isFiniteNumber(
        rows[i].vcp26Delta5
      )
      &&
      isFiniteNumber(
        rows[i].deltaP10
      )
      &&
      rows[i].vcp26Delta5 <=
      rows[i].deltaP10;
  }


  /*
  ============================================================
  VCP N 5MA / 25MA
  ============================================================
  */

  const vcpMa5 =
    calculateSma(
      rows,
      "vcp26",
      5
    );


  const vcpMa25 =
    calculateSma(
      rows,
      "vcp26",
      25
    );


  for (
    let i = 0;

    i <
      rows.length;

    i++
  ) {

    rows[i].vcp26Ma5 =
      vcpMa5[i];


    rows[i].vcp26Ma25 =
      vcpMa25[i];
  }

  /*
  ============================================================
  Trend / Setup / Trigger
  ============================================================
  */

  const topixCloseByDate =
    new Map(

      (
        topixRows ||
        []
      )
        .filter(
          row =>
            row?.date
            &&
            isFiniteNumber(
              toNumber(
                row.close
              )
            )
        )
        .map(
          row => [

            row.date,

            toNumber(
              row.close
            )

          ]
        )
    );


  const atr10 =
    calculateAtr(
      rows,
      10
    );


  const atr50 =
    calculateAtr(
      rows,
      50
    );


  const volumes =
    rows.map(
      row =>
        toNumber(
          row.volume
        )
    );


  const volMa10 =
    calculateSmaValues(
      volumes,
      10
    );


  const volMa20 =
    calculateSmaValues(
      volumes,
      20
    );


  const volMa50 =
    calculateSmaValues(
      volumes,
      50
    );


  const rci9 =
    calculateRci(
      rows,
      9
    );


  const rci26 =
    calculateRci(
      rows,
      26
    );


  const x52 =
    new Array(
      rows.length
    ).fill(
      null
    );


  const xVcp =
    new Array(
      rows.length
    ).fill(
      null
    );


  const xRci =
    new Array(
      rows.length
    ).fill(
      null
    );


  const xRciSlope =
    new Array(
      rows.length
    ).fill(
      null
    );


  const xVol =
    new Array(
      rows.length
    ).fill(
      null
    );


  const xRs =
    new Array(
      rows.length
    ).fill(
      null
    );


  for (
    let i = 0;

    i <
      rows.length;

    i++
  ) {


    rows[i].rci9 =
      rci9[i];


    rows[i].rci26 =
      rci26[i];


    /*
    ==========================================================
    52週高値Factor
    ==========================================================
    */

    if (
      isFiniteNumber(
        rows[i].close
      )
      &&
      isFiniteNumber(
        rows[i].high52Prev
      )
      &&
      rows[i].close >
      0
      &&
      rows[i].high52Prev >
      0
    ) {

      x52[i] =
        Math.log(

          rows[i].close
          /
          rows[i].high52Prev
        );
    }


    /*
    ==========================================================
    VCP Factor
    ==========================================================
    */

    if (
      isFiniteNumber(
        atr10[i]
      )
      &&
      isFiniteNumber(
        atr50[i]
      )
      &&
      atr10[i] >
      0
      &&
      atr50[i] >
      0
      &&
      i >=
      1
      &&
      isFiniteNumber(
        volMa10[
          i -
          1
        ]
      )
      &&
      isFiniteNumber(
        volMa50[
          i -
          1
        ]
      )
      &&
      volMa10[
        i -
        1
      ] >
      0
      &&
      volMa50[
        i -
        1
      ] >
      0
    ) {

      const priceContraction =
        -Math.log(

          atr10[i]
          /
          atr50[i]
        );


      const volumeContraction =
        -Math.log(

          volMa10[
            i -
            1
          ]
          /
          volMa50[
            i -
            1
          ]
        );


      xVcp[i] =
        (
          priceContraction
          +
          volumeContraction
        )
        /
        2;
    }


    /*
    ==========================================================
    RCI Factor
    ==========================================================
    */

    if (
      isFiniteNumber(
        rci26[i]
      )
      &&
      i >=
      5
      &&
      isFiniteNumber(
        rci9[i]
      )
      &&
      isFiniteNumber(
        rci9[
          i -
          5
        ]
      )
    ) {

      const slope =
        (
          rci9[i]
          -
          rci9[
            i -
            5
          ]
        )
        /
        200;


      xRciSlope[i] =
        slope;


      xRci[i] =
        0.6
        *
        (
          rci26[i]
          /
          100
        )
        +
        0.4
        *
        slope;
    }


    /*
    ==========================================================
    Volume Factor
    ==========================================================
    */

    if (
      i >=
      1
      &&
      isFiniteNumber(
        rows[i].volume
      )
      &&
      rows[i].volume >
      0
      &&
      isFiniteNumber(
        volMa20[
          i -
          1
        ]
      )
      &&
      volMa20[
        i -
          1
      ] >
      0
    ) {

      xVol[i] =
        Math.log(

          rows[i].volume
          /
          volMa20[
            i -
            1
          ]
        );
    }


    /*
    ==========================================================
    TOPIX Relative Strength
    ==========================================================
    */

    if (
      i >=
      60
    ) {

      const topixNow =
        topixCloseByDate.get(
          rows[i].date
        );


      const topix20 =
        topixCloseByDate.get(
          rows[
            i -
            20
          ].date
        );


      const topix60 =
        topixCloseByDate.get(
          rows[
            i -
            60
          ].date
        );


      if (
        isFiniteNumber(
          topixNow
        )
        &&
        isFiniteNumber(
          topix20
        )
        &&
        isFiniteNumber(
          topix60
        )
        &&
        topixNow >
        0
        &&
        topix20 >
        0
        &&
        topix60 >
        0
        &&
        isFiniteNumber(
          rows[
            i -
            20
          ].close
        )
        &&
        isFiniteNumber(
          rows[
            i -
            60
          ].close
        )
        &&
        rows[
          i -
          20
        ].close >
        0
        &&
        rows[
          i -
          60
        ].close >
        0
      ) {

        const stock20 =
          rows[i].close
          /
          rows[
            i -
            20
          ].close
          -
          1;


        const stock60 =
          rows[i].close
          /
          rows[
            i -
            60
          ].close
          -
          1;


        const topixReturn20 =
          topixNow
          /
          topix20
          -
          1;


        const topixReturn60 =
          topixNow
          /
          topix60
          -
          1;


        rows[i].rs20 =
          stock20
          -
          topixReturn20;


        rows[i].rs60 =
          stock60
          -
          topixReturn60;


        xRs[i] =
          0.6 *
          rows[i].rs20
          +
          0.4 *
          rows[i].rs60;

      } else {

        rows[i].rs20 =
          null;


        rows[i].rs60 =
          null;
      }

    } else {

      rows[i].rs20 =
        null;


      rows[i].rs60 =
        null;
    }
  }


  /*
  ============================================================
  Rolling Z-score
  ============================================================
  */

  const z52 =
    calculateRollingZ(
      x52
    );


  const zVcp =
    calculateRollingZ(
      xVcp
    );


  const zRci =
    calculateRollingZ(
      xRci
    );


  const zRciSlope =
    calculateRollingZ(
      xRciSlope
    );


  const zVol =
    calculateRollingZ(
      xVol
    );


  const zRs =
    calculateRollingZ(
      xRs
    );


  /*
  ============================================================
  Smooth transform
  ============================================================
  */

  for (
    let i = 0;

    i <
      rows.length;

    i++
  ) {

    rows[i].factor52 =
      smoothZ(
        z52[i]
      );


    rows[i].factorVcp =
      smoothZ(
        zVcp[i]
      );


    rows[i].factorRci =
      smoothZ(
        zRci[i]
      );


    rows[i].factorRciSlope =
      smoothZ(
        zRciSlope[i]
      );


    rows[i].factorVol =
      smoothZ(
        zVol[i]
      );


    rows[i].factorRs =
      smoothZ(
        zRs[i]
      );

    /*
    ==========================================================
    Trend
    ==========================================================
    */

    rows[i].trendLine =
      isFiniteNumber(
        rows[i].factor52
      )
      &&
      isFiniteNumber(
        rows[i].factorRs
      )
        ? (
            0.5 *
            rows[i].factor52
            +
            0.5 *
            rows[i].factorRs
          )
        : null;


    /*
    ==========================================================
    Setup
    ==========================================================
    */

    rows[i].setupLine =
      isFiniteNumber(
        rows[i].factorVcp
      )
      &&
      isFiniteNumber(
        rows[i].factorRci
      )
        ? (
            0.6 *
            rows[i].factorVcp
            +
            0.4 *
            rows[i].factorRci
          )
        : null;


    /*
    ==========================================================
    Trigger
    ==========================================================
    */

    rows[i].triggerLine =
      isFiniteNumber(
        rows[i].factorVol
      )
      &&
      isFiniteNumber(
        rows[i].factorRciSlope
      )
        ? (
            0.7 *
            rows[i].factorVol
            +
            0.3 *
            rows[i].factorRciSlope
          )
        : null;
  }


  return rows;
}


window.Indicators = {
  prepare: prepareIndicators
};

})();






  
