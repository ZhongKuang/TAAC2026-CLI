# TAAC2026 CLI

[English](README.en.md)

把 Taiji / TAAC 训练与评估平台变成任何人和任何 agent 都能读取、比较、归档、提交训练、发布模型和收集线上评估证据的实验命令行工具。

TAAC2026 CLI 面向 `https://taiji.algo.qq.com/training`、`/model` 和 `/evaluation`：它可以抓取训练任务、指标、日志、checkpoint、代码文件，比较两个 `config.yaml` 的语义差异，发布 checkpoint 为模型，创建/停止/抓取评估任务，并通过已捕获的 Taiji API 流程准备、上传、创建和启动训练任务。所有本地产物默认收进 `taiji-output/`，不会把根目录弄得一团乱。

`SKILL.md` 是通用 agent 操作手册：Codex、Claude Code、OpenAI Agents SDK、Cursor、Aider，或者任何能读仓库文件并运行 shell 的 agent，都可以按它来使用本 CLI。

## 给 Agent 一键安装

直接把这段话发给你的 agent：

```text
请安装并使用这个通用 agent CLI：
https://github.com/ZhongKuang/TAAC2026-CLI.git

安装后请运行 npm install。需要全局 CLI 时运行 npm link。
需要浏览器模式时再安装 Chromium：
npx playwright install chromium
```

手动安装：

```bash
git clone https://github.com/ZhongKuang/TAAC2026-CLI.git
cd TAAC2026-CLI
npm install
npm link
npx playwright install chromium
```

之后可以直接运行：

```bash
taac2026 --help
```

如果当前仓库已经内置了本工具，可以直接进入 `.codex/skills/taiji-metrics-scraper/` 后运行 `npm install`，或从仓库根目录用 `node .codex/skills/taiji-metrics-scraper/bin/taac2026.mjs ...`。

## 痛点：训练平台不该占用你的工作记忆

每天早上醒来，第一反应不该是打开官网、点进一个个实例、手动检查训练曲线。但现实常常是这样：metric 一多，就要拖着鼠标在页面里上下滑，逐个找 AUC、logloss、valid/test-like 指标；刚记住一个实例的数值，切到下一个实例准备对比，前一个又忘了，只好再回去重复打开。

训练报错也一样折磨人。你要点进实例、打开 logs、复制粘贴，再解释这次跑的是哪份代码、哪个 commit、哪个 config。agent 如果拿不到日志、代码和配置的稳定快照，就只能靠你转述，很难真正定位问题。

更糟的是提交训练本身也容易出错。好不容易写了一版不错的代码，上传时却可能传错 zip、忘了换 config、只改了标题没改超参数，白白跑几个 epoch 才发现。于是每次提交都变成一场小心翼翼的人工仪式。

最关键的是，训练产出的 metric 明明应该交给 agent 跨实例分析，却常常只能靠人脑短时记忆做比较。TAAC2026 CLI 的目的就是把这些“页面劳动”变成可归档、可比较、可自动化的实验数据流。

## 我们能解决什么

| 痛点 | TAAC2026 CLI 怎么解决 |
| --- | --- |
| 每天手动点开多个实例看曲线 | 批量抓取 Job、实例、checkpoint 和 metrics，输出 `jobs.json`、`all-metrics-long.csv`、`all-checkpoints.csv`。 |
| metric 多了以后只能靠鼠标滑动和人脑记忆对比 | 把指标转成长表，保留 `jobId + instanceId + metric + step`，让 agent 可以一次性跨 Job / Run 做排序、对比和总结。 |
| 同一个 Job 多次 Run 容易混在一起 | 用 `jobId + instanceId` 区分每次运行，避免“这个 AUC 到底是哪次跑出来的”。 |
| 报错后需要手动复制日志，再口头解释代码版本 | 自动归档 Pod log、Job detail、训练代码文件和 `config.yaml`，让 agent 拿着完整现场排查。 |
| 对比两个实验配置时只能肉眼扫 YAML | `compare-config-yaml.mjs` 做语义 diff，按配置路径报告新增、删除和变化项。 |
| 上传训练容易传错 zip / config / run.sh / 标题和说明 | `prepare-taiji-submit.mjs` 先生成提交包和 manifest，记录 Job Name、Description、Git HEAD、dirty 状态和待上传文件。 |
| 想自动提交但又怕误启动训练 | `submit-taiji.mjs` 默认 dry-run；真实创建必须显式 `--execute --yes`，启动必须额外 `--run`。 |
| 线上评估分、infer 代码和失败日志只能在网页里看 | `eval scrape` 把 evaluation 任务、线上 AUC、event log 和 inference 代码一起归档。 |
| 工具产物散落根目录，越用越乱 | 所有本地产物默认写入 `taiji-output/`，包括浏览器 profile、抓取结果、提交包、dry-run/live 结果和 config diff。 |

