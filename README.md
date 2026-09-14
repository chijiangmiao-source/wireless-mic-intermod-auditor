# 无线话筒三阶互调（IM3）频率协调

舞台联排临近开场时，新增无线话筒可能与已有频点形成**听不见却会落入接收通道**的
三阶互调（Third-order Intermodulation, IM3）。本工具在发射机上电前，一次找出
所有会落入第三只频道接收通道的互调来源组合。

## 计算规则（全部按整数 kHz 完成）

- 对每对**不同**发射频率 `f1`、`f2` 计算两个三阶互调产物：
  - `2f1 − f2`
  - `2f2 − f1`
- 若某产物与**第三只且编号不同于两个来源**的频道距离 **≤ 0.075 MHz（75 kHz）**，
  即判为一次冲突（产物落入接收通道）。
- 频率范围 **470.000–694.000 MHz**，必须精确落在 **0.025 MHz** 刻度上，
  频道数量 **2–64** 个。
- 结果按 **受影响频道频率 → 受影响频道编号 → 两个来源编号** 升序排列；
  相同「产物 + 来源对 + 受影响频道」只保留一次。
- 每条冲突可追溯：计算式、产物频率、两只来源频道与一只受影响频道（共三只，编号互异）。

> 数学上互调冲突常成对出现：若 `2f_b − f_a = v`（命中频道 v），则 `2f_b − v = f_a`
> 也以相同距离命中频道 a，二者均会列出。

## 输入 JSON 示例

上传的 JSON 文件为 2–64 项的数组，每项**仅含**唯一整数编号 `id`、以 MHz 表示的
数值频率 `frequency`，以及可选业务名称 `name`：

```json
[
  { "id": 11, "frequency": 480.000, "name": "主唱腰包" },
  { "id": 22, "frequency": 500.000, "name": "A 位接收机" },
  { "id": 33, "frequency": 520.000 }
]
```

`name` 供频率协调员把频道编号与演员、腰包或接收机机位对应：去除首尾空白后须为
1–40 个字符，同一批内允许重复；空串、非字符串或超长值按**频道索引 + `name`
字段**整批 422。未填写时一切展示与下载仍只含编号。

上例中 `2×500.000 − 480.000 = 520.000 MHz`，恰好落在频道 #33 的接收通道，
页面明确显示 **冲突（CONFLICT）**；无任何命中时显示 **可用（CLEAR）**。
分析后可直接按业务名称辨认每条冲突的两个来源与受影响对象（频道表新增业务名称列，
冲突计算式旁列出「来源/受影响」的 `#编号 名称`，JSON 下载同步携带名称）。
整数 kHz 计算与冲突身份（产物 + 来源对 + 受影响频道）不含名称，保持不变。

## 候选频点评估（上电前预检）

完成一次基线分析后，可在同页填写一只待加入话筒的**编号**与**频率**，
点击「评估候选频点」。后端把候选加入基线重新做整批整数 kHz 计算，
以 **（受影响频道，来源对，产物）** 为规范身份对加入前后的冲突做**确定性差集**，
只返回候选结论与**新增**冲突：

- **可安全加入**：候选不引入任何新增冲突，可直接上电；
- **新增 N 处冲突**：逐条列出计算式与三只频道，候选无论是来源还是
  受影响频道都可追溯。

候选编号与现有频道重复、频率越界或偏离 25 kHz 刻度时，接口按与整批校验
相同的错误结构返回（`field` 以 `candidate.id` / `candidate.frequency` 定位），
页面清除本次候选结论并展示字段错误，**已完成的基线分析保持不变**。
候选请求**只接受原有的 `id` 与 `frequency`**：基线频道里的可选 `name` 由前端
在发请求前剥离，候选对象携带 `name` 会按非法字段 422；因此旧格式上传与不读取
名称的客户端完全不受影响。
基线本身含非法频率等错误时，也会与候选编号重复等候选错误在**同一次 422**
中逐项同时返回，不会只报其中一侧。评估成功后只要修改候选编号或频率，
页面会**立即取消上一次候选结论**，必须重新评估才会再显示安全/冲突结果。

