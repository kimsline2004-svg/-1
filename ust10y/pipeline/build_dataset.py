#!/usr/bin/env python3
"""미국 10년 국채금리 -> 이후 1/3/5년 수익률 패널 생성.

입력 (pipeline/data/):
  ust10y_monthly.csv   FRED GS10, 10년 만기 국채 금리 월평균 (1953-04~)
  sp500_monthly.csv    S&P 500 월평균 지수와 주당 배당 (Shiller)
  cpi_us_monthly.csv   미국 CPI-U 월별 지수 (실질 수익률 환산용)

출력:
  app/data/ust10y_panel.json   월별 관측치 패널
                               (금리, 국채·주식의 1/3/5년 후 명목·실질 연환산 수익률)

두 자산의 수익률 정의
  국채 — 매달 초 "액면가에 발행된 10년 만기 국채"를 사고, 한 달 뒤 잔존만기 9년
         11개월이 된 그 채권을 그날의 10년 금리로 평가해 판 뒤, 다시 새 10년 국채를
         사는 것을 반복한다(constant maturity roll). 이자 + 가격 변동.
  주식 — S&P 500을 사서 배당을 재투자한다. 가격 + 배당.
"""

import csv
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, os.pardir, "app", "data", "ust10y_panel.json")

HORIZONS = {"1": 12, "3": 36, "5": 60}


def read_monthly(path, date_col, value_col):
    """월별 CSV를 {'YYYY-MM': float} 로 읽는다. 0 또는 빈 값은 결측 처리."""
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            raw = (row.get(value_col) or "").strip()
            if not raw:
                continue
            value = float(raw)
            if value <= 0:
                continue
            out[row[date_col][:7]] = value
    return out


def next_month(m):
    y, mo = int(m[:4]), int(m[5:])
    return f"{y + (mo == 12)}-{(mo % 12) + 1:02d}"


def price_after_one_month(yield_pct, coupon_pct):
    """액면가 100에 발행된 10년 국채를 1개월 뒤 평가한 더티 프라이스.

    반년마다 이표를 주는 미국식 관행(반기 복리)을 그대로 쓴다. 발행 시점 기준으로
    이표는 6, 12, ..., 120개월 뒤에 나오므로 1개월이 지나면 남은 기간은
    5, 11, ..., 119개월, 즉 반년 단위로 (6k-1)/6 이다. 경과이자를 포함한
    더티 프라이스라서 (가격/100 - 1)이 곧 그 달의 총수익률이 된다.
    """
    i = yield_pct / 200.0          # 반기 할인율
    coupon = coupon_pct / 2.0      # 반기 이표
    pv = 0.0
    for k in range(1, 21):
        t = (6 * k - 1) / 6.0
        pv += coupon / (1.0 + i) ** t
    pv += 100.0 / (1.0 + i) ** ((120 - 1) / 6.0)
    return pv


def extend_dividends(div, months):
    """배당이 끊긴 뒤의 달을 직전 10년 성장률로 이어붙인다.

    Shiller 데이터의 배당은 2023-06에서 멈춰 있고 그 뒤로는 지수 가격만 들어온다.
    배당수익률을 그대로 고정하면 최근처럼 가격이 크게 오른 구간에서 배당을 크게
    부풀리므로, 배당 자체를 과거 성장률로 늘린다. 마지막 3년치 관측에만 영향을
    주고, 그 구간의 배당수익률은 약 1.2%로 실제와 가깝다.
    """
    known = [m for m in months if m in div]
    if not known:
        raise SystemExit("배당 데이터가 없습니다")
    last = known[-1]
    base = div[last]
    ten_years_ago = f"{int(last[:4]) - 10}-{last[5:]}"
    if ten_years_ago in div:
        growth = (base / div[ten_years_ago]) ** 0.1 - 1.0
    else:
        growth = 0.05
    filled = 0
    for m in months:
        if m <= last or m in div:
            continue
        gap = (int(m[:4]) - int(last[:4])) * 12 + int(m[5:]) - int(last[5:])
        div[m] = base * (1.0 + growth) ** (gap / 12.0)
        filled += 1
    return last, growth, filled


def monthly_returns(months, rates, price, div):
    """월별 총수익률. bond[t], stock[t]는 months[t] -> months[t+1] 구간."""
    bond, stock = [], []
    for t in range(len(months) - 1):
        # 국채: 이번 달 금리로 액면 발행된 채권을 다음 달 금리로 평가한다.
        bond.append(price_after_one_month(rates[t + 1], rates[t]) / 100.0 - 1.0)
        # 주식: 가격 변동 + 그 달에 받은 배당(연 배당의 1/12)을 재투자한다.
        a, b = months[t], months[t + 1]
        stock.append((price[b] + div[a] / 12.0) / price[a] - 1.0)
    return bond, stock


def build():
    rate_map = read_monthly(os.path.join(DATA, "ust10y_monthly.csv"), "Date", "Rate")
    cpi_map = read_monthly(os.path.join(DATA, "cpi_us_monthly.csv"), "Date", "Index")
    price = read_monthly(os.path.join(DATA, "sp500_monthly.csv"), "Date", "Price")
    div = read_monthly(os.path.join(DATA, "sp500_monthly.csv"), "Date", "Dividend")

    months = sorted(rate_map)
    # 중간에 빠진 달이 없는지 확인 (있으면 롤링 계산이 어긋난다)
    for a, b in zip(months, months[1:]):
        assert next_month(a) == b, f"금리 시계열에 빈 달이 있습니다: {a} -> {b}"
    for m in months:
        assert m in price, f"S&P 500 가격이 없는 달: {m}"

    last_div, growth, filled = extend_dividends(div, months)

    rates = [rate_map[m] for m in months]
    bond, stock = monthly_returns(months, rates, price, div)

    series = {"b": bond, "s": stock}
    panel = []
    for i, month in enumerate(months):
        row = {"m": month, "y": round(rates[i], 2)}
        for tag, rets in series.items():
            for label, span in HORIZONS.items():
                if i + span > len(rets):
                    continue
                growth_factor = 1.0
                for r in rets[i:i + span]:
                    growth_factor *= 1.0 + r
                row[tag + label] = round((growth_factor ** (12.0 / span) - 1.0) * 100, 2)

                end_month = months[i + span]
                if month in cpi_map and end_month in cpi_map:
                    real = growth_factor * cpi_map[month] / cpi_map[end_month]
                    row[tag + label + "r"] = round((real ** (12.0 / span) - 1.0) * 100, 2)
        panel.append(row)

    meta = {
        "source": "FRED GS10 (10-Year Treasury Constant Maturity Rate, 월평균) / "
                  "Shiller S&P 500 월평균 지수·배당 / BLS CPI-U",
        "first": months[0],
        "last": months[-1],
        "count": len(panel),
        "latestRate": rates[-1],
        "divLast": last_div,
        "divGrowth": round(growth * 100, 2),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "panel": panel}, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT) / 1024
    print(f"{len(panel)}개월 ({months[0]} ~ {months[-1]}) -> "
          f"{os.path.relpath(OUT, BASE)} ({size:.0f} KB)")
    print(f"배당은 {last_div}까지 실측, 이후 {filled}개월은 연 {growth * 100:.1f}% 성장 가정")
    for tag, name in (("b", "국채"), ("s", "주식")):
        counts = [str(sum(1 for row in panel if tag + label in row)) for label in HORIZONS]
        print(f"  {name} 1/3/5년 표본 {'/'.join(counts)}개월")
    return months, rates, bond, stock, panel


if __name__ == "__main__":
    build()