## 它让 Agent 可以做什么

- 一键抓取最近所有训练，把实验指标整理成可分析表格。
- 帮你回答“这一版到底比上一版强在哪里，弱在哪里”。
- 结合 Job 描述、config diff、日志和曲线，定位训练报错或指标异常。
- 在提交前检查本次 zip/config/run.sh/name/description 是否和 manifest 一致。
- 复用一个稳定模板 Job，自动替换 `code.zip`、`config.yaml`，并可显式覆写 `run.sh` 后按需启动训练。
- 把训练 checkpoint 发布成模型，再创建评估任务，并把线上评估分、infer 代码和 event log 拉回本地。
- 把平台页面里的短暂信息沉淀成长期可复盘的实验资产。

## 工具地图：目前有哪些命令

这些命令的定位是“收集证据、减少误操作、打通流程”。它们不会替你拍脑袋决定哪个实验最好，但会把做判断需要的上下文一次性整理出来。

| 命令 | 能做什么 | 常见用途 |
| --- | --- | --- |
| `scrape` | 抓 Job 列表、实例、metrics、checkpoint、日志和训练代码；支持全量、增量、单 Job 定向抓取。 | 每天同步平台实验；失败后把日志和代码现场拉回本地。 |
| `diff-config` | 语义比较两个 YAML，不受字段顺序和格式影响。 | 快速确认两版 `config.yaml` 到底改了哪些参数。 |
| `prepare-submit` | 准备本地提交包，记录上传文件、Job Name、Description、Git HEAD 和 dirty 状态。 | 提交前把“打算上传什么”固化成 manifest。 |
| `submit` | dry-run 或 live 执行复制模板 Job、上传 trainFiles、创建 Job、可选 Run。 | 自动提交训练；默认安全预演，live 需要 `--execute --yes`。 |
| `submit doctor` | 检查提交包结构、文件 hash 和 manifest。 | 提交前防止 zip/config/run.sh 或说明信息错位。 |
| `submit verify` | 回读平台 trainFiles，和本地提交包做 hash / config 对齐。 | 提交后确认平台实际收到的就是本地这版。 |
| `compare jobs` | 把多个 Job 的描述、状态、best/final 指标和人工分整理成证据表。 | 少读 CSV，快速看一组实验的横向差异。 |
| `compare-runs` | 对比 base 与 exp，合并 config diff、指标差异和 checkpoint 候选。 | 判断“一次改动”带来的曲线变化，但不替你做最终决策。 |
| `config diff-ref` | 用本地 config 对齐某个明确 Job 的平台配置。 | 检查当前配置是否和某个线上实验一致。 |
| `ledger sync` | 从抓取结果同步结构化实验账本。 | 长期沉淀实验记录，方便复盘。 |
| `logs` | 从已抓日志中抽取 Error / Traceback 和尾部上下文。 | 快速定位失败原因，减少复制粘贴日志。 |
| `diagnose job` | 汇总失败 Job 的状态、日志、配置和代码线索。 | 把“为什么挂了”变成 agent 可读的诊断包。 |
| `ckpt-select` | 按显式规则列出 checkpoint 候选，例如 `valid_auc` 或 pareto。 | 找候选 checkpoint，避免手动翻曲线。 |
| `ckpt-publish` | 把训练 checkpoint 发布成 Taiji 模型；默认 dry-run，live 需确认。 | 从训练流程串到模型管理页。 |
| `model list` | 查询已发布模型，支持搜索。 | 找到要用于评估的模型 ID 和来源 Job。 |
| `eval create` | 创建评估任务；支持 `--submit-name` 从本地 `submits/*/<name>/inference_code` 上传推理包。 | 把“发布模型 -> 提交 infer -> 创建评估”串起来。 |
| `eval list` | 查看评估任务状态和分数。 | 跟踪 infer 是否成功、AUC 是否出来。 |
| `eval scrape` | 翻页抓评估任务、分数，并可下载 event log 与 inference 代码文件。 | 把线上 test AUC、infer 代码和失败/EDA 日志拉成本地证据包。 |
| `eval stop` | 停止评估任务；默认 dry-run，live 需确认。 | 停掉误提交或不想继续占资源的评估。 |

