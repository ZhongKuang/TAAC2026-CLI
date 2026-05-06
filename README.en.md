# TAAC2026 CLI

[中文](README.md)

Turn the Taiji / TAAC training and evaluation platform into an experiment CLI that humans and agents can read, compare, archive, submit, run, publish models from, and collect online evaluation evidence from.

TAAC2026 CLI targets `https://taiji.algo.qq.com/training`, `/model`, and `/evaluation`. It can scrape training jobs, metrics, logs, checkpoints, and training code; compare two `config.yaml` files semantically; publish checkpoints as models; create, stop, and scrape evaluation tasks; and prepare or explicitly execute the captured Taiji submit workflow. All local artifacts default to `taiji-output/`, keeping your repository root clean.

`SKILL.md` is a universal agent runbook. Codex, Claude Code, OpenAI Agents SDK, Cursor, Aider, or any agent that can read repository files and run shell commands can use this CLI.

## One-Message Install For Agents

Send this to your agent:

```text
Please install and use this universal agent CLI:
https://github.com/ZhongKuang/TAAC2026-CLI.git

After installation, run npm install. Run npm link when a global CLI is useful.
Install Chromium only when browser mode is needed:
npx playwright install chromium
```

Manual installation:

```bash
git clone https://github.com/ZhongKuang/TAAC2026-CLI.git
cd TAAC2026-CLI
npm install
npm link
npx playwright install chromium
```

Then run:

```bash
taac2026 --help
```

If this tool is already bundled inside your project, run `npm install` from `.codex/skills/taiji-metrics-scraper/`, or call `node .codex/skills/taiji-metrics-scraper/bin/taac2026.mjs ...` from the repository root.

## The Pain: Training Platforms Should Not Own Your Working Memory

The first thing you do in the morning should not be opening the web console, clicking through instance after instance, and manually checking training curves. But that is often the reality: once there are many metrics, you scroll through the page, inspect AUC, logloss, valid, and test-like charts one by one, remember a few numbers, switch to the next instance, then immediately forget the previous run and reopen it again.

Debugging is just as clumsy. When training fails, you open logs, copy and paste snippets, then explain which commit, code package, and config produced that error. If the agent cannot access a stable snapshot of logs, code, and configuration, it can only rely on your retelling.

Submission is another source of silent waste. After writing a promising change, it is easy to upload the wrong zip, forget to replace config, update only the title while leaving old hyperparameters, and discover the mistake several epochs later. Every submit becomes a careful manual ritual.

Most importantly, metrics should be compared by an agent across runs, not by human short-term memory. TAAC2026 CLI turns page labor into an archivable, comparable, automatable experiment data flow.

## What It Solves

| Pain | How TAAC2026 CLI helps |
| --- | --- |
| Opening many instances manually to inspect curves | Bulk scrape Jobs, instances, checkpoints, and metrics into `jobs.json`, `all-metrics-long.csv`, and `all-checkpoints.csv`. |
| Comparing many metrics by scrolling and memory | Export long-form metrics with `jobId + instanceId + metric + step`, so agents can rank, compare, and summarize across Jobs and reruns. |
| Multiple runs under one Job are easy to mix up | Use `jobId + instanceId` as the run identity, so each metric belongs to the right execution. |
| Failed runs require manual log copying and version explanation | Archive pod logs, Job detail, training code files, and `config.yaml` together, giving the agent the full scene. |
| Config comparison requires eyeballing YAML | `compare-config-yaml.mjs` reports semantic added, removed, and changed entries by config path. |
| Submits can silently use the wrong zip / config / run.sh / title / description | `prepare-taiji-submit.mjs` creates a manifest with Job Name, Description, Git HEAD, dirty state, and exact upload files. |
| Automation is useful but accidental training starts are expensive | `submit-taiji.mjs` is dry-run by default; live creation requires `--execute --yes`, and start requires `--run`. |
| Online evaluation scores, infer code, and failure logs are stuck in the web UI | `eval scrape` archives evaluation tasks, online AUC, event logs, and inference code together. |
| Tool artifacts clutter the repository root | All local artifacts default to `taiji-output/`, including browser profile, scrape output, bundles, live results, and config diffs. |

