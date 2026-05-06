# TAAC Scraping Workflow Reference

## API Endpoints

- Job list: `GET https://taiji.algo.qq.com/taskmanagement/api/v1/webtasks/external/task?pageNum=<n>&pageSize=<n>`
- Job detail / train files: `GET https://taiji.algo.qq.com/taskmanagement/api/v1/webtasks/external/task/<jobInternalId>`
- Instance list: `POST https://taiji.algo.qq.com/taskmanagement/api/v1/instances/list`
- Checkpoints: `GET https://taiji.algo.qq.com/taskmanagement/api/v1/instances/external/<instanceId>/get_ckpt`
- Metrics: `GET https://taiji.algo.qq.com/taskmanagement/api/v1/instances/external/<instanceId>/tf_events`
- Logs: `GET https://taiji.algo.qq.com/taskmanagement/api/v1/instances/<instanceId>/pod_log`
- Model list: `GET https://taiji.algo.qq.com/aide/api/external/mould/?page=<n>&page_size=<n>&search=<text>`
- Evaluation template files: `GET https://taiji.algo.qq.com/aide/api/evaluation_tasks/get_template/`
- Evaluation create/list/stop: `POST/GET https://taiji.algo.qq.com/aide/api/evaluation_tasks/`
- Evaluation event log: `GET https://taiji.algo.qq.com/aide/api/evaluation_tasks/event_log/?task_id=<evalTaskId>`
- Federation token for COS file upload/download: `GET https://taiji.algo.qq.com/aide/api/evaluation_tasks/get_federation_token/`

The instance list endpoint requires a JSON body:

```json
{
  "desc": true,
  "orderBy": "create",
  "task_id": "<Job ID>",
  "page": 0,
  "size": 100
}
```

## Cookie Capture

If Playwright login triggers rate limiting or frequent verification, use the user's already logged-in browser session:

1. Open `https://taiji.algo.qq.com/training` in the normal browser.
2. Open DevTools -> Network.
3. Refresh the page.
4. Select the `task?pageNum=0&pageSize=...` request.
5. Copy either the `cookie` request header value or the whole request via `Copy as cURL`.
6. Save it to `taiji-output/secrets/taiji-cookie.txt`.

Treat cookies as secrets. Add `taiji-output/` to `.gitignore`.

## Output Shape

The bundled scraper exports:

- `jobs.json`: full data keyed by `jobsById[jobId].instancesById[instanceId]`.
- `jobs-summary.csv`: one row per Job ID with latest name and description.
- `all-checkpoints.csv`: one row per checkpoint, including `jobId` and `instanceId`.
- `all-metrics-long.csv`: long-form metrics with `jobId`, `instanceId`, `metric`, `chart`, `series`, `step`, `value`.
- `logs/<jobId>/<instanceId>.json` and `.txt`: pod logs for each instance.
- `code/<jobId>/job-detail.json`: Job detail response containing `trainFiles`.
- `code/<jobId>/train-files.json`: training code metadata and best-effort download status.
- `code/<jobId>/files/...`: downloaded training code files when `trainFiles[].path` is directly fetchable. Preserve path structure when possible.
- `browser-profile/`: Playwright persistent profile.
- `config-diffs/`: output for config diff files when `--out` is a relative path.
- `ledger/experiments.json`: structured experiment ledger from `ledger sync`.
- `submit-bundle/` and `submit-live/`: local submit preparation and live submit/run records.
- `evaluations/eval-summary.csv`: one row per evaluation task with status, score/AUC, file counts, and log counts.
- `evaluations/eval-tasks.json`: normalized evaluation task evidence.
- `evaluations/logs/<evalTaskId>.json` and `.txt`: evaluation event logs.
- `evaluations/code/<evalTaskId>/files/...`: downloaded inference files referenced by evaluation tasks.
- `reports/`: JSON or Markdown reports from compare, diagnose, model, eval, and related helper commands.
- `secrets/`: recommended local location for cookies or captured headers.

Use `jobId + instanceId + metric + series + step` as the stable row identity for metric analysis.

## Config Diff

Use `taac2026 diff-config` or `scripts/compare-config-yaml.mjs` for comparing two downloaded configs:

```bash
taac2026 diff-config old-config.yaml new-config.yaml
taac2026 diff-config old-config.yaml new-config.yaml --json --out diff.json
```

The tool parses YAML and reports semantic changes by path. It handles nested maps and arrays, including paths like `optimizer.lr`, `features[2]`, and `model.layers[1].dropout`. Relative `--out` values are written under `taiji-output/`; a bare filename such as `diff.json` becomes `taiji-output/config-diffs/diff.json`.

## Known Failure Modes

- `401` or `403`: Cookie expired or missing. Ask for a fresh cookie header or cURL copy.
- `Failed to fetch`: Login redirect or browser auth state not ready. Retry with `--cookie-file` and `--headless`.
- `Failed to fetch` in Playwright but Node direct probe is `200`: use scraper `--direct` mode.
- `401` in both Playwright and Node direct probe: the cookie is not valid for that machine/request context. Test a complete `Copy as cURL` on the target machine; if it also returns `401`, obtain a fresh login/cookie from that network or browser context.
- Empty instances with successful jobs: POST body was likely sent as query params. Use JSON body.
- Metrics count is nonzero but CSV rows are zero: metrics payload may be an array of chart objects; flatten every chart.
- Missing code files: first check `code/<jobId>/job-detail.json` and `train-files.json`. If `trainFiles` exists but download failed, the path may require COS SDK/temporary credentials rather than a plain HTTP GET.
- Some failed or interrupted instances legitimately have zero metrics.
- Evaluation task IDs are listed by `/evaluation`; `eval scrape --task-id` may page through the list to find older IDs, but it only downloads logs/code for matched tasks.

## Implementation Notes

- Job list endpoint is GET.
- Instance list endpoint is POST with JSON body, not query params.
- Metrics endpoint may return each metric as an array of chart objects; flatten all charts.
- Job list rows do not include training code files. Fetch Job detail and read all of `data.trainFiles`, not only `config.yaml`.
- Training and inference code files usually store COS keys in `trainFiles[].path` or `files[].path`; use the federation token and COS `getObject` before falling back to direct URL fetch.
- Validate downloaded trainFiles before saving: reject Taiji frontend HTML, size mismatches, bad zip magic for `.zip`, non-mapping `config.yaml`, and invalid JSON. Always save metadata even when some file content downloads fail.
- `--direct` bypasses Chromium and uses Node `fetch` with the Cookie header. It helps on headless servers, but it cannot fix an expired, IP-bound, or fingerprint-bound login token.
- Output CSV can be large. Prefer streaming, `rg`, `head`, `jq`, or long-form CSV projections for downstream analysis instead of loading or pasting whole files.
