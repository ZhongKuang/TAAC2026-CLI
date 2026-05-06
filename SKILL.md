---
name: taac2026-cli
description: Use TAAC2026 CLI to scrape Tencent TAAC / Taiji training pages for Job IDs, Job Names, Job Descriptions, code files, instances, checkpoints, logs, and metrics; compare YAML configs such as config.yaml across versions; prepare TAAC experiment submissions; and optionally upload/start Taiji jobs through the captured API flow. Use when a human or agent asks to crawl taiji.algo.qq.com/training, TAAC training jobs, Tencent Angel Machine Learning Platform outputs, ckpt pages, pod logs, config.yaml or arbitrary job code files, compare two config.yaml files, tf_events metrics, or wants a reusable CLI workflow for TAAC metrics, logs, code files, config diffs, or code/config submission to Taiji.
---

# TAAC2026 CLI Agent Runbook

## Workflow

1. Confirm the target is `https://taiji.algo.qq.com/training` or a `/training/ckpt/.../<instanceId>` page.
2. Run the CLI from the user's workspace root so `taiji-output/` is written there. If `npm link` was run, use `taac2026`; otherwise replace `<TOOL_DIR>` with this tool directory and use `node <TOOL_DIR>/bin/taac2026.mjs`.
3. If creating a standalone workspace instead, clone `https://github.com/ZhongKuang/TAAC2026-CLI.git` or copy the relevant scripts and create a minimal `package.json` using `references/package-json.md`.
4. Install dependencies with `npm install` and, if needed, `npx playwright install chromium`.
5. Add `taiji-output/` to `.gitignore`. Scripts default all local outputs, browser profile, submit bundles, and live submit records under this directory.
6. Capture a browser Cookie from the user if Playwright login triggers verification or rate limiting.
7. Run the scraper and verify output row counts.

## Commands

Recommended scrape strategy:

1. Fresh workspace or missing `taiji-output/jobs.json`: run one full `scrape --all` to seed the local cache.
2. Existing cache and no narrow target: prefer `scrape --all --incremental`; it still refreshes the Job list, but skips deep fetching unchanged cached terminal Jobs.
3. User gives explicit Job IDs, experiment names, or a small set such as "1.4.8, 1.4.9, +1/+2/+3": prefer targeted scrape first with `--job-internal-id <id>` for each known Job. If the IDs are unknown, use `jobs-summary.csv` or `taac2026 compare jobs` / shell filtering to identify candidates before scraping the historical task sea.
4. During targeted scrape, the platform may not print continuous progress while fetching instances, logs, metrics, checkpoints, or code files. Wait for the command to finish instead of starting a full historical scrape in parallel.
5. After targeted scrape, summarize only the requested Jobs unless the user explicitly asks for a broader historical comparison.

For all training jobs:

```bash
taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

Incremental sync still scans the full Job list, but skips deep fetching for cached terminal Jobs whose `updateTime`, `status`, and `jzStatus` are unchanged:

```bash
taac2026 scrape --all --incremental --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

For targeted debugging of one platform Job:

```bash
taac2026 scrape --all --job-internal-id 56242 --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

For servers where Chromium page fetch fails, use backend direct HTTP mode:

```bash
taac2026 scrape --all --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
```

For a single ckpt page:

```bash
taac2026 scrape --url "<TAAC_CKPT_URL>" --cookie-file taiji-output/secrets/taiji-cookie.txt --headless
```

Compare two YAML config files:

```bash
taac2026 diff-config old-config.yaml new-config.yaml
taac2026 diff-config old-config.yaml new-config.yaml --json --out diff.json
```

Daily experiment evidence tools:

```bash
taac2026 submit doctor --bundle taiji-output/submit-bundle
taac2026 submit verify --bundle taiji-output/submit-bundle --job-internal-id <JOB_INTERNAL_ID>
taac2026 compare jobs <JOB_INTERNAL_ID...> --json
taac2026 compare-runs --base <BASE_JOB_INTERNAL_ID> --exp <EXP_JOB_INTERNAL_ID> --config --metrics --json
taac2026 config diff-ref --config config.yaml --job-internal-id <JOB_INTERNAL_ID> --json
taac2026 ledger sync
taac2026 logs --job <JOB_INTERNAL_ID> --errors --tail 100 --json
taac2026 diagnose job --job-internal-id <JOB_INTERNAL_ID> --json
taac2026 ckpt-select --job <JOB_INTERNAL_ID> --by valid_auc --json
taac2026 ckpt-publish --job <JOB_INTERNAL_ID> --ckpt "<CKPT_NAME>" --json
```

Use these commands to collect evidence and catch mistakes; do not present them as automatic experiment decision makers.

Prepare a local-agent experiment submission package:

```bash
taac2026 prepare-submit --template-job-url "<TEMPLATE_JOB_URL>" --zip "./artifacts/exp.zip" --config "./configs/exp.yaml" --name "exp_017" --description "try focal loss"
```

Submit file priority:

1. Prefer primary files: `--zip <code.zip>`, `--config <config.yaml>`, and optional `--run-sh <run.sh>`.
2. Use `--file-dir <dir>` for a directory of direct trainFiles. It auto-detects `code.zip`, `config.yaml`, and `run.sh`; every other direct file becomes generic. Subdirectories are ignored.
3. Use repeatable `--file <path[=name]>` only for single-file generic replacements or local-to-template name mapping.

The names `code.zip`, `config.yaml`, and `run.sh` are reserved primary names and cannot be supplied through `--file`.
`prepare --run` only records run intent in the manifest; it does not start training by itself.

Dry-run live submit plan:

```bash
taac2026 submit --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID>
```

Live upload/create only. Do not add `--run` unless the user explicitly asks to start training:

```bash
taac2026 submit --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> --execute --yes
```

Live upload/create/run, only after explicit user confirmation:

```bash
taac2026 submit --bundle taiji-output/submit-bundle --cookie-file taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> --execute --yes --run
```

If the template Job does not already contain `code.zip`, `config.yaml`, requested `run.sh`, or requested generic `--file` / `--file-dir` names, `submit-taiji.mjs` fails by default. Use `--allow-add-file` only when intentionally adding new `trainFiles`.

Use longer auth waiting only when interactive login is required:

```bash
taac2026 scrape --all --auth-timeout 600000
```

## Cookie Handling

Treat cookies as secrets. Do not print them back, commit them, or include them in final answers.

If the user sees "operation too frequent" or a verification loop, do not keep retrying interactive login. Ask them to copy the Cookie header or `Copy as cURL` from the successful normal browser request. Follow `references/workflow.md` for the exact DevTools flow.

If both Playwright mode and `--direct` return `401`, treat the cookie as invalid for that machine or request context. Ask for a fresh complete `Copy as cURL` from the browser that can access the page, then test that cURL on the target machine before changing scraper logic.

## Output Contract

The scraper writes to `taiji-output/` by default:

- `jobs.json`: complete raw and normalized data, keyed by `jobsById[jobId].instancesById[instanceId]`, with log file metadata.
- `jobs-summary.csv`: one row per Job ID; reruns update Job Name and Job Description.
- `all-checkpoints.csv`: checkpoint rows with `jobId` and `instanceId`.
- `all-metrics-long.csv`: long-form metric rows with `jobId`, `instanceId`, `metric`, `chart`, `series`, `step`, `value`.
- `logs/<jobId>/<instanceId>.json` and `.txt`: pod logs for every instance.
- `code/<jobId>/job-detail.json`: full Job detail response, including `trainFiles` when available.
- `code/<jobId>/train-files.json`: train file metadata plus download status.
- `code/<jobId>/files/...`: best-effort downloaded training code files, preserving path structure when possible.
- `browser-profile/`: Playwright persistent browser state for interactive auth fallback.
- `config-diffs/`: config diff files when `compare-config-yaml.mjs --out <file>` is used with a relative path.
- `ledger/experiments.json`: structured experiment ledger from `ledger sync`.
- `submit-bundle/`: default prepared local submission bundle.
- `submit-live/<timestamp>/`: dry-run plans and live submit/run results.
- `secrets/`: recommended local location for `taiji-cookie.txt` or captured headers. Never commit this directory.

## Config Diff Tool

Use `scripts/compare-config-yaml.mjs` to compare two YAML files semantically instead of line-by-line. It parses YAML, flattens nested maps/lists into stable paths, and reports `added`, `removed`, and `changed` entries.

When `--out` is a relative path, the diff is written under `taiji-output/`; a bare filename such as `diff.json` becomes `taiji-output/config-diffs/diff.json`.

Use path identity like `model.lr`, `train.batch_size`, and `layers[1]` when explaining changes. Prefer `--json` when downstream scripts need machine-readable output.

Use `jobId + instanceId` to distinguish multiple runs under one Job ID. Use `jobId + instanceId + metric + series + step` for metric row identity.

## Submit Training Workflow

Use `scripts/prepare-taiji-submit.mjs` when a local agent needs to package the intended Taiji submission. It validates prepared trainFiles, records the Git commit/status when available, writes a manifest, and captures whether the agent should run after submission.

Use `scripts/submit-taiji.mjs` for the captured Taiji API path. It is dry-run by default. Live execution requires `--execute --yes`, and starting training additionally requires `--run`.

For a minimal `code.zip + run.sh + config.yaml` package shape, load `examples/minimal-taiji-submit/README.md`. The submit script replaces `code.zip` and `config.yaml` by default; pass `--run-sh` to prepare an explicit `run.sh` overwrite. For legacy templates with loose files such as `main.py` and `dataset.py`, prefer `--file-dir` for a whole directory, or pass repeatable `--file` entries so the manifest records those replacements explicitly.

The intended live workflow is:

1. Commit or record the local code state.
2. Reuse a known-good template Job instead of creating a blank Job.
3. Copy the template Job.
4. Replace the code zip and config file; replace `run.sh` only when `--run-sh` or `--file-dir` prepared it; replace generic files only when `--file-dir` or `--file` prepared them. The template must already contain matching trainFiles unless `--allow-add-file` is used.
5. Fill Job Name and Job Description.
6. Submit the new Job.
7. Optionally click Run and return the new Job ID, Job URL, and instance result.

Live submit uses the captured "Copy Job -> upload trainFiles to COS -> submit -> run" flow. Load `references/submit-workflow.md` before debugging live submission.

## Experiment Evidence Workflow

Use `submit doctor` before live submit to check bundle file hashes, zip/config/run.sh validity, dirty Git state, and obvious name/description/config mismatches.

Use `submit verify` after scraping the submitted Job to compare platform-side trainFiles and log `Resolved config` against the local bundle. If hashes mismatch, treat the Job as suspect until the upload path is explained.

Use `compare jobs` to gather metric evidence across explicit Jobs. Use `compare-runs` for a base-vs-exp view with config diff, metric deltas, direction checks, and explicit-rule checkpoint candidates. These reports keep `decision: not_provided`.

Use `config diff-ref` only against an explicit reference Job. Do not infer "highest score" or "best config" unless the user supplies that policy.

Use `ledger sync` to persist structured experiment history under `taiji-output/ledger/experiments.json`, `logs --errors` for quick error/tail extraction, and `diagnose job` to collect errors, log tails, and resolved configs for debugging.

Use `ckpt-select` only with an explicit rule such as `--by valid_auc`, `--by valid_test_like_auc`, `--by logloss`, or `--by pareto`. Present the result as a candidate selected by that rule, not as a final recommendation.

## Checkpoint Publish Workflow

Use `ckpt-publish` to publish one scraped training checkpoint as a Taiji model. It reads `jobs-summary.csv` and `all-checkpoints.csv`, so run a targeted scrape first when the checkpoint is new:

```bash
taac2026 scrape --all --job-internal-id <JOB_INTERNAL_ID> --cookie-file taiji-output/secrets/taiji-cookie.txt --direct
taac2026 ckpt-publish --job <JOB_INTERNAL_ID> --ckpt "<CKPT_NAME>" --json
```

Dry-run is the default. It builds the release plan but does not call Taiji. The default model name is `<Job Name> epoch<N> val auc <AUC>`, parsed from the checkpoint filename. The default model description is the Job description from `jobs-summary.csv`.

Live publishing requires explicit confirmation:

```bash
taac2026 ckpt-publish --job <JOB_INTERNAL_ID> --ckpt "<CKPT_NAME>" --cookie-file taiji-output/secrets/taiji-cookie.txt --execute --yes --json
```

The captured endpoint is `POST /taskmanagement/api/v1/instances/external/<instanceId>/release_ckpt` with JSON body `{ name, desc, ckpt }`. After publishing, the command reads `get_ckpt` and verifies that the target checkpoint has `status: true`. Do not assume it is the only published checkpoint; observed responses can contain multiple `status: true` checkpoints. If cached `all-checkpoints.csv` already marks the target as published, live publishing is blocked unless `--force` is passed, to avoid accidental duplicate models.

## Model And Evaluation Gaps

Current captured model/evaluation endpoints:

- Model list: `GET /aide/api/external/mould/?page=1&page_size=20&search=`.
- Evaluation template files: `GET /aide/api/evaluation_tasks/get_template/`.
- Evaluation create: `POST /aide/api/evaluation_tasks/` with `{ mould_id, name, image_name, creator, files }`; observed create moves from `pending` to `infer_wait_resource`.
- Evaluation list/status/score: `GET /aide/api/evaluation_tasks/?page=1&page_size=20`.
- Evaluation stop: `POST /aide/api/evaluation_tasks/stop_task/` with `{ task_id }`.

Still needed before implementing full publish-to-evaluate automation:

- HAR for `/model` page load if model search/filter/detail/delete/rename behavior matters beyond the model list endpoint.
- HAR for creating an evaluation with locally uploaded inference files, including any COS upload path and whether it reuses `/aide/api/evaluation_tasks/get_federation_token/`.
- HAR for selecting a newly published model in evaluation when the model list is searched or paginated.
- HAR for evaluation detail/log/download-result pages if the list response is not enough for debugging failed evaluations.

## Implementation Notes

- Job list endpoint is GET.
- Instance list endpoint is POST with JSON body, not query params.
- Metrics endpoint may return each metric as an array of chart objects; flatten all charts.
- Job list rows do not include training code files. Fetch Job detail via `/taskmanagement/api/v1/webtasks/external/task/{jobInternalId}` and read all of `data.trainFiles`, not only `config.yaml`.
- Training code files usually store COS keys in `trainFiles[].path`. Use `/aide/api/evaluation_tasks/get_federation_token/` and COS `getObject` before falling back to direct URL fetch.
- Validate downloaded trainFiles before saving: reject Taiji frontend HTML, size mismatches, bad zip magic for `.zip`, non-mapping `config.yaml`, and invalid JSON. Always save `job-detail.json` and `train-files.json` even when some file content downloads fail.
- Some failed or interrupted instances legitimately have zero metrics.
- `--direct` bypasses Chromium and uses Node `fetch` with the Cookie header. It helps on headless servers, but it cannot fix an expired, IP-bound, or fingerprint-bound login token.
- The output CSV can be large. Prefer streaming or long-form CSV for downstream analysis instead of loading the whole file into memory for ad hoc transformations.

Load `references/workflow.md` when debugging endpoint behavior, auth, empty instances, or metric flattening.