## What Agents Can Do With It

- Scrape recent training jobs and turn platform metrics into analyzable tables.
- Answer "where is this run better or worse than the previous version?"
- Use Job descriptions, config diffs, logs, and curves to investigate failures or metric anomalies.
- Check whether the zip/config/run.sh/name/description match the intended manifest before submit.
- Reuse a known-good template Job, replace `code.zip` and `config.yaml`, optionally overwrite `run.sh`, and optionally start training.
- Publish training checkpoints as models, create evaluation tasks, and pull online scores, infer code, and event logs back into local evidence.
- Preserve transient web-console information as durable experiment assets.

## Tool Map: Available Commands

These commands are meant to collect evidence, reduce manual mistakes, and connect workflows. They do not decide which experiment is best for you; they make the context easy for humans and agents to judge.

| Command | What it does | Common use |
| --- | --- | --- |
| `scrape` | Scrapes Job lists, instances, metrics, checkpoints, logs, and training code; supports full, incremental, and targeted Job sync. | Daily platform sync; pull logs and code context after a failure. |
| `diff-config` | Compares two YAML files semantically, independent of field order and formatting. | See exactly which `config.yaml` parameters changed. |
| `prepare-submit` | Builds a local submit bundle and records upload files, Job Name, Description, Git HEAD, and dirty state. | Freeze the intended submission as a manifest before upload. |
| `submit` | Dry-runs or executes copy-template, trainFile upload, Job creation, and optional Run. | Automate training submission; live mode requires `--execute --yes`. |
| `submit doctor` | Checks submit bundle structure, file hashes, and manifest. | Catch mismatched zip/config/run.sh or description before submission. |
| `submit verify` | Reads platform trainFiles back and compares them with the local bundle. | Confirm the platform received the exact intended files. |
| `compare jobs` | Summarizes multiple Jobs with descriptions, status, best/final metrics, and manually recorded scores. | Compare a set of experiments without digging through CSVs. |
| `compare-runs` | Compares a base Job and an experiment Job with config diff, metric deltas, and checkpoint candidates. | Inspect what one change did to curves, without outsourcing the final decision. |
| `config diff-ref` | Compares a local config against one explicit platform Job config. | Check whether local config matches a known online experiment. |
| `ledger sync` | Syncs a structured experiment ledger from scraped outputs. | Keep long-term experiment records for review. |
| `logs` | Extracts Error / Traceback snippets and tail context from scraped logs. | Diagnose failures without manual log copy-paste. |
| `diagnose job` | Bundles failed Job status, logs, config, and code evidence. | Give an agent a compact "why did this fail?" package. |
| `ckpt-select` | Lists checkpoint candidates by explicit rules such as `valid_auc` or pareto. | Find checkpoint candidates without manually scanning curves. |
| `ckpt-publish` | Publishes a training checkpoint as a Taiji model; dry-run by default. | Bridge training output into model management. |
| `model list` | Lists published models with optional search. | Resolve the model ID and source Job for evaluation. |
| `eval create` | Creates evaluation tasks; supports `--submit-name` to upload local `submits/*/<name>/inference_code`. | Connect "publish model -> submit infer -> create evaluation". |
| `eval list` | Lists evaluation status and scores. | Track whether inference succeeded and whether AUC is available. |
| `eval scrape` | Pages through evaluation tasks and optionally downloads event logs and inference code files. | Pull online test AUC, inference code, and failure/EDA logs into a local evidence bundle. |
| `eval stop` | Stops an evaluation task; dry-run by default. | Stop mistaken or resource-wasting evaluations. |

`evaluation` is an alias for `eval`; docs use `eval` consistently.

## Artifact Map

