#!/usr/bin/env python3
"""
Fear & Greed Index -> forward return statistics builder.

What this does
--------------
1. Splices a continuous daily S&P 500 price series (1927 -> today) out of three
   public sources.
2. Reconstructs a daily "Fear & Greed" style sentiment score back to the 1960s
   using only information available at each point in time (no look-ahead), and
   calibrates it against CNN's real index over the 2011-2026 overlap.
3. Uses CNN's real index where it exists (2011-01-03 onward) and the calibrated
   proxy before that.
4. For every observation date, computes forward returns over several horizons
   (calendar-based, so "1 year later" means exactly one year later).
5. Aggregates those forward returns by score and writes a compact JSON that the
   static web app in ../app consumes.

Run:  python3 pipeline/build_dataset.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT.parent / "app" / "data" / "fng_stats.json"

START = pd.Timestamp("1980-01-01")  # first observation date reported by the app
KERNEL_BW = 5.0                     # Gaussian kernel bandwidth, in index points
HORIZONS = {"3m": 91, "6m": 182, "1y": 365, "3y": 1095}
PRIMARY = "1y"

# --------------------------------------------------------------------------
# 1. price series
# --------------------------------------------------------------------------
def load_price_series() -> pd.DataFrame:
    """Daily S&P 500 close, spliced from three sources.

    ^GSPC (1927..2019-12) -> SPY rescaled (..2025-09) -> Shiller/FRED monthly
    rescaled and interpolated (..latest). The last leg is flagged `approx`
    because it is a monthly average of daily closes, not a true daily close.
    """
    gspc = pd.read_csv(DATA / "sp500_daily.csv", usecols=["Date", "Close"])
    gspc["Date"] = pd.to_datetime(gspc["Date"])
    gspc = gspc.dropna().set_index("Date")["Close"].sort_index()

    spy = pd.read_csv(DATA / "spy_daily.csv", usecols=["DateTime", "Close"])
    spy["DateTime"] = pd.to_datetime(spy["DateTime"], format="%m/%d/%Y")
    spy = spy.dropna().set_index("DateTime")["Close"].sort_index()

    shiller = pd.read_csv(DATA / "shiller_monthly.csv")
    shiller["Date"] = pd.to_datetime(shiller["Date"])
    shiller = shiller.set_index("Date").sort_index()

    # --- leg 1 -> leg 2: scale SPY onto the index using a 60-day overlap median
    join = gspc.index.max()
    overlap = pd.concat([gspc, spy], axis=1, join="inner", keys=["g", "s"]).tail(60)
    ratio_spy = float((overlap["g"] / overlap["s"]).median())
    spy_scaled = spy[spy.index > join] * ratio_spy
    daily = pd.concat([gspc, spy_scaled])

    # --- leg 2 -> leg 3: monthly Shiller levels, placed mid-month, log-interpolated
    last_daily = daily.index.max()
    sh = shiller["SP500"].replace(0, np.nan).dropna()
    sh.index = sh.index + pd.offsets.Day(14)  # monthly average ~ mid-month
    tail_overlap = [d for d in sh.index if last_daily - pd.Timedelta(days=200) <= d <= last_daily]
    if tail_overlap:
        ref = pd.Series(
            [float(daily.asof(d)) / float(sh.loc[d]) for d in tail_overlap]
        )
        ratio_sh = float(ref.median())
    else:
        ratio_sh = 1.0
    tail = sh[sh.index > last_daily] * ratio_sh

    frame = pd.DataFrame({"close": daily})
    frame["approx"] = False
    if len(tail):
        bdays = pd.date_range(last_daily, tail.index.max(), freq="B")
        merged = pd.Series(index=bdays, dtype=float)
        merged.loc[last_daily] = float(daily.iloc[-1])
        for d, v in tail.items():
            merged.loc[merged.index.asof(d)] = float(v)
        merged = np.exp(np.log(merged).interpolate(method="time")).dropna()
        merged = merged[merged.index > last_daily]
        frame = pd.concat(
            [frame, pd.DataFrame({"close": merged, "approx": True})]
        )

    frame = frame[~frame.index.duplicated(keep="first")].sort_index()

    # sanity: no source splice should create a >5% one-day gap
    jump = frame["close"].pct_change().abs()
    bad = jump[(jump > 0.12) & (jump.index > pd.Timestamp("1990-01-01"))]
    if len(bad):
        print(f"  ! large daily moves after 1990 (check splices): {list(bad.index.date)[:5]}")
    return frame


def total_return_index(price: pd.Series) -> pd.Series:
    """Price index scaled up by reinvested dividends (Shiller dividend series)."""
    shiller = pd.read_csv(DATA / "shiller_monthly.csv")
    shiller["Date"] = pd.to_datetime(shiller["Date"])
    shiller = shiller.set_index("Date").sort_index()
    yld = (shiller["Dividend"] / shiller["SP500"]).replace([np.inf, -np.inf], np.nan)
    yld = yld.where(yld > 0).dropna()  # annualised dividend yield, monthly
    daily_yld = yld.reindex(price.index.union(yld.index)).interpolate("time")
    daily_yld = daily_yld.reindex(price.index).ffill().bfill()
    dt = pd.Series(price.index, index=price.index).diff().dt.days.fillna(1) / 365.25
    growth = (1.0 + daily_yld * dt).cumprod()
    return price * growth


# --------------------------------------------------------------------------
# 2. sentiment proxy
# --------------------------------------------------------------------------
PCT_WINDOW = 756      # 3 trading years
PCT_MIN = 252         # 1 trading year of warm-up

COMPONENT_WEIGHTS = {
    "momentum_50d": 0.25,   # index vs its 50-day average
    "momentum_125d": 0.20,  # index vs its 125-day average (CNN's own momentum rule)
    "high_distance": 0.15,  # distance from the 52-week high (breadth / new-highs stand-in)
    "short_move": 0.20,     # 20-day move (safe-haven-demand stand-in)
    "volatility": 0.20,     # VIX vs its 50-day average, inverted (CNN's own volatility rule)
}


def rolling_pct(s: pd.Series, window: int = PCT_WINDOW, min_periods: int = PCT_MIN) -> pd.Series:
    """Point-in-time percentile rank inside a trailing window (0..1, no look-ahead)."""
    return s.rolling(window, min_periods=min_periods).rank(pct=True)


def build_proxy(price: pd.Series, vix: pd.Series) -> pd.DataFrame:
    """Reconstruct a CNN-style greed/fear composite from price and volatility.

    CNN blends 7 inputs. Five of them have price/volatility analogues that run
    back to the 1920s; put/call ratios, junk-bond demand and true market breadth
    do not exist that far back, so they are left out. Every component is ranked
    against its own trailing 3-year distribution, which is what makes readings
    comparable across decades, and then blended. Correlation with the real CNN
    index over the 2011-2026 overlap is reported by calibrate().
    """
    p = price
    logret = np.log(p).diff()

    realized = logret.rolling(21).std() * math.sqrt(252)
    v = vix.reindex(p.index).ffill(limit=5)
    # VIX vs its 50-day mean where VIX exists (1990+), realised volatility before that
    vol_signal = -np.log(v / v.rolling(50).mean())
    vol_signal = vol_signal.fillna(-np.log(realized / realized.rolling(50).mean()))

    comps = {
        "momentum_50d": np.log(p / p.rolling(50).mean()),
        "momentum_125d": np.log(p / p.rolling(125).mean()),
        "high_distance": np.log(p / p.rolling(252).max()),
        "short_move": np.log(p / p.shift(20)),
        "volatility": vol_signal,
    }

    ranked = pd.DataFrame({k: rolling_pct(v_) for k, v_ in comps.items()})
    w = pd.Series(COMPONENT_WEIGHTS)
    mask = ranked.notna()
    composite = (ranked.fillna(0) * w).sum(axis=1) / (mask * w).sum(axis=1).replace(0, np.nan)
    composite = composite.where(mask.sum(axis=1) >= 3)
    out = ranked.copy()
    out["composite"] = composite
    return out


def calibrate(composite: pd.Series, cnn: pd.Series) -> tuple[pd.Series, dict]:
    """Map the composite z onto CNN's 0-100 scale using the overlap period."""
    both = pd.concat([composite.rename("z"), cnn.rename("cnn")], axis=1).dropna()
    corr = float(both["z"].corr(both["cnn"]))
    spearman = float(both["z"].rank().corr(both["cnn"].rank()))

    # quantile mapping: rank of the composite in the overlap -> CNN's quantile
    zs = np.sort(both["z"].to_numpy())
    cs = np.sort(both["cnn"].to_numpy())
    ranks = np.searchsorted(zs, composite.to_numpy(), side="left") / max(len(zs) - 1, 1)
    ranks = np.clip(ranks, 0.0, 1.0)
    mapped = np.interp(ranks, np.linspace(0, 1, len(cs)), cs)
    scores = pd.Series(mapped, index=composite.index).where(composite.notna())

    stats = {
        "overlap_start": str(both.index.min().date()),
        "overlap_end": str(both.index.max().date()),
        "overlap_days": int(len(both)),
        "pearson": round(corr, 3),
        "spearman": round(spearman, 3),
    }
    return scores.round(1), stats


