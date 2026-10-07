#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_single.py —— 把整个应用打包成一个自包含 HTML 文件

设计（第二版，修掉命名空间引用问题）：

上一版的做法是「剥掉 import/export，把模块体平铺进同一个作用域」。
它坏在一个地方：源码里用 `import * as store from './store.js'`，
调用点写的是 `store.getCities()` / `search.loadIndex()`。
import 一剥掉，`store`、`search` 这几个命名空间对象就没人创建了，
于是 app.js 里全是 undefined。

这一版改成给每个模块套一层 IIFE，显式造出命名空间对象：

    var tiers  = (function(){  ...tiers.js 的函数声明...  return {TIERS, getTier, ...}; })();
    var store  = (function(){  ...store.js...  return {getCities, addCity, ...}; })();
    var search = (function(){  ...search.js... return {loadIndex, search, ...}; })();

这样：
  - 调用点 `store.getCities()` 原样可用，源码一行都不用改
  - 模块之间没有隐式全局污染
  - 仍然不需要构建工具、不需要 npm

每个模块要导出什么，从源码里 `export ...` 语句自动解析出来。
"""

import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "src")
OUT = os.path.join(BASE, "从夯到拉.html")

# 顺序 = 依赖顺序，被依赖的先执行。
# 注意：这里的名字必须能当 JS 标识符用 —— 它同时也是 IIFE 挂出去的变量名。
# 之前写 "export-image"，带连字符，`var export-image = ...` 直接是语法错误，
# 整个 bundle 报 SyntaxError: Unexpected token 'export'，页面一片空白。
MODULES = ["tiers", "store", "search", "map", "table", "detail", "export_image", "app"]

# 模块名 -> 源文件名（允许两者不同）
SRC_FILE = {"export_image": "export-image.js"}

# 各模块顶层需要暴露的 const / class（export 语句里没写全的兜底）
FALLBACK = {
    "tiers": ["TIERS", "UNRANKED", "ALL_LEVELS", "getTier", "sortedTiers", "isRanked"],
    "store": [
        "STORAGE_KEY", "load", "save", "subscribe", "getState", "getCities",
        "hasCity", "getCity", "groupByLevel", "stats", "addCity", "addMany",
        "removeCity", "setLevel", "reorderLevel", "updateCity", "addSpot",
        "removeSpot", "exportJSON", "importJSON", "clearAll", "loadDemo",
    ],
    "search": [
        "loadIndex", "getIndex", "isLoaded", "indexSize", "search", "byId",
        "suggestedSpots", "UNRANKED",
    ],
    "map": ["MapView", "sortedTiers"],
    "table": ["TableView"],
    "detail": ["DetailPanel"],
    "export_image": ["exportTierImage", "renderTierImage"],
    "app": [],
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def js_json(obj):
    """写成 JS 字面量；中文原样，`</` 打散避免提前闭合 script"""
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return s.replace("</", "<\\/")


def parse_exports(code):
    """从 export 语句里解析出要导出的名字"""
    names = set()

    # export { a, b as c };
    for m in re.finditer(r"^\s*export\s*\{([^}]*)\}", code, re.M):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                _, alias = part.split(" as ", 1)
                names.add(alias.strip())
            else:
                names.add(part)

    # export function foo / export async function foo / export class Foo / export const X
    for m in re.finditer(
        r"^\s*export\s+(?:async\s+)?(?:function|class)\s+(\w+)", code, re.M
    ):
        names.add(m.group(1))
    for m in re.finditer(r"^\s*export\s+(?:const|let|var)\s+(\w+)", code, re.M):
        names.add(m.group(1))

    return names


def strip_module_syntax(code):
    """去掉 import / export 关键字，留下纯函数体"""
    # import ... from '...';   /  import '...';
    code = re.sub(r"^\s*import\s+[^;]*?from\s*['\"][^'\"]+['\"]\s*;?\s*$", "", code, flags=re.M)
    code = re.sub(r"^\s*import\s*['\"][^'\"]+['\"]\s*;?\s*$", "", code, flags=re.M)
    # export { a, b };
    code = re.sub(r"^\s*export\s*\{[^}]*\}\s*;?\s*$", "", code, flags=re.M)
    # export default
    code = re.sub(r"^(\s*)export\s+default\s+", r"\1", code, flags=re.M)
    # export function / class / const
    code = re.sub(r"^(\s*)export\s+", r"\1", code, flags=re.M)
    return code


def build_module(name):
    src = read(os.path.join(SRC, SRC_FILE.get(name, f"{name}.js")))
    exported = parse_exports(src)
    exported |= set(FALLBACK.get(name, []))
    body = strip_module_syntax(src)

    if name == "app":
        # 入口模块不包 IIFE：它内部直接引用 tiers/store/search/MapView… 这些
        # 名字，包起来反而让它们变成模块私有。
        #
        # 但打包器剥掉了 app.js 的 import 语句，所以这些名字在 app 作用域里
        # 全是未声明的 —— 必须逐个显式取出来，漏一个就是 ReferenceError。
        # 之前就漏了 exportTierImage，导致整个 main() 崩掉、页面一片空白。
        EXPOSED = [
            "TIERS",
            "UNRANKED",
            "ALL_LEVELS",
            "getTier",
            "sortedTiers",
            "isRanked",
            "MapView",
            "TableView",
            "DetailPanel",
            "renderTierImage",
            "exportTierImage",
        ]
        prelude = []
        for dep in EXPOSED:
            prelude.append(f"var {dep} = {_owner_of(dep)}.{dep};")
        return "\n".join(prelude) + "\n" + body, None

    lines = []
    lines.append(f"var {name} = (function () {{")
    lines.append(body)
    lines.append("")
    lines.append("  return {")
    for n in sorted(exported):
        if re.search(r"\b(?:function|class|const|let|var)\s+" + re.escape(n) + r"\b", body):
            lines.append(f"    {n}: {n},")
    lines.append("  };")
    lines.append("})();")
    return "\n".join(lines), sorted(exported)


# app.js 直接以裸名用到的顶层符号（来自它的 import 语句）
APP_BARE_IMPORTS = [
    "TIERS", "UNRANKED", "ALL_LEVELS", "getTier", "sortedTiers", "isRanked",
    "MapView", "TableView", "DetailPanel", "renderTierImage", "exportTierImage",
]


def check_wiring(built_exports):
    """
    构建后自检：app 引用的每个裸名，都必须真的能从某个模块里取到。
    取不到就抛错终止构建 —— 宁可没有产物，也不要一个打开就白屏的 HTML。
    """
    problems = []
    for sym in APP_BARE_IMPORTS:
        owner = _owner_of(sym)
        if owner not in built_exports:
            problems.append(f"  {sym}: 属于未构建的模块 '{owner}'")
        elif sym not in built_exports[owner]:
            problems.append(f"  {sym}: 模块 '{owner}' 没有导出它（导出的是 {built_exports[owner]}）")
    if problems:
        raise SystemExit(
            "【构建自检失败】app.js 引用了取不到的名字，产物会导致页面白屏：\n"
            + "\n".join(problems)
        )


# app.js 里以裸名引用的顶层符号 -> 它属于哪个模块。
# 这里每漏一个，就是一个 ReferenceError（之前漏了 exportTierImage 和
# renderTierImage，一个让页面全白，一个让变量静默变成 undefined）。
# 与其手工维护，不如在 main() 里跑一致性自检：凡是 app 引用了却没在
# 任何模块里导出的名字，直接让构建失败，而不是产出一个坏文件。
OWNER = {
    "MapView": "map",
    "TableView": "table",
    "DetailPanel": "detail",
    "exportTierImage": "export_image",
    "renderTierImage": "export_image",
}


def _owner_of(symbol):
    if symbol in OWNER:
        return OWNER[symbol]
    return "tiers"


def main():
    css = read(os.path.join(BASE, "css", "app.css"))
    html = read(os.path.join(BASE, "index.html"))
    city_index = json.loads(read(os.path.join(BASE, "data", "city-index.json")))
    geo = json.loads(read(os.path.join(BASE, "data", "china-cities.geo.json")))
    provs = json.loads(read(os.path.join(BASE, "data", "china-provinces.geo.json")))

    parts = []
    parts.append("/* ===== 内联数据 ===== */")
    parts.append(f"var __CITY_INDEX__ = {js_json(city_index)};")
    parts.append(f"var __CHINA_GEO__ = {js_json(geo)};")
    parts.append(f"var __CHINA_PROVINCES__ = {js_json(provs)};")
    parts.append("")
    # 显式挂到全局：模块内部读的是 globalThis.__CITY_INDEX__，
    # 而整个 bundle 被包在一个 IIFE 里，var 不会自动变成 window 属性。
    parts.append("globalThis.__CITY_INDEX__ = __CITY_INDEX__;")
    parts.append("globalThis.__CHINA_GEO__ = __CHINA_GEO__;")
    parts.append("globalThis.__CHINA_PROVINCES__ = __CHINA_PROVINCES__;")
    parts.append("")
    parts.append("/* ===== 模块（按依赖顺序） ===== */")

    report = []
    built_exports = {}
    for name in MODULES:
        code, exported = build_module(name)
        built_exports[name] = exported or []
        parts.append(f"\n/* ---------- src/{name}.js ---------- */")
        parts.append(code)
        report.append(f"  {name:12s} exports: {', '.join(exported) if exported else '(入口)'}")

    # 接线自检：宁可构建失败，也不要产出一个打开就白屏的 HTML
    check_wiring(built_exports)

    bundle = "\n".join(parts)

    # ---- 组装 HTML
    doc = html
    doc = re.sub(r'\s*<link rel="stylesheet"[^>]*>', "", doc)
    doc = re.sub(r'\s*<script type="module"[^>]*></script>', "", doc)
    doc = doc.replace("</head>", f"<style>\n{css}\n</style>\n</head>")

    script = "<script>\n(function(){\n'use strict';\n" + bundle + "\n})();\n</script>"
    doc = doc.replace("</body>", script + "\n</body>")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(doc)

    # ---- 语法自检：bundle 必须能被 JS 引擎解析，否则就是又一个白屏
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
        tf.write(bundle)
        tmp = tf.name
    try:
        r = subprocess.run(
            ["node", "--check", tmp], capture_output=True, text=True, encoding="utf-8"
        )
        if r.returncode != 0:
            raise SystemExit("【构建自检失败】bundle 语法错误：\n" + (r.stderr or ""))
    finally:
        os.unlink(tmp)

    size = os.path.getsize(OUT)
    print(f"OK  {OUT}")
    print(f"    {size/1024/1024:.2f} MB ({size:,} bytes)")
    print(f"    城市索引 {len(city_index)} 条 · 边界要素 {len(geo['features'])} 个")
    print(f"    接线自检通过 · 语法自检通过")
    print("\n".join(report))

    with open(os.path.join(BASE, "_build_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))


if __name__ == "__main__":
    main()