| Artifact | Contains |
| --- | --- |
| `taiji-output/jobs.json` | Complete raw and normalized Job / instance / metric / code metadata. |
| `taiji-output/jobs-summary.csv` | One row per Job for quick grep, sorting, and human browsing. |
| `taiji-output/all-metrics-long.csv` | Long-form metrics keyed by `jobId + instanceId + metric + step`. |
| `taiji-output/all-checkpoints.csv` | Checkpoint names, metrics, publish status, and source instances. |
| `taiji-output/logs/<jobId>/<instanceId>.txt` | Pod log text. |
| `taiji-output/code/<jobId>/files/...` | Downloaded platform trainFiles. |
| `taiji-output/code/<jobId>/job-detail.json` | Raw Job detail response and trainFiles metadata. |
| `taiji-output/config-diffs/` | Semantic config diff output. |
| `taiji-output/submit-bundle/` | Prepared local submit bundle and manifest. |
| `taiji-output/submit-live/<timestamp>/` | Live submit / run plans and responses. |
| `taiji-output/evaluations/` | Evaluation task summaries, online scores, event logs, and inference code files. |
| `taiji-output/reports/` | JSON / Markdown reports from compare, diagnose, model, and eval commands. |
| `taiji-output/secrets/` | Recommended location for cookies or headers. Never commit it. |

## Quick Start

Save a valid Cookie from a logged-in browser request to:

```text
taiji-output/secrets/taiji-cookie.txt
```

Scrape all training jobs:

```bash
taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

Incremental sync still scans the full Job list, but skips detail, code, instance, metric, and log fetches for cached terminal Jobs whose `updateTime/status/jzStatus` are unchanged:

```bash
taac2026 scrape --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

To inspect one Job's detail, code files, and metrics, target the internal Taiji ID:

```bash
taac2026 scrape --all --job-internal-id 56242 --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

Use direct backend mode when Chromium is unreliable on a server:

```bash
taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

Compare two configs:

```bash
taac2026 diff-config old-config.yaml new-config.yaml
taac2026 diff-config old-config.yaml new-config.yaml --json --out diff.json
```

`--out diff.json` writes to `taiji-output/config-diffs/diff.json`, not the repository root.

## Daily Experiment Tools

These commands organize evidence and catch avoidable mistakes. They do not decide which experiment is best.

Check a prepared bundle before submit:

```bash
taac2026 submit doctor --bundle taiji-output/submit-bundle
```

After submit, scrape the new Job and verify the platform-side `code.zip/config.yaml/run.sh` against the local bundle:

```bash
taac2026 scrape --all --job-internal-id 56242 --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
taac2026 submit verify --bundle taiji-output/submit-bundle --job-internal-id 56242
```

Compare multiple Jobs as an evidence table with metrics, manually recorded test scores, and curve summaries:

```bash
taac2026 compare jobs 56242 58244 --json
```

Compare one base Job against one experiment Job with config diff, best/final metric deltas, direction checks, and checkpoint candidates by explicit rule:

```bash
taac2026 compare-runs --base 58244 --exp 56242 --config --metrics --json
```

Compare a local config against one explicit Job reference, without assuming any "best score" policy:

```bash
taac2026 config diff-ref --config config.yaml --job-internal-id 56242 --json
```

Sync a structured experiment ledger, or extract diagnosis evidence from a failed Job:

```bash
taac2026 ledger sync
taac2026 diagnose job --job-internal-id 56242 --json
```

Extract error logs quickly, or list checkpoint candidates by an explicit metric rule:

```bash
taac2026 logs --job 60414 --errors --tail 100 --json
taac2026 ckpt-select --job 56242 --by valid_auc --json
```

Publish one training checkpoint as a model. Dry-run is the default; live publishing requires explicit `--execute --yes`. The default model name is `<Job Name> epoch<N> val auc <AUC>`, and the description reuses the Job Description. If cached `all-checkpoints.csv` already marks the checkpoint as published, live publishing is blocked unless `--force` is passed, to avoid duplicate models.

```bash
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --json
taac2026 ckpt-publish --job 56242 --by valid_auc --json
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --instance-id 95cdb4769de33483019df8ac5f843305 --json
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --json
```

