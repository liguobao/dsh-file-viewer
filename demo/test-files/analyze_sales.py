"""销售数据分析 — 展示 pandas 用法。"""
import json
from pathlib import Path

import pandas as pd


def load_sales(path: str) -> pd.DataFrame:
    """加载销售数据 CSV。"""
    df = pd.read_csv(path, encoding="utf-8")
    df["日期"] = pd.to_datetime(df["日期"])
    return df


def analyze(df: pd.DataFrame) -> dict:
    """计算核心指标。"""
    result = {
        "total_revenue": float(df["收入"].sum()),
        "avg_daily": float(df.groupby("日期")["收入"].sum().mean()),
        "top_products": df.groupby("产品")["销量"].sum().nlargest(3).to_dict(),
        "region_share": (df.groupby("区域")["收入"].sum() / df["收入"].sum() * 100).round(1).to_dict(),
    }
    return result


def export_report(stats: dict, out: str) -> None:
    """导出 JSON 报告。"""
    Path(out).write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    data = load_sales("demo/test-files/销售明细.csv")
    report = analyze(data)
    export_report(report, "demo/test-files/sales-report.json")
    print(json.dumps(report, ensure_ascii=False, indent=2))