可用方案示例：

```json
[
  { "id": 1, "frequency": 470.000 },
  { "id": 2, "frequency": 600.000 },
  { "id": 3, "frequency": 690.000 }
]
```

### 整批 422 校验

任一项非法都会使**整批返回 HTTP 422**，页面清除旧结论并**逐项**列出错误：

- `frequency` 越界（470.000–694.000 之外）或不在 0.025 MHz 刻度；
- `frequency` 不是数值或为非有限值（`NaN` / `Infinity`，包括 JSON 字面量）；
- `id` 不是整数、编号重复，或绝对值超过 `9007199254740991`（2⁵³−1，
  浏览器/JSON 安全整数上限，超出会被静默舍入成相邻整数）；
- 可选 `name` 存在但不是字符串，或去除首尾空白后为空 / 超过 40 个字符
  （同批名称允许重复；错误按该频道索引与 `name` 字段定位）；
- 缺少字段、出现额外字段、频道数量不是 2–64、顶层不是数组、JSON 无法解析。

## 架构

```
web/   React 18 + Vite（上传、逐项错误、CLEAR/CONFLICT 结论、冲突追溯、
       候选频点评估、JSON 下载）
       生产镜像为 nginx 静态站点，/api 反代到 api 服务
api/   FastAPI（/api/conflicts 整批计算 + /api/candidate 候选影响评估，
       整数 kHz 运算）
```

前端只做展示与文件读取，所有计算由 FastAPI 以整数 kHz 完成，无固定响应、无占位实现。

## 用 Docker Compose 运行（推荐）

```bash
# 可选：复制并修改宿主端口
cp .env.example .env   # WEB_PORT=8080  API_PORT=8000

docker compose up --build
```

- 前端（web/nginx）：http://localhost:${WEB_PORT:-8080}
- API 文档（FastAPI 自带 Swagger）：http://localhost:${API_PORT:-8000}/docs
- 宿主端口分别由环境变量 **`WEB_PORT`**、**`API_PORT`** 覆盖，例如
  `WEB_PORT=9090 API_PORT=9000 docker compose up --build`。

### 一次性验收服务 verify

编排中提供名为 **`verify`** 的一次性服务，它会等待 `api` 与 `web` 健康后，
用真实浏览器（Playwright）访问**正在运行**的 nginx + FastAPI，覆盖页面交互与
真实 HTTP 请求，跑完即退出：

```bash
docker compose build
docker compose up -d
docker compose run --rm verify
docker compose down
```

## 本地开发（不使用 Docker）

需要 Node.js 20+ 与 Python 3.11+。

```bash
# API（终端 1）
cd api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Web（终端 2）
cd web
npm install
npm run dev          # http://localhost:5173 ，/api 已代理到 8000
```

## 测试

| 测试 | 位置 | 覆盖内容 |
| --- | --- | --- |
| **pytest** | `api/tests` | 整数 kHz 互调计算、75 kHz 含边界、排序、去重、镜像冲突；全部 422 校验；候选评估的安全/新增冲突/非法候选链路与确定性差集；经 ASGI 的真实 HTTP API 请求 |
| **Vitest** | `web/src/**/*.test.*` | 格式化与下载载荷；React 组件的 CLEAR/CONFLICT 展示、旧结论清除、逐项错误、冲突追溯；候选安全/新增冲突/非法候选保留基线 |
| **Playwright** | `web/e2e` | 真实浏览器上传文件、结论展示、逐条冲突追溯、候选评估三条链路、JSON 下载；以及经 nginx 代理的真实 HTTP API 请求 |

```bash
# 后端
cd api && pytest

# 前端单元/组件
cd web && npm test

# 前端端到端（需先启动 api:8000；Playwright 会自动起 vite preview:4173）
cd web
npx playwright install chromium
npx playwright test
# 或指向 compose 里的 web 容器：
PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test
```