List published models, create evaluations, or stop evaluations. `eval create` is dry-run by default. Prefer `--submit-name` so the CLI resolves the prepared inference package under `submits/<date>/<submit-name>/inference_code` and uploads every direct file from that curated directory. `--file-dir` is the manual fallback; by default it includes only direct `dataset.py`, `dense_transform.py`, `eda.py`, `infer.py`, and `model.py` files, so a repository root is not uploaded accidentally. Live creation requires explicit `--execute --yes`.

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

`eval create` also supports lower-frequency options such as `--image-name` and `--include-all-files`; `--include-all-files` uploads every direct file in the directory, so confirm it explicitly before use. `model list` and `eval create/list/stop` print JSON by default; with `--out xxx.json`, they write to `taiji-output/reports/xxx.json`.

`eval scrape` writes `taiji-output/evaluations/eval-summary.csv`, `eval-tasks.json`, `logs/<evalTaskId>.txt`, and `code/<evalTaskId>/files/...`. It only collects evidence; it does not create or start evaluation tasks. `--out-dir` is an explicit output directory: the default is `taiji-output/evaluations/`; `--out-dir foo` writes to `./foo`, not `taiji-output/foo`. Prefer `--out-dir taiji-output/evaluations-<name>` for custom folders.

## Submit Training

The submit workflow has two layers: prepare first, execute later. The default is safe dry-run; no upload, Job creation, or training start happens unless explicitly requested.

### Recommended Submit Package Shape

The public version recommends the simplest stable Taiji trainFiles shape:

```text
code.zip
run.sh
config.yaml
```

- `code.zip` contains project code, built by your repository scripts or by an agent.
- `run.sh` is the platform entrypoint. It locates or extracts code and starts training with `config.yaml`.
- `config.yaml` contains experiment parameters for the run.

This repository includes a minimal example with no real training code:

```text
examples/minimal-taiji-submit/
  code/
  run.sh
  config.yaml
```

Your agent can follow this shape: package project code into `code.zip`, write experiment parameters to `config.yaml`, and use `run.sh` as the stable entrypoint. The automated submit script replaces `code.zip` and `config.yaml` by default. If you pass `--run-sh ./run.sh`, it also explicitly overwrites the template's matching `run.sh`. The template Job must already contain these trainFiles by name; adding new trainFiles requires `--allow-add-file`.

For templates that use loose files such as `main.py + dataset.py + run.sh` instead of a pure zip shape, use generic file adaptation:

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --file-dir "./taiji-files" \
  --name "loose_files_exp"
```

`--file-dir` scans only direct files in the directory. It auto-detects `code.zip`, `config.yaml`, and `run.sh`; every other direct file becomes a generic trainFile. For example:

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

This prepares a `run.sh` overwrite plus generic replacements for `dataset.py/model.py/ns_groups.json/train.py/trainer.py/utils.py`. Subdirectories are ignored so an agent does not accidentally upload an entire project tree.

You can also list files one by one:

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

`--file ./main.py` replaces the template's `main.py` by basename. `--file ./local_dataset.py=dataset.py` uploads a local file and replaces template `dataset.py`. The primary names `code.zip`, `config.yaml`, and `run.sh` are reserved for `--zip`, `--config`, and `--run-sh`, or for `--file-dir` auto-detection; they cannot be supplied through `--file`.

Prepare a submit bundle:

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

Omit `--run-sh` to keep the template Job's existing `run.sh`.

It writes:

```text
taiji-output/submit-bundle/
  manifest.json
  NEXT_STEPS.md
  files/code.zip
  files/config.yaml
  files/run.sh        # only when --run-sh is provided
  files/generic/...   # only when --file is provided or --file-dir finds loose files
```

Generate a dry-run submit plan:

```bash
taac2026 submit \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID>
```

Upload and create a Job:

```bash
taac2026 submit \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> \
  --execute --yes