`evaluation` 是 `eval` 的别名；文档统一使用 `eval`。

## 产物地图

| 产物 | 内容 |
| --- | --- |
| `taiji-output/jobs.json` | 完整原始和归一化 Job / instance / metric / code 元数据。 |
| `taiji-output/jobs-summary.csv` | 一行一个 Job，适合快速 grep、排序和人工浏览。 |
| `taiji-output/all-metrics-long.csv` | 长表 metrics，保留 `jobId + instanceId + metric + step`。 |
| `taiji-output/all-checkpoints.csv` | checkpoint 名称、指标、发布状态和来源实例。 |
| `taiji-output/logs/<jobId>/<instanceId>.txt` | Pod 日志文本。 |
| `taiji-output/code/<jobId>/files/...` | 平台 trainFiles 下载副本。 |
| `taiji-output/code/<jobId>/job-detail.json` | Job detail 原始响应和 trainFiles 元数据。 |
| `taiji-output/config-diffs/` | config 语义 diff 输出。 |
| `taiji-output/submit-bundle/` | 本地准备好的提交包和 manifest。 |
| `taiji-output/submit-live/<timestamp>/` | live submit / run 的请求计划和响应。 |
| `taiji-output/evaluations/` | 评估任务汇总、线上分数、event log 和 inference 代码文件。 |
| `taiji-output/reports/` | compare、diagnose、model、eval 等命令的 JSON / Markdown 报告。 |
| `taiji-output/secrets/` | Cookie 或 headers 的推荐存放位置，永远不要提交。 |

## 快速开始

把浏览器里已经登录成功的 Cookie 保存到：

```text
taiji-output/secrets/taiji-cookie.txt
```

抓取全部训练任务：

```bash
taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

增量同步会完整扫描 Job list，但对本地已有、终态、且 `updateTime/status/jzStatus` 没变的 Job 跳过 detail、代码、实例、metric 和 log 的深拉：

```bash
taac2026 scrape --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

只核查某个 Job 的详情、代码文件和指标时，可以按平台内部 ID 定向抓取：

```bash
taac2026 scrape --all --job-internal-id 56242 --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

服务器上 Chromium 不稳定时，用后端直连模式：

```bash
taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

比较两个配置：

```bash
taac2026 diff-config old-config.yaml new-config.yaml
taac2026 diff-config old-config.yaml new-config.yaml --json --out diff.json
```

`--out diff.json` 会写到 `taiji-output/config-diffs/diff.json`，不会掉到根目录。

## 日常实验工具

这些工具只整理证据和拦截低级错误，不替你决定哪个实验更值得提交。

提交前检查 bundle：

```bash
taac2026 submit doctor --bundle taiji-output/submit-bundle
```

提交后回读平台文件，确认平台实际 `code.zip/config.yaml/run.sh` 和本地 bundle 一致：

```bash
taac2026 scrape --all --job-internal-id 56242 --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
taac2026 submit verify --bundle taiji-output/submit-bundle --job-internal-id 56242
```

跨实验整理指标、描述里的人工 test 分、valid/test-like 曲线证据：