# --------------------------------------------------------------------------
# 3. forward returns
# --------------------------------------------------------------------------
def forward_returns(index_series: pd.Series, days: int) -> pd.Series:
    """Return from date d to the first trading day on/after d + `days` calendar days."""
    idx = index_series.index
    target = idx + pd.Timedelta(days=days)
    pos = np.searchsorted(idx.values, target.values, side="left")
    ok = pos < len(idx)
    out = np.full(len(idx), np.nan)
    vals = index_series.to_numpy()
    out[ok] = vals[pos[ok]] / vals[ok] - 1.0
    return pd.Series(out, index=idx)


# --------------------------------------------------------------------------
# 4. aggregation
# --------------------------------------------------------------------------
def weighted_quantile(values: np.ndarray, weights: np.ndarray, q: float) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cw = np.cumsum(w)
    if cw[-1] <= 0:
        return float("nan")
    cw = (cw - 0.5 * w) / cw[-1]
    return float(np.interp(q, cw, v))


def curve_for(df: pd.DataFrame, col: str) -> dict:
    """Kernel-smoothed forward-return statistics at every integer score 0..100."""
    d = df.dropna(subset=["fng", col])
    f = d["fng"].to_numpy()
    r = d[col].to_numpy()
    scores = np.arange(0, 101)
    out = {k: [] for k in
           ("mean", "median", "p10", "p25", "p75", "p90", "win", "n_eff", "n_raw", "worst", "best")}
    for s in scores:
        w = np.exp(-0.5 * ((f - s) / KERNEL_BW) ** 2)
        keep = w > 1e-4
        ww, rr = w[keep], r[keep]
        n_eff = float(ww.sum())
        if n_eff < 20:
            for k in out:
                out[k].append(None)
            continue
        out["mean"].append(round(float(np.average(rr, weights=ww)) * 100, 2))
        out["median"].append(round(weighted_quantile(rr, ww, 0.5) * 100, 2))
        out["p10"].append(round(weighted_quantile(rr, ww, 0.10) * 100, 2))
        out["p25"].append(round(weighted_quantile(rr, ww, 0.25) * 100, 2))
        out["p75"].append(round(weighted_quantile(rr, ww, 0.75) * 100, 2))
        out["p90"].append(round(weighted_quantile(rr, ww, 0.90) * 100, 2))
        out["win"].append(round(float(np.average((rr > 0).astype(float), weights=ww)) * 100, 1))
        out["n_eff"].append(round(n_eff, 1))
        out["n_raw"].append(int(((f >= s - KERNEL_BW) & (f <= s + KERNEL_BW)).sum()))
        out["worst"].append(round(float(rr.min()) * 100, 1))
        out["best"].append(round(float(rr.max()) * 100, 1))
    return out


