#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取全国地级市边界，合成为一个 GeoJSON。

数据源：阿里云 DataV 行政区划边界服务
  https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json

策略：
  1. 以 34 个省级 adcode 为入口，取 *_full.json（含下辖地级市）
  2. 只保留地级市级别的要素（level == 'city'），跳过省本级汇总要素
  3. 高精度保留：坐标 3 位小数（约 100m），只丢弃面积极小的碎岛
  4. 输出 data/china-cities.geo.json
"""

import json
import math
import os
import time
import urllib.request

PROVINCES = [
    ("110000", "北京市"), ("120000", "天津市"), ("130000", "河北省"), ("140000", "山西省"),
    ("150000", "内蒙古自治区"), ("210000", "辽宁省"), ("220000", "吉林省"), ("230000", "黑龙江省"),
    ("310000", "上海市"), ("320000", "江苏省"), ("330000", "浙江省"), ("340000", "安徽省"),
    ("350000", "福建省"), ("360000", "江西省"), ("370000", "山东省"), ("410000", "河南省"),
    ("420000", "湖北省"), ("430000", "湖南省"), ("440000", "广东省"), ("450000", "广西壮族自治区"),
    ("460000", "海南省"), ("500000", "重庆市"), ("510000", "四川省"), ("520000", "贵州省"),
    ("530000", "云南省"), ("540000", "西藏自治区"), ("610000", "陕西省"), ("620000", "甘肃省"),
    ("630000", "青海省"), ("640000", "宁夏回族自治区"), ("650000", "新疆维吾尔自治区"),
    ("710000", "台湾省"), ("810000", "香港特别行政区"), ("820000", "澳门特别行政区"),
]

BASE = "https://geo.datav.aliyun.com/areas_v3/bound/{}.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "china-cities.geo.json")
CACHE = os.path.join(os.path.dirname(__file__), "..", "_cache")

# 精度与体积的平衡
COORD_DECIMALS = 3          # 3 位小数 ≈ 100m
MIN_RING_AREA = 0.00008     # 平方度，丢弃比这更小的碎岛环


def fetch(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retries - 1:
                raise
            print(f"    retry {i+1}: {e}")
            time.sleep(1.5)


def cached_fetch(adcode):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{adcode}_full.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    data = fetch(BASE.format(adcode + "_full"))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def ring_area(ring):
    """鞋带公式算环的有向面积（平方度）"""
    s = 0.0
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def dedupe_ring(ring, decimals):
    """去重连续相同点 + 降精度"""
    out = []
    prev = None
    q = 10 ** decimals
    for pt in ring:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        x = round(float(pt[0]) * q) / q
        y = round(float(pt[1]) * q) / q
        cur = (x, y)
        if cur != prev:
            out.append([x, y])
            prev = cur
    # 闭合
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0][:])
    return out


def simplify_geom(geometry):
    """返回精简后的 polygon 列表（MultiPolygon 形式）"""
    if not geometry:
        return []

    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []

    if gtype == "Polygon":
        polys = [coords]
    elif gtype == "MultiPolygon":
        polys = coords
    else:
        return []

    result = []
    for poly in polys:
        rings = []
        for ri, ring in enumerate(poly):
            cleaned = dedupe_ring(ring, COORD_DECIMALS)
            if len(cleaned) < 4:
                continue
            # 外环按面积过滤碎岛；内环（洞）保留
            if ri == 0 and ring_area(cleaned) < MIN_RING_AREA:
                continue
            rings.append(cleaned)
        if not rings:
            continue
        result.append(rings)
    return result


def main():
    features = []
    seen = set()
    total_pts = 0

    for adcode, pname in PROVINCES:
        try:
            data = cached_fetch(adcode)
        except Exception as e:
            print(f"  !! {pname} ({adcode}) 抓取失败：{e}")
            continue

        n = 0
        for feat in data.get("features", []):
            props = feat.get("properties") or {}
            level = props.get("level")
            name = props.get("name")
            code = str(props.get("adcode") or "")
            if not name or not code:
                continue
            # 只要地级市；省级要素跳过（"province"），区县级不会出现在 _full 里
            if level != "city":
                continue
            if code in seen:
                continue

            geom = simplify_geom(feat.get("geometry"))
            if not geom:
                continue

            pts = sum(len(r) for poly in geom for r in poly)
            total_pts += pts

            features.append({
                "type": "Feature",
                "properties": {
                    "name": name,
                    "adcode": code,
                    "province": pname,
                    "center": props.get("center") or props.get("centroid"),
                },
                "geometry": {"type": "MultiPolygon", "coordinates": geom},
            })
            seen.add(code)
            n += 1

        print(f"  {pname:12s} +{n:3d}  (累计 {len(features)})")
        time.sleep(0.15)

    out = {"type": "FeatureCollection", "features": features}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT)
    print(f"\n写入 {os.path.abspath(OUT)}")
    print(f"地级市要素：{len(features)}")
    print(f"坐标点总数：{total_pts}")
    print(f"文件体积：{size/1024/1024:.2f} MB ({size/1024:.0f} KB)")

    # 抽查
    names = {f["properties"]["name"] for f in features}
    for probe in ["敦煌", "婺源", "赤水", "凤凰", "平遥", "重庆", "深圳"]:
        hit = [f["properties"] for f in features if probe in f["properties"]["name"]]
        print(f"  抽查 {probe}: {[h['name'] for h in hit] or '未找到'}")


if __name__ == "__main__":
    main()