```bash
taac2026 compare jobs 56242 58244 --json
```

对比一个 base 和一个实验 Job，合并 config diff、best/final 指标差异、同向性和候选 checkpoint 规则结果：

```bash
taac2026 compare-runs --base 58244 --exp 56242 --config --metrics --json
```

比较当前配置和某个明确 Job 的平台配置，不做“最高分对齐”假设：

```bash
taac2026 config diff-ref --config config.yaml --job-internal-id 56242 --json
```

同步结构化实验账本，或诊断失败 Job：

```bash
taac2026 ledger sync
taac2026 diagnose job --job-internal-id 56242 --json
```

快速抽取错误日志，或按明确指标规则列出 checkpoint 候选：

```bash
taac2026 logs --job 60414 --errors --tail 100 --json
taac2026 ckpt-select --job 56242 --by valid_auc --json
```

把指定训练 checkpoint 发布成模型。默认 dry-run，只生成计划；真正发布必须显式 `--execute --yes`。默认模型名为 `<Job Name> epoch<N> val auc <AUC>`，描述复用 Job Description。若缓存里目标 checkpoint 已经是发布态，live 发布会被拦住，除非额外传 `--force`，避免重复创建模型。

```bash
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --json
taac2026 ckpt-publish --job 56242 --by valid_auc --json
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --instance-id 95cdb4769de33483019df8ac5f843305 --json
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --json
```

查看已发布模型，创建或停止评估任务。`eval create` 默认 dry-run。推荐用 `--submit-name` 从本地 `submits/<日期>/<提交包名>/inference_code` 里找到打包机已经整理好的推理代码，并上传该目录第一层所有文件。`--file-dir` 是手动兜底路径，默认只打包 `dataset.py`、`dense_transform.py`、`eda.py`、`infer.py`、`model.py` 这几个直接文件，避免误把仓库根目录杂物传上去。真实创建必须显式 `--execute --yes`。

```bash
taac2026 model list --cookie-file taiji-output/secrets/taiji-cookie.txt --search "V1.4.6" --out model-list.json
taac2026 eval create --model-id 29132 --creator ams_2026_1029735554728157691 --submit-name V1.4.6_fusion_time_item_dense_main7683bde --out eval-create.json
taac2026 eval create --model-name "1.4.6 epoch" --submit-name V1.4.6_fusion_time_item_dense_main7683bde --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-create.json
taac2026 eval create --model-search "1.4.6" --submits-root ./submits --submit-name V1.4.6_fusion_time_item_dense_main7683bde --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-create.json
taac2026 eval list --cookie-file taiji-output/secrets/taiji-cookie.txt --page-size 20 --out eval-list.json
taac2026 eval scrape --task-id 62726 --logs --code --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-scrape.json
taac2026 eval create --model-id 29132 --creator ams_2026_1029735554728157691 --submit-name V1.4.6_fusion_time_item_dense_main7683bde --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --out eval-create-live.json
taac2026 eval stop --task-id 62362 --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --out eval-stop-live.json
```

`eval create` 还支持 `--image-name`、`--include-all-files` 等低频选项；`--include-all-files` 会上传目录第一层所有文件，使用前应明确确认。`model list`、`eval create/list/stop` 默认打印 JSON；传 `--out xxx.json` 时会写入 `taiji-output/reports/xxx.json`。

`eval scrape` 会写入 `taiji-output/evaluations/eval-summary.csv`、`eval-tasks.json`、`logs/<evalTaskId>.txt` 和 `code/<evalTaskId>/files/...`。它只抓证据，不创建或启动评估任务。`--out-dir` 是显式输出目录：默认是 `taiji-output/evaluations/`；如果写 `--out-dir foo`，会写到当前目录下的 `foo`，不是自动变成 `taiji-output/foo`。推荐自定义时写成 `--out-dir taiji-output/evaluations-<name>`。

## 自动提交训练

提交链路分两层：先准备，再执行。默认只 dry-run，不会误上传、误创建、误启动。

### 推荐提交包形态

