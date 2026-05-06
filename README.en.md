# TAAC2026 CLI

[中文](README.md)

Turn the Taiji / TAAC training platform into an experiment CLI that humans and agents can read, compare, archive, submit, and run.

TAAC2026 CLI targets `https://taiji.algo.qq.com/training`. It can scrape training jobs, metrics, logs, checkpoints, and training code; compare two `config.yaml` files semantically; and prepare or explicitly execute the captured Taiji submit workflow. All local artifacts default to `taiji-output/`, keeping your repository root clean.

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
| Tool artifacts clutter the repository root | All local artifacts default to `taiji-output/`, including browser profile, scrape output, bundles, live results, and config diffs. |

## What Agents Can Do With It

- Scrape recent training jobs and turn platform metrics into analyzable tables.
- Answer "where is this run better or worse than the previous version?"
- Use Job descriptions, config diffs, logs, and curves to investigate failures or metric anomalies.
- Check whether the zip/config/run.sh/name/description match the intended manifest before submit.
- Reuse a known-good template Job, replace `code.zip` and `config.yaml`, optionally overwrite `run.sh`, and optionally start training.
- Preserve transient web-console information as durable experiment assets.

## Core Capabilities

| Capability | Output |
| --- | --- |
| Bulk scrape Jobs | `jobs.json`, `jobs-summary.csv` |
| Scrape Metrics / tf_events | `all-metrics-long.csv` |
| Scrape Checkpoints | `all-checkpoints.csv` |
| Scrape Pod logs | `logs/<jobId>/<instanceId>.txt` |
| Download training code | `code/<jobId>/files/...` |
| Save Job detail | `code/<jobId>/job-detail.json`, `train-files.json` |
| Compare configs | `taiji-output/config-diffs/*.json` or Markdown |
| Prepare submit bundle | `taiji-output/submit-bundle/` |
| Dry-run / live submit | `taiji-output/submit-live/<timestamp>/` |
| Submit safety / read-back verification | `submit doctor`, `submit verify` |
| Experiment evidence tools | `compare jobs`, `compare-runs`, `config diff-ref`, `ledger sync`, `logs`, `diagnose job`, `ckpt-select`, `ckpt-publish` |

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
taac2026 ckpt-publish --job 56242 --ckpt "global_step7236.epoch=4.AUC=0.865213.Logloss=0.273911.best_model" --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --json
```

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
- `submit-taiji.mjs` is dry-run by default.
- Platform mutations require explicit `--execute --yes`.
- Starting training additionally requires explicit `--run`.
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
  logs/<jobId>/
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