def bucket_stats(df: pd.DataFrame, col: str, edges: list[tuple[float, float, str]]) -> list[dict]:
    rows = []
    d = df.dropna(subset=["fng", col])
    for lo, hi, label in edges:
        sel = d[(d["fng"] >= lo) & (d["fng"] <= hi)]
        r = sel[col].to_numpy()
        if len(r) < 20:
            rows.append({"label": label, "lo": lo, "hi": hi, "n": int(len(r))})
            continue
        rows.append({
            "label": label, "lo": lo, "hi": hi,
            "n": int(len(r)),
            "years": round(len(r) / 252.0, 1),
            "mean": round(float(r.mean()) * 100, 2),
            "median": round(float(np.median(r)) * 100, 2),
            "p10": round(float(np.quantile(r, 0.10)) * 100, 1),
            "p90": round(float(np.quantile(r, 0.90)) * 100, 1),
            "win": round(float((r > 0).mean()) * 100, 1),
            "worst": round(float(r.min()) * 100, 1),
            "best": round(float(r.max()) * 100, 1),
            "sd": round(float(r.std(ddof=1)) * 100, 1),
        })
    return rows


DECILES = [(i, i + 9.999, f"{i}-{i + 10}") for i in range(0, 100, 10)]
CATEGORIES = [
    (0, 24.999, "Extreme Fear"),
    (25, 44.999, "Fear"),
    (45, 55.999, "Neutral"),
    (56, 74.999, "Greed"),
    (75, 100, "Extreme Greed"),
]