公开版推荐使用最简单、最稳定的 Taiji trainFiles 形态：

```text
code.zip
run.sh
config.yaml
```

- `code.zip` 放项目代码，由你的仓库脚本或 agent 打包生成。
- `run.sh` 是平台入口，负责解压/定位代码并读取 `config.yaml` 启动训练。
- `config.yaml` 放本次实验参数。

本仓库提供了一个不含真实代码的最小示例：

```text
examples/minimal-taiji-submit/
  code/
  run.sh
  config.yaml
```

你的 agent 可以参考这个形态打包：把项目代码放进 `code.zip`，把实验参数写入 `config.yaml`，用 `run.sh` 作为统一入口。自动提交脚本默认替换 `code.zip` 和 `config.yaml`；如果传入 `--run-sh ./run.sh`，也会显式覆写模板里的同名 `run.sh`。模板 Job 里必须已有这些同名 trainFiles；只有明确加 `--allow-add-file` 时才允许新增。

如果别人的模板不是 zip 形态，而是散文件，例如 `main.py + dataset.py + run.sh`，也可以用通用文件适配：

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --file-dir "./taiji-files" \
  --name "loose_files_exp"
```

`--file-dir` 只扫描目录第一层文件；自动识别 `code.zip`、`config.yaml`、`run.sh`，其他第一层文件都会进入 generic trainFiles。比如目录里有：

```text
taiji-files/
  dataset.py
  model.py
  ns_groups.json
  run.sh
  train.py
  trainer.py
  utils.py
```

就会准备覆写同名 `run.sh`，以及 `dataset.py/model.py/ns_groups.json/train.py/trainer.py/utils.py` 这些散文件。子目录会被忽略，避免不小心把项目目录整体传上去。

也可以单独列文件：

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip "./submits/0505/V1.4.0/code.zip" \
  --config "./submits/0505/V1.4.0/config.yaml" \
  --run-sh "./submits/0505/V1.4.0/run.sh" \
  --file "./main.py" \
  --file "./local_dataset.py=dataset.py" \
  --name "v1.4.0_mixed_files"
```

`--file ./main.py` 会按 basename 替换模板里的 `main.py`；`--file ./local_dataset.py=dataset.py` 会把本地文件上传后替换模板里的 `dataset.py`。`code.zip`、`config.yaml`、`run.sh` 是一等文件名，不能通过 `--file` 传，必须使用 `--zip`、`--config`、`--run-sh`，或让 `--file-dir` 自动识别。

准备一个提交包：

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip "./submits/0505/V1.4.0/code.zip" \
  --config "./submits/0505/V1.4.0/config.yaml" \
  --run-sh "./submits/0505/V1.4.0/run.sh" \
  --name "v1.4.0_item_reinit" \
  --description "item id reinit + dense transform" \
  --run
```

不传 `--run-sh` 时会沿用模板 Job 里的旧 `run.sh`。

它会写入：

```text
taiji-output/submit-bundle/
  manifest.json
  NEXT_STEPS.md
  files/code.zip
  files/config.yaml
  files/run.sh        # 仅在传入 --run-sh 时存在
  files/generic/...   # 仅在传入 --file 或 --file-dir 发现散文件时存在
```

生成 dry-run 提交计划：

```bash
taac2026 submit \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID>
```

真实上传并创建 Job：

```bash
taac2026 submit \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> \
  --execute --yes
```

上传、创建并启动训练：

```bash
taac2026 submit \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> \
  --execute --yes --run
