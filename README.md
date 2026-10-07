# 从夯到拉 · 我的城市旅游排行

把自己去过的城市按网上的「从夯到拉」五档排名，地图按等级填色，一键导出竖版排行长图。

**在线访问**：https://1banana1.github.io/hanglatravel/

## 这是什么

一个纯静态 Web 应用，零依赖、零后端、离线可用。手机和电脑都能跑，数据存在浏览器本地。

五档从高到低：**夯 → 顶级 → 人上人 → NPC → 拉完了**（外加「未定级」待你手动定级）。

## 三种打开方式

### 方式一：直接访问线上版（最省事）

打开 https://1banana1.github.io/hanglatravel/ 就能用。

手机上可以「添加到主屏幕」，之后点图标全屏打开，没有浏览器地址栏，跟原生 App 一样。已注册 Service Worker，断网也能开。

### 方式二：单文件版（适合离线分发）

下载 [`单文件版.html`](单文件版.html)（或仓库根目录的 `从夯到拉.html`，两者内容相同），发到手机上用浏览器打开。所有 JS/CSS/数据都内联在这一个文件里，**零安装、零服务器、不需要联网**。

- 微信/QQ 传给自己 → 点开 → 选「用浏览器打开」
- iPhone 用 Safari 打开后可「添加到主屏幕」

> 单文件版的容量是部署版的约 5 倍（3 MB vs 0.6 MB 首屏），因为地图数据以 JSON 字面量内联，无法被 gzip 压缩。

### 方式三：本地起服务（适合改代码）

```bash
python -m http.server 8899
# 打开 http://127.0.0.1:8899/
```

## 功能

- **搜城市即添加** —— 470 座城市，含敦煌、婺源、赤水这类县级旅游重镇。列表本身就是「去过清单」，加了就算去过
- **六档定级** —— 夯 / 顶级 / 人上人 / NPC / 拉完了 / 未定级
- **表格拖拽** —— 鼠标直接拖，手机上长按 180ms 后拖；同档内可重排
- **省份筛选 + 城市/景点搜索**
- **地图填色** —— 370 个地级市边界按等级填色，省级界线单独描边，县级重镇用点位标记
- **城市详情** —— 点进去能加著名景点、写备注
- **导出竖版长图** —— 一键生成 2160px 宽的排行 PNG，可以直接发朋友圈
- **备份/导入** —— 导出 JSON 备份，换设备可搬

## 数据和隐私

**所有数据都只存在你自己浏览器的 localStorage 里，不上传任何服务器，彼此看不见对方的榜单。**

⚠️ 换浏览器、换设备、清理浏览器数据都会丢，重要数据记得用「备份」导出 JSON。

## 目录结构

```
index.html                 入口（走 ES module，Pages 的首页）
单文件版.html               单文件构建产物（可直接分发，与 从夯到拉.html 同内容）
manifest.json              PWA 清单（「添加到主屏幕」用）
sw.js                      Service Worker（离线缓存）
css/app.css                样式（桌面左右分栏 / 手机单栏 + 底部标签栏）
icons/                     应用图标（SVG + 多尺寸 PNG，含 maskable）
src/
  tiers.js                 五档定义与配色
  store.js                 localStorage 状态、导入导出、订阅
  search.js                搜索即添加（评分排序）
  table.js                 Tier 表 + 拖拽
  map.js                   SVG 地图 + 手写投影 + 省界/填色/点位分层
  detail.js                城市详情面板
  export-image.js          原生 Canvas 绘制竖版排行长图
  app.js                   装配层
data/
  city-index.json          471 条城市索引（含别名、geo 归属）
  china-cities.geo.json    370 个地级市边界
  china-provinces.geo.json 35 个省级轮廓
scripts/
  build_single.py          单文件打包（含接线自检 + 语法自检）
  gen_city_index.py        生成城市索引
  gen_city_geo.py          抓取地级市边界
  patch_geo.py             补直辖市/港澳/台湾
  map_cities_to_geo.py     城市 -> 边界映射
  gen_icons.py             生成 PWA 图标 PNG
docs/验收记录.md            验收断言与已修 Bug 根因
```

## 重新构建单文件

```bash
python scripts/build_single.py
```

构建脚本会做两项自检，任一失败就终止并且**不产出文件**：

1. **接线自检** —— app.js 裸名引用的每个符号都必须真能从对应模块取到（曾经漏配一个导致整页白屏）
2. **语法自检** —— bundle 交给 `node --check` 解析

## 技术说明

- **零依赖**：没有 CDN、没有 npm、没有构建步骤也能跑源码版
- **地图是自己画的**：手写等距圆柱投影，SVG 分四层（`.layer-cities` / `.layer-city-areas` / `.layer-prov-borders` / `.layer-dots`），省界线独立成层叠在地级市之上，否则几百条市界混在一起看不出省份分界
- **出图不依赖任何截图库**：单文件版不能联网，所以 `export-image.js` 用原生 Canvas 2D 直接画
- **两种分发形态体积差异**：部署版首屏约 0.6 MB。地图数据是 JSON（gzip 能压掉约 75%），单文件版因为要内联成 JS 字面量无法被压缩，所以是 3 MB
- **离线**：Service Worker 预缓存应用外壳与地图数据；导航走 network-first（保证能拿到更新），静态资源走 stale-while-revalidate（秒开）
- **边界数据源**：[阿里云 DataV 行政区划](https://geo.datav.aliyun.com/areas_v3/bound/)（公开服务）

## 已知问题

- 出图排版还有三处待修：档位计数角标压在档位名上、档位列宽不足导致「人上人」溢出、城市卡片未铺满整行
- 台湾采用省级整体轮廓（DataV 未提供台湾下级边界数据）

## 部署

仓库是纯静态站点，GitHub Pages 开箱即用：

1. 仓库 → **Settings** → **Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 `/ (root)`，Save
4. 等约 1 分钟，访问 https://1banana1.github.io/hanglatravel/

不需要任何构建步骤，也不需要 GitHub Actions——所有文件都是可直接托管的静态资源。

## 来源

「从夯到拉」是网上流行的 Tier List 中文本土化分级黑话，五档含义：

| 档位 | 含义 |
|---|---|
| 夯 | 天花板 / 封神 |
| 顶级 | 行业标杆 |
| 人上人 | 中上游，值得冲 |
| NPC | 平庸路人甲 |
| 拉完了 | 地板砖 / 烂透 |
