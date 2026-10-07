#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查生成的地级市边界数据，结果写文件避免 GBK 控制台乱码。"""
import json, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(BASE, "data", "china-cities.geo.json"), encoding="utf-8") as f:
    geo = json.load(f)
with open(os.path.join(BASE, "data", "city-index.json"), encoding="utf-8") as f:
    index = json.load(f)

feats = geo["features"]
names = [f["properties"]["name"] for f in feats]
provs = {}
for f in feats:
    provs.setdefault(f["properties"]["province"], 0)
    provs[f["properties"]["province"]] += 1

lines = []
lines.append(f"=== 地级市边界要素：{len(feats)} 个 ===")
lines.append(f"省级单位：{len(provs)} 个")
lines.append("")
lines.append("--- 各省要素数 ---")
for p, n in sorted(provs.items(), key=lambda x: -x[1]):
    lines.append(f"  {p}: {n}")

lines.append("")
lines.append("--- 城市索引 vs 边界 匹配情况 ---")
idx_names = [c["name"] for c in index]
geo_set = set(names)

matched, unmatched = [], []
for c in index:
    cands = [n for n in names if c["name"] in n or n in c["name"]]
    if cands:
        matched.append((c["name"], c["province"], cands[:3]))
    else:
        unmatched.append((c["name"], c["province"]))

lines.append(f"能匹配到边界要素的索引城市：{len(matched)} / {len(idx_names)}")
lines.append(f"匹配不上的：{len(unmatched)}")
lines.append("")
lines.append("--- 匹配不上的城市（前 60 个）---")
for n, p in unmatched[:60]:
    lines.append(f"  {n}  ({p})")

lines.append("")
lines.append("--- 边界要素名样例（前 30）---")
lines.append("  " + "、".join(names[:30]))

with open(os.path.join(BASE, "_geo_report.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print("written")
