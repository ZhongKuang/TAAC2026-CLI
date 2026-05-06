---
name: taac2026-cli
description: Use TAAC2026 CLI to scrape Tencent TAAC / Taiji training and evaluation pages for Job IDs, Job Names, descriptions, metrics, checkpoints, logs, code files, published models, evaluation tasks, online scores, and inference code; compare config.yaml files; prepare and verify submissions; publish checkpoints as models; create, scrape, or stop evaluations; and optionally upload/start Taiji jobs through captured API flows. Use when a human or agent asks to crawl taiji.algo.qq.com/training, /model, or /evaluation; inspect TAAC metrics/logs/code/checkpoints/configs; compare experiment runs; diagnose failures; publish a model; submit training; or collect online evaluation evidence.
---

# TAAC2026 CLI Agent Runbook

## Setup

Run commands from the user's workspace root so outputs land under `taiji-output/`. If `taac2026` is linked, use it; otherwise run `node <TOOL_DIR>/bin/taac2026.mjs`.

Install dependencies only when needed:

```bash
npm install
npx playwright install chromium
```

Store cookies or copied request headers under `taiji-output/secrets/`. Never print or commit cookies.

## Decision Matrix

| User intent | Prefer this command |
| --- | --- |
| Inspect one or a few training Jobs | `taac2026 scrape --all --job-internal-id <id> --cookie-file taiji-output/secrets/taiji-cookie.txt --direct` |
| Refresh an existing training cache | `taac2026 scrape --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct` |
| Archive all training history | `taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct` only when explicitly requested |
| Compare two training Jobs | `taac2026 compare-runs --base <id> --exp <id> --config --metrics --json --out compare-runs.json` |
| Compare config files | `taac2026 diff-config old.yaml new.yaml --json --out diff.json` |
| Diagnose a failed Job | `taac2026 logs --job <id> --errors --tail 100 --json --out logs-<id>.json` or `taac2026 diagnose job --job-internal-id <id> --json --out diagnose-<id>.json` |
| Check submit package before upload | `taac2026 submit doctor --bundle taiji-output/submit-bundle` |
| Verify platform received the intended files | scrape the submitted Job, then `taac2026 submit verify --bundle taiji-output/submit-bundle --job-internal-id <id>` |
| Select a checkpoint by rule | `taac2026 ckpt-select --job <id> --by valid_auc --json --out ckpt-select.json` |
| Publish a checkpoint as model | first dry-run `taac2026 ckpt-publish --job <id> --ckpt "<name>" --json --out ckpt-publish.json` |
| Find a model | `taac2026 model list --cookie-file taiji-output/secrets/taiji-cookie.txt --search "<name>" --out model-list.json` |
| Create an evaluation | first dry-run `taac2026 eval create --model-name "<name>" --submit-name <local-submit> --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-create.json` |
| Analyze evaluation-page results | first `taac2026 eval list --cookie-file taiji-output/secrets/taiji-cookie.txt --page-size 20 --out eval-list.json`, then `taac2026 eval scrape --task-id <id> --logs --code --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-scrape.json` |
| Stop an evaluation | first dry-run `taac2026 eval stop --task-id <id> --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-stop.json` |

`evaluation` is an alias for `eval`; use `eval` in docs and replies.

## Cost Policy

Default order is targeted > incremental > full.

- Do not start with historical full scrape unless the user asks for full archive/history.
- Fresh workspaces can still use targeted `--job-internal-id`, `--url`, or `eval scrape --task-id`; a full seed is not mandatory.
- `eval scrape --task-id` limits logs/code downloads to matching tasks, but old IDs may still require paging through evaluation list. If the ID is unknown, run `eval list --page-size 20 --out ...` first.
- `eval scrape --all --logs --code` is high cost. Use only for explicit evaluation-history archive.
- If Chromium is unreliable on a server, prefer `--direct` with a valid cookie.

## Output Discipline