```

Upload, create, and start training:

```bash
taac2026 submit \
  --bundle taiji-output/submit-bundle \
  --cookie-file taiji-output/secrets/taiji-cookie.txt \
  --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> \
  --execute --yes --run
```

Only add `--run` when the user explicitly asks to start training. For upload validation, use the create-only command first.

If the template Job does not contain matching `code.zip`, `config.yaml`, matching `run.sh` when `--run-sh` is provided, or matching generic trainFiles when `--file` / `--file-dir` is provided, the script fails by default so old and new files do not coexist silently. Add this only when you intentionally want to add trainFiles:

```bash
taac2026 submit ... --execute --yes --allow-add-file
```

## Safety Defaults

- Put cookies, HAR files, and captured headers under `taiji-output/secrets/` or `taiji-output/har/`. Never commit them.
- All scripts write local artifacts under `taiji-output/` by default.
- Relative output paths cannot contain `..`; use an absolute path when writing outside `taiji-output/` is intentional.
- `eval scrape --out-dir` is an explicit directory option; the default is `taiji-output/evaluations/`, and custom folders should usually still live under `taiji-output/`.
- `submit-taiji.mjs` is dry-run by default.
- Platform mutations require explicit `--execute --yes`.
- Starting training additionally requires explicit `--run`.
- `ckpt-publish --force`, `submit --allow-add-file`, and `eval create --include-all-files` require extra confirmation.
- The script keeps the template Job's environment, image, and entrypoint; by default it strictly replaces existing `code.zip` and `config.yaml` trainFiles, strictly replaces matching `run.sh` only when `--run-sh` is provided, and strictly replaces generic trainFiles only when `--file` or `--file-dir` is provided.

## Output Layout

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

Recommended `.gitignore` entry:

```gitignore
taiji-output/
```

## When To Use It

Good fits:

- Ask an agent to summarize a batch of Taiji training runs.
- Compare two experiment `config.yaml` files.
- Archive code, logs, checkpoints, and metrics for each Job.
- Submit the next code/config pair using a known-good template Job.
- Let an agent organize historical evidence before humans and agents reason about next-step strategy together.

Poor fits:

- The Cookie is expired or bound to IP / browser fingerprint.
- Taiji APIs changed and you do not have a fresh DevTools request sample.
- You want fully unattended consumption of training resources with no explicit confirmation.

## Scripts

| Script | Purpose |
| --- | --- |
| `bin/taac2026.mjs` / `taac2026` | Unified CLI entrypoint that dispatches to the subcommands below |
| `scripts/scrape-taiji.mjs` | Scrape Jobs, instances, metrics, logs, checkpoints, and code files |
| `scripts/compare-config-yaml.mjs` | Semantically compare two YAML configs |
| `scripts/prepare-taiji-submit.mjs` | Prepare a local submit bundle and record Git state |
| `scripts/submit-taiji.mjs` | Dry-run or explicitly execute upload, Job creation, and Run |
| `scripts/experiment-tools.mjs` | Submit doctor, submit verify, Job comparison, ledger sync, log diagnosis, checkpoint selection, and checkpoint publishing |
| `scripts/evaluation-tools.mjs` | Model listing, evaluation create dry-run / live create, evaluation listing, evidence scraping, and stop |

## Troubleshooting

- `401` / `403`: Cookie is expired, missing, or bound to the original browser/network context.
- Playwright fails but `--direct` works: prefer `--direct`.
- Both modes return `401`: test a full `Copy as cURL` on the same machine first.
- Instances exist but metrics are empty: the task may have failed, produced no metrics, or the API shape may have changed.
- Code download fails: inspect `code/<jobId>/job-detail.json` and `train-files.json`. The scraper first treats `trainFiles[].path` as a COS key and downloads with the federation token; if it receives the Taiji frontend HTML, a bad zip magic header, a non-mapping `config.yaml`, or a size mismatch, it marks the download as failed instead of silently saving a fake file.

## Development Check

```bash
npm run check
npm run test
```

`check` runs `node --check` on all bundled scripts. `test` runs small behavior tests for submit safety and output paths.
