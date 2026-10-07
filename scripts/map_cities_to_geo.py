#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为城市索引建立「边界要素」映射，并输出最终渲染清单。

关键设计：
  - 地级市 / 直辖市 / 州  → 用边界多边形填色
  - 县级旅游重镇（敦煌、婺源、赤水…）→ 画高亮点位，标注其所属地级市

输出：
  data/city-index.json 增加字段
    geo: { kind: "area"|"dot", adcode, boundaryName }
"""
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name):
    with open(os.path.join(BASE, "data", name), encoding="utf-8") as f:
        return json.load(f)


def save(name, obj):
    with open(os.path.join(BASE, "data", name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def norm(s):
    """归一化名称用于匹配：去掉市/地区/自治州等后缀与民族修饰"""
    s = s.strip()
    s = re.sub(r"(特别行政区|自治区|省|市|地区|盟)$", "", s)
    # 自治州全称 → 核心地名：湘西土家族苗族自治州 → 湘西
    m = re.match(r"^(.+?)(蒙古族|藏族|羌族|彝族|苗族|侗族|布依族|傣族|白族|哈尼族|壮族|回族|土家族|傈僳族|拉祜族|佤族|纳西族|景颇族|柯尔克孜|哈萨克|维吾尔|朝鲜族|锡伯族|达斡尔族)", s)
    if m:
        return m.group(1)
    s = re.sub(r"(自治州|自治县|州|县)$", "", s)
    return s


def main():
    geo = load("china-cities.geo.json")
    index = load("city-index.json")

    feats = geo["features"]
    by_norm = {}
    for f in feats:
        p = f["properties"]
        by_norm.setdefault(norm(p["name"]), []).append(p)

    report = []
    area_cnt = dot_cnt = none_cnt = 0

    for c in index:
        cn = norm(c["name"])
        cands = by_norm.get(cn, [])

        # 无直接命中时，按省 + 名称前缀再找一次
        if not cands:
            for f in feats:
                p = f["properties"]
                if p["province"] == c["province"] and (cn in norm(p["name"]) or norm(p["name"]) in cn):
                    cands.append(p)
                    break

        if cands:
            p = cands[0]
            # 直辖市/地级市 → 面积填色；索引名与边界名一致
            if norm(p["name"]) == cn:
                c["geo"] = {"kind": "area", "adcode": p["adcode"], "boundaryName": p["name"]}
                area_cnt += 1
            else:
                c["geo"] = {"kind": "dot", "adcode": p["adcode"], "boundaryName": p["name"]}
                dot_cnt += 1
        else:
            c["geo"] = {"kind": "dot", "adcode": None, "boundaryName": None}
            none_cnt += 1
            report.append(f"{c['name']} ({c['province']})")

    save("city-index.json", index)

    lines = [
        f"地级市边界要素：{len(feats)}",
        f"索引城市：{len(index)}",
        "",
        f"→ 面积填色 (area): {area_cnt}",
        f"→ 点位标记 (dot，含县级重镇): {dot_cnt}",
        f"→ 无边界且无需边界: {none_cnt}",
        "",
        "--- 完全没有边界归属的城市 ---",
    ] + [f"  {x}" for x in report]

    with open(os.path.join(BASE, "_map_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("written")


if __name__ == "__main__":
    main()