```

只有用户明确要启动训练时才加 `--run`；普通上传验证先用上一段 create-only 命令。

如果模板 Job 里没有同名 `code.zip`、`config.yaml`，或在传入 `--run-sh` / `--file` / `--file-dir` 时没有对应同名 trainFile，脚本会默认报错，避免旧文件和新文件同时存在。只有明确要新增 trainFiles 时才加：

```bash
taac2026 submit ... --execute --yes --allow-add-file
```

## 安全默认值

- Cookie、HAR、headers 建议放在 `taiji-output/secrets/` 或 `taiji-output/har/`，不要提交。
- 所有脚本默认把本地产物写到 `taiji-output/`。
- 相对输出路径不能包含 `..`；如果确实要写到外部位置，请使用绝对路径。
- `eval scrape --out-dir` 是显式目录参数；默认是 `taiji-output/evaluations/`，自定义时推荐仍写在 `taiji-output/` 下。
- `submit-taiji.mjs` 默认 dry-run。
- 真实平台写操作必须显式加 `--execute --yes`。
- 启动训练必须额外显式加 `--run`。
- `ckpt-publish --force`、`submit --allow-add-file`、`eval create --include-all-files` 都需要额外确认。
- 脚本会保留模板 Job 的环境、镜像和入口；默认严格替换模板中已有的 `code.zip` 和 `config.yaml`，传入 `--run-sh` 时才严格替换同名 `run.sh`，传入 `--file` 或 `--file-dir` 时才严格替换对应通用文件。

## 输出目录

```text
taiji-output/
  jobs.json
  jobs-summary.csv
  all-checkpoints.csv
  all-metrics-long.csv
  browser-profile/
  code/<jobId>/
  config-diffs/
  evaluations/
    eval-summary.csv
    eval-tasks.json
    code/<evalTaskId>/
    logs/<evalTaskId>.txt
  ledger/
    experiments.json
  logs/<jobId>/
  reports/
  secrets/
  submit-bundle/
  submit-live/<timestamp>/
```

推荐在业务仓库里加入：

```gitignore
taiji-output/
```

## 什么时候使用

适合这些场景：

- 想让 agent 总结一批 Taiji Job 的训练指标。
- 想比较两个实验版本的 `config.yaml`。
- 想把每个 Job 的代码、日志、checkpoint 和指标归档起来。
- 想用一个已成功的模板 Job 自动提交下一组代码和配置。
- 想让 agent 先整理历史实验的证据，再由人和 agent 共同判断下一步策略。

不适合这些场景：

- Cookie 已经过期或被出口 IP / 浏览器指纹绑定。
- 平台接口发生变化且没有新的 DevTools 请求样本。
- 需要完全无人工确认地消耗线上训练资源。

## 脚本清单

| 脚本 | 用途 |
| --- | --- |
| `bin/taac2026.mjs` / `taac2026` | 统一 CLI 入口，分发到下列子命令 |
| `scripts/scrape-taiji.mjs` | 抓取 Job、实例、指标、日志、checkpoint、代码文件 |
| `scripts/compare-config-yaml.mjs` | 语义比较两个 YAML 配置 |
| `scripts/prepare-taiji-submit.mjs` | 准备本地提交包，记录 Git 状态和上传文件 |
| `scripts/submit-taiji.mjs` | dry-run 或显式执行 Taiji 上传、创建、Run 流程 |
| `scripts/experiment-tools.mjs` | 提交前检查、提交后回读校验、实验对比、账本同步、日志诊断、checkpoint 选择与发布 |
| `scripts/evaluation-tools.mjs` | 模型列表、评估创建 dry-run / live、评估列表、评估证据抓取和停止 |

## 故障判断

- `401` / `403`：Cookie 过期、缺失，或登录态绑定了出口环境。
- Playwright 失败但 `--direct` 成功：优先用 `--direct`。
- 两种模式都 `401`：先在同一机器上测试完整 `Copy as cURL`。
- Job 有实例但指标为空：可能是任务失败、实例未产出 metrics，或平台响应结构变化。
- 代码文件下载失败：先看 `code/<jobId>/job-detail.json` 和 `train-files.json`。脚本会优先把 `trainFiles[].path` 当 COS key，用 federation token 下载；如果拿到平台前端 HTML、zip 魔数不对、`config.yaml` 不是 mapping，或大小不匹配，会标为失败而不是悄悄保存假文件。

## 开发验证

```bash
npm run check
npm run test
```

`check` 会对所有 bundled scripts 执行 `node --check`；`test` 会跑提交安全和输出路径的小型行为测试。