- For machine-readable reports, prefer `--json --out <name>.json` or plain `--out <name>.json`; avoid printing large JSON to stdout.
- Relative `--out` report names are written under `taiji-output/reports/` or the command-specific output folder. `eval scrape --out-dir` is different: it is an explicit directory path; use `--out-dir taiji-output/evaluations-<name>` when you want a custom folder under `taiji-output/`.
- Reply with summaries: `syncStats`, Job IDs, Eval task IDs, key metrics, error snippets, and file paths.
- Do not paste whole `jobs.json`, `eval-tasks.json`, full logs, or downloaded code into chat. Use `rg`, `head`, `jq`, CSV projections, or `logs --errors --tail 100`.

## Mutation Safety Gate

Platform writes include:

- `submit --execute`
- `submit --execute --run`
- `ckpt-publish --execute`
- `eval create --execute`
- `eval stop --execute`

Always dry-run first and show the user a concise plan: target Job/model/eval ID, files, name/description, and whether it will run or stop anything. Live execution requires explicit confirmation in the current conversation.

Extra-risk flags require explicit mention: `--run`, `--force`, `--allow-add-file`, `--include-all-files`. Do not run live just because a manifest records run intent.

## Core Commands

Training scrape:

```bash
taac2026 scrape --all --job-internal-id <JOB_INTERNAL_ID> --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
taac2026 scrape --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

Evidence tools:

```bash
taac2026 submit doctor --bundle taiji-output/submit-bundle
taac2026 submit verify --bundle taiji-output/submit-bundle --job-internal-id <JOB_INTERNAL_ID>
taac2026 compare jobs <JOB_INTERNAL_ID...> --json --out compare-jobs.json
taac2026 compare-runs --base <BASE_JOB_INTERNAL_ID> --exp <EXP_JOB_INTERNAL_ID> --config --metrics --json --out compare-runs.json
taac2026 config diff-ref --config config.yaml --job-internal-id <JOB_INTERNAL_ID> --json --out config-diff-ref.json
taac2026 ledger sync
taac2026 logs --job <JOB_INTERNAL_ID> --errors --tail 100 --json --out logs.json
taac2026 diagnose job --job-internal-id <JOB_INTERNAL_ID> --json --out diagnose.json
```

Checkpoint/model/evaluation:

```bash
taac2026 ckpt-select --job <JOB_INTERNAL_ID> --by valid_auc --json --out ckpt-select.json
taac2026 ckpt-publish --job <JOB_INTERNAL_ID> --ckpt "<CKPT_NAME>" --json --out ckpt-publish.json
taac2026 model list --cookie-file taiji-output/secrets/taiji-cookie.txt --search "<MODEL_NAME>" --out model-list.json
taac2026 eval create --model-name "<MODEL_NAME>" --submit-name <LOCAL_SUBMIT_NAME> --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-create.json
taac2026 eval scrape --task-id <EVAL_TASK_ID> --logs --code --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-scrape.json
taac2026 eval stop --task-id <EVAL_TASK_ID> --cookie-file taiji-output/secrets/taiji-cookie.txt --out eval-stop.json
```

Live examples only after confirmation:

```bash
taac2026 submit --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_ID> --execute --yes
taac2026 ckpt-publish --job <JOB_INTERNAL_ID> --ckpt "<CKPT_NAME>" --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --json --out ckpt-publish-live.json
taac2026 eval create --model-name "<MODEL_NAME>" --submit-name <LOCAL_SUBMIT_NAME> --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --out eval-create-live.json
```

## Notes

- `ckpt-publish` can use `--ckpt "<name>"` or `--by valid_auc`; pass `--instance-id <id>` if the selection is ambiguous across instances.
- `eval create --submit-name` resolves `submits/<date>/<name>/inference_code`; exact matches win, fuzzy matches must be unique.
- `--file-dir <dir>` for eval create is a manual fallback. It uploads only direct `dataset.py`, `dense_transform.py`, `eda.py`, `infer.py`, and `model.py` unless `--include-all-files` is explicitly confirmed.
- `eval scrape` writes `taiji-output/evaluations/eval-summary.csv`, `eval-tasks.json`, `logs/<evalTaskId>.txt`, and `code/<evalTaskId>/files/...`.

## References

- For endpoint behavior, auth failures, download validation, and output schema, read `references/workflow.md`.
- For live submit mechanics, read `references/submit-workflow.md`.
- For minimal `code.zip + run.sh + config.yaml` package shape, read `examples/minimal-taiji-submit/README.md`.
