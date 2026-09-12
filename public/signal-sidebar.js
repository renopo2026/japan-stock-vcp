/*
==============================================================
Signal Sidebar

サイドバー表示だけを担当する。
売買判定はしない。
==============================================================
*/

(function () {

  let sliderTimer = null;


  function isFiniteNumber(value) {
    return (
      typeof value === "number"
      &&
      Number.isFinite(value)
    );
  }


  function pctText(value, digits = 2) {
    if (!isFiniteNumber(value)) {
      return "-";
    }

    return (
      `${value >= 0 ? "+" : ""}`
      +
      `${value.toFixed(digits)}%`
    );
  }


  function pctClass(value) {
    if (!isFiniteNumber(value)) {
      return "";
    }

    return value >= 0
      ? "signal-return-positive"
      : "signal-return-negative";
  }


  function helpIcon(text) {
    const escaped = String(text)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

    return `
      <span
        class="info-help"
        tabindex="0"
        aria-label="${escaped}"
      >
        i
        <span class="info-help-tooltip">
          ${escaped}
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

    if (!slider) {
      return;
    }

    let currentValue = threshold;

    const applyValue = value => {
      if (!Number.isFinite(value)) {
        return;
      }

      const normalized =
        Math.max(
          -1,
          Math.min(
            0,
            Math.round(value * 100) / 100
          )
        );

      currentValue = normalized;
      slider.value = normalized.toFixed(2);

      const valueLabel =
        document.getElementById(
          "vcpThresholdValue"
        );

      if (valueLabel) {
        valueLabel.textContent =
          normalized.toFixed(2);
      }

      const conditionLabel =
        document.getElementById(
          "vcpThresholdCondition"
        );

      if (conditionLabel) {
        conditionLabel.textContent =
          `VCP N < ${normalized.toFixed(2)}`;
      }

      clearTimeout(sliderTimer);

      sliderTimer =
        setTimeout(
          () => {
            if (
              typeof onThresholdChange ===
              "function"
            ) {
              onThresholdChange(normalized);
            }
          },
          120
        );
    };

    slider.addEventListener(
      "input",
      event => {
        applyValue(
          Number(event.target.value)
        );
      }
    );

    slider.addEventListener(
      "keydown",
      event => {
        if (
          event.key !== "ArrowLeft"
          &&
          event.key !== "ArrowRight"
        ) {
          return;
        }

        event.preventDefault();

        const direction =
          event.key === "ArrowRight"
            ? 1
            : -1;

        applyValue(
          currentValue +
          direction * 0.01
        );
      }
    );
  }


  function installOccurrenceRadios({
    occurrence,
    onOccurrenceChange
  }) {
    const radios =
      document.querySelectorAll(
        'input[name="vcpHitOccurrence"]'
      );

    radios.forEach(radio => {
      radio.addEventListener(
        "change",
        event => {
          if (!event.target.checked) {
            return;
          }

          const value =
            Number(event.target.value) === 2
              ? 2
              : 1;

          if (
            typeof onOccurrenceChange ===
            "function"
          ) {
            onOccurrenceChange(value);
          }
        }
      );
    });
  }


  function buildTradingRecord({
    trades,
    formatNumber,
    occurrence
  }) {
    const list =
      Array.isArray(trades)
        ? trades
        : [];

    if (!list.length) {
      return `
        <details class="trade-records">
          <summary>
            TRADING RECORD (0)
          </summary>
          <div class="trade-record-empty">
            まだトレード記録はありません。
          </div>
        </details>
      `;
    }

    const cards = list
      .map(
        (trade, index) => {
          const capture =
            isFiniteNumber(trade.captureRatio)
              ? `${trade.captureRatio.toFixed(1)}%`
              : "-";

          const statusClass =
            trade.status === "OPEN"
              ? "open"
              : "closed";

          const exitText =
            trade.status === "OPEN"
              ? `${trade.currentDate ?? "-"} @ ${formatNumber(trade.currentPrice, 2)}`
              : `${trade.exitDate ?? "-"} @ ${formatNumber(trade.exitPrice, 2)}`;

          return `
            <div class="trade-record-card">
              <div class="trade-record-head">
                <strong>#${index + 1}</strong>
                <span class="trade-record-status ${statusClass}">
                  ${trade.status}
                </span>
              </div>

              <div class="trade-record-line">
                <span>BUY</span>
                <strong>
                  ${trade.entryDate} @ ${formatNumber(trade.entryPrice, 2)}
                </strong>
              </div>

              <div class="trade-record-line">
                <span>${trade.status === "OPEN" ? "NOW" : "SELL"}</span>
                <strong>${exitText}</strong>
              </div>

              <div class="trade-record-grid">
                <div>
                  <span>Return</span>
                  <strong class="${pctClass(trade.returnPct)}">
                    ${pctText(trade.returnPct)}
                  </strong>
                </div>

                <div>
                  <span>MFE</span>
                  <strong>${pctText(trade.mfePct)}</strong>
                </div>

                <div>
                  <span>MAE</span>
                  <strong>${pctText(trade.maePct)}</strong>
                </div>

                <div>
                  <span>Capture</span>
                  <strong>${capture}</strong>
                </div>
              </div>

              <div class="trade-record-foot">
                VCP判定：${trade.vcpHitOccurrenceSetting ?? occurrence}回目
                ／
                判定時カウント：${trade.vcpHitCountAtExit ?? 0}
              </div>
            </div>
          `;
        }
      )
      .join("");

    return `
      <details class="trade-records">
        <summary>
          TRADING RECORD (${list.length})
        </summary>
        <div class="trade-record-list">
          ${cards}
        </div>
      </details>
    `;
  }


  function render({
    result,
    latest,
    threshold = -0.08,
    occurrence = 1,
    onThresholdChange,
    onOccurrenceChange,
    formatNumber
  }) {
    const container =
      document.getElementById(
        "signalSidebarBody"
      );

    if (!container) {
      return;
    }

    if (!result || !latest) {
      container.textContent =
        "シグナルなし";
      return;
    }

    const numberText =
      typeof formatNumber === "function"
        ? formatNumber
        : (
            value,
            digits = 0
          ) =>
            isFiniteNumber(value)
              ? value.toFixed(digits)
              : "-";

    const summary = result.summary || {};

    const latestTrade =
      result.trades?.length
        ? result.trades[
            result.trades.length - 1
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

    const latestBuy = result.latestBuy;
    const latestSell = result.latestSell;

    const normalizedOccurrence =
      Number(occurrence) === 2
        ? 2
        : 1;

    let tradeHtml = "";

    if (latestTrade) {
      tradeHtml = `
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
                "このトレード単体の損益率です。OPEN中の場合は現在の終値までの含み損益です。"
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
                "Maximum Favorable Excursion。BUY後からSELLまでの間に最大でどれだけ含み益が出たか。日中高値ベースです。"
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
                "Maximum Adverse Excursion。BUY後からSELLまでの間に最大でどれだけ含み損が出たか。日中安値ベースです。"
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
                "このトレードの最大含み益のうち、最終的にどれだけを利益として残せたか。負けトレードではマイナス100%未満になることもあります。"
              )}
            </span>
            <span class="signal-metric-value">
              ${
                isFiniteNumber(latestTrade.captureRatio)
                  ? `${latestTrade.captureRatio.toFixed(1)}%`
                  : "-"
              }
            </span>
          </div>

        </div>
      `;
    }

    const recordHtml =
      buildTradingRecord({
        trades: result.trades,
        formatNumber: numberText,
        occurrence: normalizedOccurrence
      });

    container.innerHTML = `
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
              "全トレードのリターンを順番に複利でつないだ総リターンです。OPEN中のポジションがあれば時価評価損益も含みます。"
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
              "決済済みトレードだけを複利でつないだ総リターンです。OPEN中のポジションは含みません。"
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
              "BUYとSELLが成立し、決済まで完了したトレード数です。"
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
              "決済済みトレードのうち、Returnがプラスだった割合です。"
            )}
          </span>
          <span class="signal-metric-value">
            ${
              isFiniteNumber(summary.winRate)
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
              "各トレードのMFE平均です。BUY後に平均して最大何％まで含み益が伸びたかを示します。"
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
              "各トレードのMAE平均です。BUY後に平均して最大何％まで逆行したかを示します。"
            )}
          </span>
          <span class="signal-metric-value">
            ${pctText(summary.averageMaePct)}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Avg Capture (Winners)
            ${helpIcon(
              "利益が出た決済済みトレードだけを対象に、Capture Ratioの平均を計算します。負けトレードはこの平均には含めません。"
            )}
          </span>
          <span class="signal-metric-value">
            ${
              isFiniteNumber(summary.averageCaptureRatio)
                ? `${summary.averageCaptureRatio.toFixed(1)}%`
                : "-"
            }
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Median Capture
            ${helpIcon(
              "利益が出た決済済みトレードだけを対象にしたCapture Ratioの中央値です。極端な値の影響を受けにくい指標です。"
            )}
          </span>
          <span class="signal-metric-value">
            ${
              isFiniteNumber(summary.medianCaptureRatio)
                ? `${summary.medianCaptureRatio.toFixed(1)}%`
                : "-"
            }
          </span>
        </div>

        <div class="signal-sub-value">
          Capture集計対象：
          利益トレード
          ${summary.captureSampleCount ?? 0}件
        </div>
      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          VCP SELL SETTINGS
        </div>

        <div class="signal-main-value">
          <span id="vcpThresholdCondition">
            VCP N < ${threshold.toFixed(2)}
          </span>
        </div>

        <input
          id="vcpSellThresholdSlider"
          class="signal-slider"
          type="range"
          min="-1"
          max="0"
          step="0.01"
          value="${threshold.toFixed(2)}"
        >

        <div class="signal-slider-scale">
          <span>-1.00</span>

          <strong id="vcpThresholdValue">
            ${threshold.toFixed(2)}
          </strong>

          <span>0.00</span>
        </div>

        <div class="signal-threshold-note">
          SELL判定に使うVCP Nの閾値。
          0.00にすると
          「BUY後にVCP N &lt; 0となった日」
          をカウントします。
        </div>


        <div class="signal-occurrence-group">

          <div class="signal-occurrence-title">
            BUY後に
            <strong>VCP N &lt; ${threshold.toFixed(2)}</strong>
            を何回観測してからSELL判定を許可するか
          </div>

          <label class="signal-radio-label">

            <input
              type="radio"
              name="vcpHitOccurrence"
              value="1"
              ${
                normalizedOccurrence === 1
                  ? "checked"
                  : ""
              }
            >

            1回目

          </label>

          <label class="signal-radio-label">

            <input
              type="radio"
              name="vcpHitOccurrence"
              value="2"
              ${
                normalizedOccurrence === 2
                  ? "checked"
                  : ""
              }
            >

            2回目

          </label>

        </div>


        <div class="signal-threshold-note">
          現在のSELL条件：
          VCP5MA &lt; VCP25MA
          ＆
          VCP N &lt; ${threshold.toFixed(2)}
          をBUY後${normalizedOccurrence}回以上観測
          ＆
          Trend &lt; 5日前Trend
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
                : "-"
          }
        </div>

        <div class="signal-sub-value">
          ${latest.date ?? "-"}
        </div>
      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          LAST BUY
        </div>

        <div class="signal-main-value">
          ${
            latestBuy
              ? latestBuy.date
              : "-"
          }
        </div>

        <div class="signal-sub-value">
          ${
            latestBuy
              ? `@ ${numberText(
                  latestBuy.price,
                  2
                )}`
              : "BUY履歴なし"
          }
        </div>
      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          LAST SELL
        </div>

        <div class="signal-main-value">
          ${
            latestSell
              ? latestSell.date
              : "-"
          }
        </div>

        <div class="signal-sub-value">
          ${
            latestSell
              ? `@ ${numberText(
                  latestSell.price,
                  2
                )}`
              : "SELL履歴なし"
          }
        </div>
      </div>


      ${tradeHtml}


      <div class="signal-section">
        ${recordHtml}
      </div>


      <div class="signal-section">

        <div class="signal-section-title">
          CURRENT FACTORS
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Trend
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.trendLine,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Setup
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.setupLine,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Trigger
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.triggerLine,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            52W
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.factor52,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            VCP
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.factorVcp,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            RCI
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.factorRci,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            Volume
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.factorVol,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            RS
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.factorRs,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            RCI slope
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.factorRciSlope,
              3
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            VCP N
          </span>

          <span class="signal-metric-value">
            ${numberText(
              latest.vcp26,
              6
            )}
          </span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">
            VCP hit count
          </span>

          <span class="signal-metric-value">
            ${latest.vcpHitCountAfterBuy ?? 0}
          </span>
        </div>

      </div>
    `;


    installThresholdSlider({
      threshold,
      onThresholdChange
    });


    installOccurrenceRadios({
      occurrence: normalizedOccurrence,
      onOccurrenceChange
    });
  }


  window.SignalSidebar = {
    render
  };

})();
        
