# Taiji Submit Workflow

This note captures the TAAC2026 CLI submission workflow for agents and humans.

## Goal

Let an agent take a code change from the workspace, prepare the Taiji
training assets, submit them to the platform, start training, and return the
new Job ID / instance ID, similar to a code commit workflow.

Target command shape:

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip "./artifacts/exp_017.zip" \
  --config "./configs/exp_017.yaml" \
  --run-sh "./run.sh" \
  --file-dir "./taiji-files" \
  --file "./main.py" \
  --file "./local_dataset.py=dataset.py" \
  --name "exp_017_focal" \
  --description "try focal loss" \
  --run
```

Higher-level wrappers can combine this with Git:

```bash
git add .
git commit -m "try focal loss"
taac2026 prepare-submit --template-job-url "<url>" --file-dir "./taiji-files" --name "exp_017" --description "try focal loss" --run
taac2026 submit --bundle outputs/taiji-output/submit/bundle --cookie-file outputs/taiji-output/secrets/taiji-cookie.txt --template-job-internal-id <TEMPLATE_JOB_INTERNAL_ID> --execute --yes
```

Add `--run` to the submit command only when the user explicitly asks to start training.

## Preferred Platform Flow

Use "Copy existing Job" instead of "Create blank Job".

Reasoning:

- The template already has working environment, image, entrypoint, and platform
  fields.
- `run.sh` may be hard to delete or recreate safely, so keep it unchanged by
  default. When a replacement is explicitly requested, replace the matching
  template `run.sh` instead of adding a second entrypoint.
- Most experiments only need a new code zip, a new config file, Job Name, and
  Job Description.
- Generic loose files are second priority. Prefer `--file-dir <dir>` when a
  template intentionally exposes files such as `main.py` or `dataset.py` as
  individual trainFiles; use repeatable `--file <path[=name]>` for overrides or
  file-name mapping.

Live flow:

1. Open a known-good template Job.
2. Click Copy.
3. Replace uploaded code zip and config file.
4. Replace `run.sh` only when the prepared bundle contains `files.runSh`; otherwise keep it unchanged.
5. Replace generic loose files only when the prepared bundle contains `files.genericFiles`.
6. Fill Job Name.
7. Fill Job Description.
8. Submit the copied Job.
9. Click Run if requested.
10. Return Job URL, Job ID, and first instance ID.

## Known API Clues

Existing scraper work identified these useful endpoints:

- Job list: `GET /taskmanagement/api/v1/webtasks/external/task?pageNum=0&pageSize=10`
- Job detail: `GET /taskmanagement/api/v1/webtasks/external/task/{jobInternalId}`
- Instance list: `POST /taskmanagement/api/v1/instances/list`
- Likely create/update Job: `POST /taskmanagement/api/v1/webtasks/external/task`
- Likely start Job: `POST /taskmanagement/api/v1/webtasks/{taskID}/start`

Captured live flow:

1. `GET /aide/api/evaluation_tasks/get_federation_token/`
2. COS `PUT` code zip to `hunyuan-external-1258344706` / `ap-guangzhou`
3. `GET /aide/api/evaluation_tasks/get_federation_token/`
4. COS `PUT` `config.yaml`; COS `PUT` `run.sh` too when `--run-sh` / `--file-dir` prepared it; COS `PUT` generic files too when `--file` / `--file-dir` prepared them
5. `POST /taskmanagement/api/v1/webtasks/external/task` with updated `trainFiles`
6. Optional `POST /taskmanagement/api/v1/webtasks/{taskID}/start`
7. `POST /taskmanagement/api/v1/instances/list`

## Live Submit Safety

`scripts/submit-taiji.mjs` is dry-run by default. It only writes a plan under
`outputs/taiji-output/submit/live/<timestamp>/`. Live mutation requires explicit
`--execute --yes`; training start additionally requires `--run`.

By default, live submit only replaces uploaded files whose names already exist
in the template Job's `trainFiles`. Missing `code.zip`, `config.yaml`, or a
requested `run.sh` / generic file fails fast. Use `--allow-add-file` only when
intentionally adding new `trainFiles`. `--file-dir` scans direct files only and
ignores subdirectories.

Do not commit cookies, token captures, prepared bundles, or live results. Keep
them under `outputs/taiji-output/`.

## Safe Current Tool

`scripts/prepare-taiji-submit.mjs` intentionally does not upload or click. It:

- Validates the code zip, config file, optional `run.sh`, optional generic files, and optional `--file-dir`.
- Copies prepared trainFiles into a deterministic `outputs/taiji-output/submit/bundle/files/` directory by default.
- Records Job Name, Job Description, template URL, and `runAfterSubmit`.
- Records Git root, branch, HEAD, and dirty status when available.
- Writes `manifest.json` and `NEXT_STEPS.md`.

This gives an agent a consistent handoff point. `submit-taiji.mjs` consumes
that bundle when the user explicitly asks for live upload/run.
