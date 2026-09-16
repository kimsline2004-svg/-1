#!/usr/bin/env python3
"""미국 10년 국채금리 -> 이후 1/3/5년 수익률 패널 생성.

입력 (pipeline/data/):
  ust10y_monthly.csv   FRED GS10, 10년 만기 국채 금리 월평균 (1953-04~)
  cpi_us_monthly.csv   미국 CPI-U 월별 지수 (실질 수익률 환산용)

출력:
  app/data/ust10y_panel.json   월별 관측치 패널 (금리, 1/3/5년 후 명목·실질 연환산 수익률)

수익률 정의
  매달 초 "액면가에 발행된 10년 만기 국채"를 사고, 한 달 뒤 잔존만기 9년 11개월이 된
  그 채권을 그날의 10년 금리로 평가해 판 뒤, 다시 새 10년 국채를 사는 것을 반복한다
  (constant maturity roll). 즉 이자 수입 + 가격 변동을 모두 포함한 총수익률이다.
"""

import csv
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(BASE, os.pardir, "app", "data", "ust10y_panel.json")

HORIZONS = {"h1": 12, "h3": 36, "h5": 60}


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


def monthly_total_returns(months, rates):
    """월별 총수익률 리스트. 길이는 len(months) - 1."""
    returns = []
    for t in range(len(months) - 1):
        # 이번 달 금리로 액면 발행된 채권을 다음 달 금리로 평가한다.
        returns.append(price_after_one_month(rates[t + 1], rates[t]) / 100.0 - 1.0)
    return returns


def build():
    rate_map = read_monthly(os.path.join(DATA, "ust10y_monthly.csv"), "Date", "Rate")
    cpi_map = read_monthly(os.path.join(DATA, "cpi_us_monthly.csv"), "Date", "Index")

    months = sorted(rate_map)
    # 중간에 빠진 달이 없는지 확인 (있으면 롤링 계산이 어긋난다)
    for a, b in zip(months, months[1:]):
        y, m = int(a[:4]), int(a[5:])
        nxt = f"{y + (m == 12)}-{(m % 12) + 1:02d}"
        assert nxt == b, f"금리 시계열에 빈 달이 있습니다: {a} -> {b}"

    rates = [rate_map[m] for m in months]
    returns = monthly_total_returns(months, rates)

    panel = []
    for i, month in enumerate(months):
        row = {"m": month, "y": round(rates[i], 2)}
        for key, span in HORIZONS.items():
            if i + span > len(returns):
                continue
            growth = 1.0
            for r in returns[i:i + span]:
                growth *= 1.0 + r
            row[key] = round((growth ** (12.0 / span) - 1.0) * 100, 2)

            end_month = months[i + span]
            if month in cpi_map and end_month in cpi_map:
                real = growth * cpi_map[month] / cpi_map[end_month]
                row[key + "r"] = round((real ** (12.0 / span) - 1.0) * 100, 2)
        panel.append(row)

    meta = {
        "source": "FRED GS10 (10-Year Treasury Constant Maturity Rate, 월평균) / BLS CPI-U",
        "first": months[0],
        "last": months[-1],
        "count": len(panel),
        "latestRate": rates[-1],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "panel": panel}, f, ensure_ascii=False, separators=(",", ":"))

    print(f"{len(panel)}개월 ({months[0]} ~ {months[-1]}) -> {os.path.relpath(OUT, BASE)}")
    for key, span in HORIZONS.items():
        n = sum(1 for row in panel if key in row)
        print(f"  {span // 12}년 후 수익률 표본 {n}개")
    return months, rates, returns, panel


if __name__ == "__main__":
    build()