def build_all(df: pd.DataFrame) -> dict:
    """Statistics for every (data range x return type x horizon) combination."""
    out = {}
    ranges = {"all": df, "cnn": df[df["src"] == "cnn"]}
    for rname, rdf in ranges.items():
        for rt in ("pr", "tr"):
            for hz in HORIZONS:
                col = f"{rt}_{hz}"
                key = f"{rname}|{rt}|{hz}"
                sub = rdf.dropna(subset=["fng", col])
                r = sub[col].to_numpy()
                out[key] = {
                    "curve": curve_for(rdf, col),
                    "buckets": bucket_stats(rdf, col, DECILES),
                    "categories": bucket_stats(rdf, col, CATEGORIES),
                    "baseline": {
                        "mean": round(float(r.mean()) * 100, 2),
                        "median": round(float(np.median(r)) * 100, 2),
                        "win": round(float((r > 0).mean()) * 100, 1),
                        "n": int(len(r)),
                        "years": round(len(r) / 252.0, 1),
                    },
                }
    return out


def main() -> None:
    print("1. loading price data ...")
    prices = load_price_series()
    close = prices["close"]
    print(f"   daily index: {close.index.min().date()} -> {close.index.max().date()} "
          f"({len(close):,} rows, {int(prices['approx'].sum())} interpolated tail rows)")

    tr = total_return_index(close)

    vix = pd.read_csv(DATA / "vix_daily.csv", usecols=["DATE", "CLOSE"])
    vix["DATE"] = pd.to_datetime(vix["DATE"])
    vix = vix.dropna().set_index("DATE")["CLOSE"].sort_index()

    cnn = pd.read_csv(DATA / "cnn_fng.csv")
    cnn["Date"] = pd.to_datetime(cnn["Date"])
    cnn = cnn.dropna(subset=["Fear Greed"]).set_index("Date")["Fear Greed"].sort_index()
    cnn = cnn[~cnn.index.duplicated(keep="last")]
    print(f"   CNN index:   {cnn.index.min().date()} -> {cnn.index.max().date()} ({len(cnn):,} rows)")

    print("2. building sentiment proxy ...")
    proxy = build_proxy(close, vix)
    scores, cal = calibrate(proxy["composite"], cnn.reindex(close.index))
    print(f"   proxy vs CNN over {cal['overlap_days']} days: "
          f"pearson={cal['pearson']} spearman={cal['spearman']}")

    cnn_d = cnn.reindex(close.index)
    fng = cnn_d.combine_first(scores)
    source = pd.Series(np.where(cnn_d.notna(), "cnn", "proxy"), index=close.index)

    print("3. computing forward returns ...")
    df = pd.DataFrame({"fng": fng, "src": source, "close": close, "approx": prices["approx"]})
    for name, days in HORIZONS.items():
        df[f"pr_{name}"] = forward_returns(close, days)
        df[f"tr_{name}"] = forward_returns(tr, days)
    # annualise the multi-year figures
    for name, days in HORIZONS.items():
        if days > 400:
            years = days / 365.25
            for rt in ("pr", "tr"):
                df[f"{rt}_{name}"] = (1.0 + df[f"{rt}_{name}"]) ** (1 / years) - 1.0

    last_real = prices.index[~prices["approx"]].max()
    df = df[df.index >= START]
    df = df[df["fng"].notna()]

    usable = df.dropna(subset=[f"pr_{PRIMARY}"])
    print(f"   observations with a 1-year forward return: {len(usable):,} "
          f"({usable.index.min().date()} -> {usable.index.max().date()})")
    print(f"   of which CNN-sourced: {(usable['src'] == 'cnn').sum():,}")

    print("4. aggregating ...")
    payload = {
        "meta": {
            "generated": datetime.utcnow().strftime("%Y-%m-%d"),
            "start": str(usable.index.min().date()),
            "end": str(usable.index.max().date()),
            "price_data_end": str(close.index.max().date()),
            "last_real_close": str(last_real.date()),
            "n_obs": int(len(usable)),
            "n_cnn": int((usable["src"] == "cnn").sum()),
            "n_proxy": int((usable["src"] == "proxy").sum()),
            "kernel_bw": KERNEL_BW,
            "horizons": HORIZONS,
            "calibration": cal,
            "cnn_start": str(cnn.index.min().date()),
            "cnn_end": str(cnn.index.max().date()),
            "latest_fng": round(float(cnn.iloc[-1]), 1),
            "latest_fng_date": str(cnn.index[-1].date()),
            "components": COMPONENT_WEIGHTS,
            "sources": [
                "CNN Fear & Greed daily 2011-2026 (whit3rabbit/fear-greed-data)",
                "S&P 500 daily 1927-2019 (fja05680/dow-sp500-100-years)",
                "SPY daily 2000-2026 (willhjw/big_movers)",
                "S&P 500 + dividends monthly, Shiller/FRED (datasets/s-and-p-500)",
                "VIX daily 1990-2026 (datasets/finance-vix)",
            ],
        },
        "datasets": build_all(df),
    }

    # weekly sample for the scatter, distribution and timeline charts
    weekly = df.resample("W-FRI").last().dropna(subset=["fng"])
    cols = [f"{rt}_{hz}" for rt in ("pr", "tr") for hz in HORIZONS]
    rows = []
    for d, row in weekly.iterrows():
        item = {"d": str(d.date()), "f": round(float(row["fng"]), 1),
                "s": 1 if row["src"] == "cnn" else 0}
        for c in cols:
            v = row[c]
            item[c] = None if pd.isna(v) else round(float(v) * 100, 1)
        rows.append(item)
    payload["weekly"] = rows

    # a handful of memorable episodes per decile (most extreme realized outcomes)
    episodes = {}
    for lo, hi, label in DECILES:
        sel = usable[(usable["fng"] >= lo) & (usable["fng"] <= hi)]
        if len(sel) < 20:
            continue
        monthly = sel.resample("ME").first().dropna(subset=["fng", "pr_1y"])
        monthly = monthly[(monthly["fng"] >= lo) & (monthly["fng"] <= hi)]
        picks = pd.concat([
            monthly.nsmallest(3, "pr_1y"),
            monthly.nlargest(3, "pr_1y"),
        ]).sort_index()
        episodes[label] = [
            {"d": str(d.date()), "f": round(float(r["fng"]), 1),
             "r": round(float(r["pr_1y"]) * 100, 1)}
            for d, r in picks.iterrows()
        ]
    payload["episodes"] = episodes

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    size = OUT.stat().st_size / 1024
    print(f"5. wrote {OUT.relative_to(ROOT.parent)} ({size:.0f} KB)")

    print("\n   1-year forward return by Fear & Greed bucket (1980-, price return):")
    for row in payload["datasets"]["all|pr|1y"]["buckets"]:
        if "mean" not in row:
            continue
        print(f"     {row['label']:>7}  n={row['n']:>5}  mean={row['mean']:>6.2f}%  "
              f"median={row['median']:>6.2f}%  win={row['win']:>5.1f}%  "
              f"worst={row['worst']:>7.1f}%  best={row['best']:>6.1f}%")


if __name__ == "__main__":
    main()