## API

`POST /api/conflicts`

请求体即频道 JSON 数组。成功返回：

```json
{
  "status": "conflict",
  "channel_count": 3,
  "conflict_count": 2,
  "channels": [
    {
      "id": 11,
      "frequency_khz": 480000,
      "frequency_mhz": 480.0,
      "name": "主唱腰包",
      "source_count": 1,
      "victim_count": 1,
      "role": "both"
    }
  ],
  "conflicts": [
    {
      "victim":  { "id": 33, "frequency_khz": 520000, "frequency_mhz": 520.0 },
      "sources": [
        { "id": 11, "frequency_khz": 480000, "name": "主唱腰包", "coefficient": 1 },
        { "id": 22, "frequency_khz": 500000, "name": "A 位接收机", "coefficient": 2 }
      ],
      "doubled_source_id": 22,
      "product_khz": 520000,
      "product_frequency_mhz": 520.0,
      "distance_khz": 0,
      "formula": "2×500.000 MHz − 480.000 MHz = 520.000 MHz（2f(频道22) − f(频道11)）"
    }
  ]
}
```

`channels` 中每项在原有 `id` / `frequency_khz` / `frequency_mhz` 之外，
附带按规范冲突身份聚合的角色摘要（纯增量字段，未读取摘要的客户端不受影响）；
填写了 `name` 的频道还会附带去空白后的规范化业务名称，未填写时**不输出**
`name` 键（旧格式批次响应逐字段不变）。冲突明细的 `victim` 与 `sources`
各项同理：有名称时附带 `name`，计算式文本与冲突身份始终不含名称。

- `source_count` / `victim_count`：该频道作为互调**来源** / **受影响频道**
  参与的（已去重）冲突条数；同一频道在同一条冲突里只计一次；
- `role`：`source`（仅来源）、`victim`（仅受影响）、`both`（两者皆是）、
  `none`（与冲突无关）。由于镜像性质（`2f_b−f_a` 命中 v 时 `2f_b−v` 必命中 a），
  凡受影响频道必然也是某条冲突的来源，纯 `victim` 实际不会出现。

结果页的频道表展示上述角色与次数；点击某一频道行可只查看该频道参与的
冲突明细（来源与受影响两个方向都算），再次点击该行恢复全部。上传新文件
或重新分析示例时，旧选择与收窄视图立即失效。

422 返回：

```json
{
  "message": "频道数据校验未通过",
  "errors": [
    { "index": 0, "field": "frequency", "message": "频率 470.013 MHz 必须精确落在 0.025 MHz 刻度上" }
  ]
}
```

页面「下载分析结果 JSON」导出的文件同时包含 `input_channels`（输入）与
`conflicts`（冲突明细）。

`POST /api/candidate`

请求体为基线频道数组加单个候选频道：

```json
{
  "channels": [
    { "id": 1, "frequency": 470.000 },
    { "id": 2, "frequency": 600.000 },
    { "id": 3, "frequency": 690.000 }
  ],
  "candidate": { "id": 4, "frequency": 535.000 }
}
```

成功时只返回候选结论与新增冲突（`new_conflicts` 中每条的结构与
`/api/conflicts` 的冲突明细一致，含计算式与三只频道）：

```json
{
  "status": "conflict",
  "candidate": { "id": 4, "frequency_khz": 535000, "frequency_mhz": 535.0 },
  "new_conflict_count": 2,
  "new_conflicts": [ ... ]
}
```

无新增冲突时 `status` 为 `safe`、`new_conflicts` 为空。候选非法时返回 422，
错误项的 `field` 为 `candidate.id` / `candidate.frequency`：

```json
{
  "message": "候选评估请求校验未通过",
  "errors": [
    { "index": null, "field": "candidate.id", "message": "候选编号 2 与现有频道重复，每个编号必须唯一" }
  ]
}
```
