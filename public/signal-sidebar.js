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
                SELLモード：${trade.vcpHitOccurrenceSetting ?? occurrence}回目
                ${
                  (trade.vcpHitOccurrenceSetting ?? occurrence) === 2
                    ? `／ 1回目警戒：${trade.sellWarningDate ?? "-"} ／ 0回復：${trade.zeroRecoveryDate ?? "-"}`
                    : "／ 完全SELL条件で決済"
                }
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
              "利益が出たCLOSEDトレードだけを対象にしたCapture Ratioの平均です。負けトレード由来の極端なマイナス値は平均に入れません。"
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
              "利益が出たCLOSEDトレードのCapture Ratioを小さい順に並べた中央値です。外れ値の影響を受けにくく、典型的な利益捕捉率を見るのに向いています。"
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

        <div class="signal-threshold-note">
          Capture集計対象：利益トレード ${summary.captureSampleCount ?? 0}件
        </div>
      </div>


      <div class="signal-section">
        <div class="signal-section-title">
          VCP SELL SETTINGS
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

        <div class="signal-occurrence-group">
          <div class="signal-occurrence-title">
            SELLタイミング
          </div>

          <label class="signal-radio-label">
            <input
              type="radio"
              name="vcpHitOccurrence"
              value="1"
              ${normalizedOccurrence === 1 ? "checked" : ""}
            >
            1回目
          </label>

          <label class="signal-radio-label">
            <input
              type="radio"
              name="vcpHitOccurrence"
              value="2"
              ${normalizedOccurrence === 2 ? "checked" : ""}
            >
            2回目
          </label>
        </div>

        <div class="signal-threshold-note">
          1回目：
          <br>
          VCP 5MA &lt; VCP 25MA
          ＆
          <span id="vcpThresholdCondition">
            VCP N &lt; ${threshold.toFixed(2)}
          </span>
          ＆
          Trend t &lt; Trend t-5
          が全部成立した日にSELL。
          <br><br>
          2回目：
          <br>
          上の完全SELL条件が1回成立した後も保有し、
          VCP Nが一度0以上へ回復してから、
          再び0未満へクロスした日にSELL。
          <br><br>
          スライダー選択中は ← / → キーで0.01ずつ変更できます。
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
        ${recordHtml}
      </div>


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

        <div class="signal-metric-row">
          <span class="signal-metric-label">1回目SELL警戒</span>
          <span class="signal-metric-value">${result.sellWarningArmed ? "ON" : "OFF"}</span>
        </div>

        <div class="signal-metric-row">
          <span class="signal-metric-label">VCP N 0回復</span>
          <span class="signal-metric-value">${result.zeroRecoverySeen ? "済" : "未"}</span>
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
