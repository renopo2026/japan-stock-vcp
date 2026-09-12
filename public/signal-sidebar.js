/*
==============================================================
Signal Sidebar

サイドバー表示だけを担当する。
売買判定はしない。

入力:
  result              SignalEngine.evaluate() の戻り値
  latest              最新の株価row
  threshold           VCP SELL閾値
  onThresholdChange   閾値変更時のコールバック
  formatNumber        index.html側の数値整形関数
==============================================================
*/

(function () {

  let sliderTimer =
    null;


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


  function pctText(
    value,
    digits = 2
  ) {

    if (
      !isFiniteNumber(
        value
      )
    ) {

      return "-";
    }


    return (
      `${value >= 0 ? "+" : ""}`
      +
      `${value.toFixed(
        digits
      )}%`
    );
  }


  function pctClass(
    value
  ) {

    if (
      !isFiniteNumber(
        value
      )
    ) {

      return "";
    }


    return value >= 0
      ? "signal-return-positive"
      : "signal-return-negative";
  }


  function helpIcon(
    text
  ) {

    return `
      <span
        class="info-help"
        tabindex="0"
        aria-label="${text}"
      >
        i

        <span class="info-help-tooltip">
          ${text}
        </span>
      </span>
    `;
  }


  function installThresholdSlider({
    threshold,
    onThresholdChange
  }) {

    const slider =
      document.getElementById(
        "vcpSellThresholdSlider"
      );


    if (
      !slider
    ) {

      return;
    }


    let currentValue =
      threshold;


    const applyValue =
      value => {

        if (
          !Number.isFinite(
            value
          )
        ) {

          return;
        }


        const normalized =
          Math.max(
            -1,

            Math.min(
              0,

              Math.round(
                value *
                100
              ) /
              100
            )
          );


        currentValue =
          normalized;


        slider.value =
          normalized.toFixed(
            2
          );


        const valueLabel =
          document.getElementById(
            "vcpThresholdValue"
          );


        if (
          valueLabel
        ) {

          valueLabel.textContent =
            normalized.toFixed(
              2
            );
        }


        const conditionLabel =
          document.getElementById(
            "vcpThresholdCondition"
          );


        if (
          conditionLabel
        ) {

          conditionLabel.textContent =
            `VCP N < ${normalized.toFixed(2)}`;
        }


        clearTimeout(
          sliderTimer
        );


        sliderTimer =
          setTimeout(

            () => {

              if (
                typeof onThresholdChange ===
                "function"
              ) {

                onThresholdChange(
                  normalized
                );
              }
            },

            120
          );
      };


    slider.addEventListener(
      "input",

      event => {

        applyValue(
          Number(
            event.target.value
          )
        );
      }
    );


    slider.addEventListener(
      "keydown",

      event => {

        if (
          event.key !==
          "ArrowLeft"
          &&
          event.key !==
          "ArrowRight"
        ) {

          return;
        }


        event.preventDefault();


        const direction =
          event.key ===
          "ArrowRight"
            ? 1
            : -1;


        applyValue(
          currentValue +
          direction *
          0.01
        );
      }
    );
  }


  function render({
    result,
    latest,
    threshold = -0.08,
    onThresholdChange,
    formatNumber
  }) {

    const container =
      document.getElementById(
        "signalSidebarBody"
      );


    if (
      !container
    ) {

      return;
    }


    if (
      !result
      ||
      !latest
    ) {

      container.textContent =
        "シグナルなし";

      return;
    }


    const numberText =
      typeof formatNumber ===
      "function"
        ? formatNumber
        : (
            value,
            digits = 0
          ) =>
            isFiniteNumber(
              value
            )
              ? value.toFixed(
                  digits
                )
              : "-";


    const summary =
      result.summary
      ||
      {};


    const latestTrade =
      result.trades?.length
        ? result.trades[
            result.trades.length -
            1
          ]
        : null;


    const stateText =
      result.inPosition
        ? "LONG"
        : "FLAT";


    const stateClass =
      result.inPosition
        ? "long"
        : "flat";


    const latestBuy =
      result.latestBuy;


    const latestSell =
      result.latestSell;


    let tradeHtml =
      "";


    if (
      latestTrade
    ) {

      tradeHtml =
        `
        <div class="signal-section">

          <div class="signal-section-title">
            CURRENT / LAST TRADE
          </div>


          <div class="signal-main-value">
            ${latestTrade.status === "OPEN" ? "OPEN" : "CLOSED"}
          </div>


          <div class="signal-sub-value">
            BUY ${latestTrade.entryDate}
            @ ${numberText(latestTrade.entryPrice, 2)}
          </div>


          ${
            latestTrade.exitDate
              ? `
                <div class="signal-sub-value">
                  SELL ${latestTrade.exitDate}
                  @ ${numberText(latestTrade.exitPrice, 2)}
                </div>
              `
              : ""
          }


          <div class="signal-metric-row">
            <span class="signal-metric-label">
              Return
              ${helpIcon(
                "このトレード単体の損益率です。BUY価格からSELL価格までの変化率を表示します。OPEN中の場合は現在の終値までの含み損益です。"
              )}
            </span>

            <span class="signal-metric-value ${pctClass(latestTrade.returnPct)}">
              ${pctText(latestTrade.returnPct)}
            </span>
          </div>


          <div class="signal-metric-row">
            <span class="signal-metric-label">
              MFE
              ${helpIcon(
                "Maximum Favorable Excursion。BUY後からSELLまでの間に、最大でどれだけ含み益が出たかを示します。日中高値ベースで計算します。"
              )}
            </span>

            <span class="signal-metric-value">
              ${pctText(latestTrade.mfePct)}
            </span>
          </div>


          <div class="signal-metric-row">
            <span class="signal-metric-label">
              MAE
              ${helpIcon(
                "Maximum Adverse Excursion。BUY後からSELLまでの間に、最大でどれだけ含み損が出たかを示します。日中安値ベースで計算します。"
              )}
            </span>

            <span class="signal-metric-value">
              ${pctText(latestTrade.maePct)}
            </span>
          </div>


          <div class="signal-metric-row">
            <span class="signal-metric-label">
              Capture Ratio
              ${helpIcon(
                "BUY後に得られた最大含み益のうち、最終的にどれだけを実現利益として残せたかを示します。100%なら最大高値付近で決済、0%なら買値付近、マイナスなら買値より下で決済しています。"
              )}
            </span>

            <span class="signal-metric-value">
              ${
                isFiniteNumber(
                  latestTrade.captureRatio
                )
                  ? `${latestTrade.captureRatio.toFixed(1)}%`
                  : "-"
              }
            </span>
          </div>

        </div>
        `;
    }


    container.innerHTML =
      `
      <div class="signal-state ${stateClass}">
        ${stateText}
      </div>


      <div class="signal-section">

        <div class="signal-section-title">
          STRATEGY PERFORMANCE
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Total Return
            ${helpIcon(
              "全トレードのリターンを順番に複利でつないだ総リターンです。現在OPEN中のポジションがある場合は、その時価評価損益も含みます。"
            )}
          </span>

          <span class="signal-metric-value ${pctClass(summary.totalReturnPct)}">
            ${pctText(summary.totalReturnPct)}
          </span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Closed Return
            ${helpIcon(
              "決済済みトレードだけを複利でつないだ総リターンです。現在OPEN中のポジションは含みません。"
            )}
          </span>

          <span class="signal-metric-value ${pctClass(summary.closedTotalReturnPct)}">
            ${pctText(summary.closedTotalReturnPct)}
          </span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Closed Trades
            ${helpIcon(
              "BUYとSELLが両方成立し、決済まで完了したトレードの回数です。OPEN中のポジションは数えません。"
            )}
          </span>

          <span class="signal-metric-value">
            ${summary.closedTrades ?? 0}
          </span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Win Rate
            ${helpIcon(
              "決済済みトレードのうち、Returnがプラスになったトレードの割合です。"
            )}
          </span>

          <span class="signal-metric-value">
            ${
              isFiniteNumber(
                summary.winRate
              )
                ? `${summary.winRate.toFixed(1)}%`
                : "-"
            }
          </span>
        </div>

      </div>


      <div class="signal-section">

        <div class="signal-section-title">
          AVG TRADE STATS
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            MFE
            ${helpIcon(
              "各トレードのMaximum Favorable Excursionの平均です。BUY後に平均して最大何％まで含み益が伸びたかを示します。"
            )}
          </span>

          <span class="signal-metric-value">
            ${pctText(summary.averageMfePct)}
          </span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            MAE
            ${helpIcon(
              "各トレードのMaximum Adverse Excursionの平均です。BUY後に平均して最大何％まで逆行したかを示します。"
            )}
          </span>

          <span class="signal-metric-value">
            ${pctText(summary.averageMaePct)}
          </span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Capture Ratio
            ${helpIcon(
              "決済済みトレードについて、最大含み益のうち最終的に何％を利益として残せたかの平均です。大きなトレンドをどれだけ取り切れているかを見る指標です。"
            )}
          </span>

          <span class="signal-metric-value">
            ${
              isFiniteNumber(
                summary.averageCaptureRatio
              )
                ? `${summary.averageCaptureRatio.toFixed(1)}%`
                : "-"
            }
          </span>
        </div>

      </div>


      <div class="signal-section">

        <div class="signal-section-title">
          VCP SELL THRESHOLD
        </div>


        <div
          id="vcpThresholdValue"
          class="signal-main-value"
        >
          ${threshold.toFixed(2)}
        </div>


        <input
          id="vcpSellThresholdSlider"
          class="signal-slider"
          type="range"
          min="-1"
          max="0"
          step="0.01"
          value="${threshold}"
          aria-label="VCP SELL threshold"
        >


        <div class="signal-slider-scale">
          <span>-1.00</span>
          <span>0.00</span>
        </div>


        <div class="signal-threshold-note">
          SELL条件：
          <br>
          VCP 5MA &lt; VCP 25MA
          <br>
          AND
          <br>
          <span id="vcpThresholdCondition">
            VCP N &lt; ${threshold.toFixed(2)}
          </span>
          <br>
          AND
          <br>
          Trend t &lt; Trend t-5
          <br><br>
          スライダーを選択した状態で
          ← / → キーを押すと0.01ずつ変更できます。
        </div>

      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          LATEST SIGNAL
        </div>

        <div class="signal-main-value">
          ${
            latest.buySignal
              ? "▲ BUY"
              : latest.sellSignal
                ? "▼ SELL"
                : "—"
          }
        </div>

        <div class="signal-sub-value">
          ${latest.date}
        </div>
      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          LAST BUY
        </div>

        <div class="signal-main-value">
          ${latestBuy ? numberText(latestBuy.price, 2) : "-"}
        </div>

        <div class="signal-sub-value">
          ${latestBuy?.date ?? "-"}
        </div>
      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          LAST SELL
        </div>

        <div class="signal-main-value">
          ${latestSell ? numberText(latestSell.price, 2) : "-"}
        </div>

        <div class="signal-sub-value">
          ${latestSell?.date ?? "-"}
        </div>
      </div>


      ${tradeHtml}


      <div class="signal-section">

        <div class="signal-section-title">
          CURRENT FACTORS
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">Trigger</span>
          <span class="signal-metric-value">${numberText(latest.triggerLine, 3)}</span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">Setup</span>
          <span class="signal-metric-value">${numberText(latest.setupLine, 3)}</span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">Trend</span>
          <span class="signal-metric-value">${numberText(latest.trendLine, 3)}</span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">VCP N</span>
          <span class="signal-metric-value">${numberText(latest.vcp26, 4)}</span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">VCP 5MA</span>
          <span class="signal-metric-value">${numberText(latest.vcp26Ma5, 4)}</span>
        </div>


        <div class="signal-metric-row">
          <span class="signal-metric-label">VCP 25MA</span>
          <span class="signal-metric-value">${numberText(latest.vcp26Ma25, 4)}</span>
        </div>

      </div>
      `;


    installThresholdSlider({
      threshold,
      onThresholdChange
    });
  }


  window.SignalSidebar = {
    render
  };

})();
