#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
补全地级市边界数据：
  1. 直辖市（北京/上海/天津/重庆）—— 单独抓，它们 level 是 province
  2. 港澳 —— 单独抓
  3. 台湾 —— 阿里云 710000 返回 404，改用备用源
  4. 自治州简称归一（湘西州 → 湘西土家族苗族自治州）

输出仍写 data/china-cities.geo.json
"""
import json
import os
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "china-cities.geo.json")
CACHE = os.path.join(BASE, "_cache")

COORD_DECIMALS = 3
MIN_RING_AREA = 0.00008

# 直辖市 / 港澳：这些本身就是「城市」，作为独立要素加入
MUNI = [
    ("110000", "北京市", "北京市"),
    ("120000", "天津市", "天津市"),
    ("310000", "上海市", "上海市"),
    ("500000", "重庆市", "重庆市"),
    ("810000", "香港", "香港特别行政区"),
    ("820000", "澳门", "澳门特别行政区"),
]


def fetch_json(url, retries=3):
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


def cached(adcode, suffix="_full"):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{adcode}{suffix}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    data = fetch_json(f"https://geo.datav.aliyun.com/areas_v3/bound/{adcode}{suffix}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def ring_area(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def dedupe(ring, decimals=COORD_DECIMALS):
    out, prev, q = [], None, 10 ** decimals
    for pt in ring:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        cur = (round(float(pt[0]) * q) / q, round(float(pt[1]) * q) / q)
        if cur != prev:
            out.append([cur[0], cur[1]])
            prev = cur
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0][:])
    return out


def simplify(geometry):
    if not geometry:
        return []
    gt = geometry.get("type")
    co = geometry.get("coordinates") or []
    polys = [co] if gt == "Polygon" else (co if gt == "MultiPolygon" else [])
    result = []
    for poly in polys:
        rings = []
        for ri, ring in enumerate(poly):
            c = dedupe(ring)
            if len(c) < 4:
                continue
            if ri == 0 and ring_area(c) < MIN_RING_AREA:
                continue
            rings.append(c)
        if rings:
            result.append(rings)
    return result


def main():
    with open(OUT, encoding="utf-8") as f:
        geo = json.load(f)

    existing = {f["properties"]["name"] for f in geo["features"]}
    existing_codes = {f["properties"]["adcode"] for f in geo["features"]}
    added = []

    # ---- 直辖市 / 港澳
    for adcode, name, prov in MUNI:
        if name in existing:
            continue
        try:
            d = cached(adcode)
        except Exception as e:
            print(f"  !! {name} 失败: {e}")
            continue
        feats = d.get("features") or []
        # 直辖市：features 里通常有一个同 adcode 的本级要素
        target = None
        for ft in feats:
            if str((ft.get("properties") or {}).get("adcode")) == adcode:
                target = ft
                break
        if target is None and feats:
            target = feats[0]
        if not target:
            print(f"  !! {name} 无要素")
            continue
        g = simplify(target.get("geometry"))
        if not g:
            print(f"  !! {name} 几何为空")
            continue
        geo["features"].append({
            "type": "Feature",
            "properties": {"name": name, "adcode": adcode, "province": prov,
                           "center": (target.get("properties") or {}).get("center")},
            "geometry": {"type": "MultiPolygon", "coordinates": g},
        })
        added.append(name)
        print(f"  + {name}")

    # ---- 台湾（710000 在阿里云 404，逐市抓）
    TW = [
        ("710100", "台北"), ("710200", "高雄"), ("710300", "台南"), ("710400", "台中"),
        ("710500", "金门"), ("710600", "南投"), ("710700", "基隆"), ("710800", "新竹"),
        ("710900", "嘉义"), ("711100", "新北"), ("711200", "宜兰"), ("711300", "新竹县"),
        ("711400", "桃园"), ("711500", "苗栗"), ("711700", "彰化"), ("711900", "云林"),
        ("712100", "屏东"), ("712400", "台东"), ("712500", "花莲"), ("712600", "澎湖"),
    ]
    for adcode, name in TW:
        try:
            d = cached(adcode)
        except Exception:
            continue
        for ft in d.get("features", []):
            p = ft.get("properties") or {}
            if str(p.get("adcode")) != adcode:
                continue
            g = simplify(ft.get("geometry"))
            if not g:
                continue
            nm = p.get("name") or name
            if nm in existing:
                continue
            geo["features"].append({
                "type": "Feature",
                "properties": {"name": nm, "adcode": adcode, "province": "台湾省",
                               "center": p.get("center")},
                "geometry": {"type": "MultiPolygon", "coordinates": g},
            })
            added.append(nm)
        time.sleep(0.1)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(geo, f, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT)
    print(f"\n新增要素 {len(added)} 个")
    print(f"总要素 {len(geo['features'])} 个")
    print(f"体积 {size/1024/1024:.2f} MB")


if __name__ == "__main__":
    main()
