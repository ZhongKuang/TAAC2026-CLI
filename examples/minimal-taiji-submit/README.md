# Minimal Taiji Submit Package

This directory is a shape example only. It intentionally contains no real model
or competition code.

Recommended Taiji trainFiles shape:

```text
code.zip
run.sh
config.yaml
```

- `code.zip`: your project code, built by your repository or by an agent.
- `run.sh`: the platform entrypoint. Keep it stable in a template Job when possible.
- `config.yaml`: experiment parameters for this run.

For the current submit script, the common workflow is:

1. Create or copy a Taiji template Job whose `run.sh` already follows this style.
2. Build a fresh `code.zip` from your project.
3. Prepare a fresh `config.yaml`.
4. Let `submit-taiji.mjs` replace `code.zip` and `config.yaml` on the copied Job.
5. Add `--run-sh ./run.sh` only when this run intentionally changes the entrypoint.
6. Add `--file-dir ./taiji-files` or repeatable `--file ./main.py` only for generic loose trainFiles exposed by the template.

If your project needs a different `run.sh`, update the template Job first or
pass `--run-sh` so the prepared bundle records the replacement. Do not silently
rely on an old template entrypoint.

Example packaging command:

```bash
mkdir -p outputs/taiji-output/example-submit
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

source = Path("examples/minimal-taiji-submit/code")
target = Path("outputs/taiji-output/example-submit/code.zip")
target.parent.mkdir(parents=True, exist_ok=True)

with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(source))
PY
cp examples/minimal-taiji-submit/config.yaml outputs/taiji-output/example-submit/config.yaml
```

Then prepare a submit bundle:

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip outputs/taiji-output/example-submit/code.zip \
  --config outputs/taiji-output/example-submit/config.yaml \
  --name "minimal_example"
```

Optional entrypoint override:

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip outputs/taiji-output/example-submit/code.zip \
  --config outputs/taiji-output/example-submit/config.yaml \
  --run-sh examples/minimal-taiji-submit/run.sh \
  --name "minimal_example_with_runsh"
```

Omit `--run-sh` when the template Job's existing `run.sh` should stay in place.
Omit `--file` / `--file-dir` when all project code is packaged inside `code.zip`,
which is the recommended default shape.

For a loose-file template, put the direct trainFiles in one directory and use:

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --file-dir ./taiji-files \
  --name "loose_file_example"
```

`--file-dir` auto-detects `code.zip`, `config.yaml`, and `run.sh`; other direct
files become generic trainFiles. Subdirectories are ignored.

For one-off generic file mapping:

```bash
taac2026 prepare-submit \
  --template-job-url "https://taiji.algo.qq.com/training/..." \
  --zip outputs/taiji-output/example-submit/code.zip \
  --config outputs/taiji-output/example-submit/config.yaml \
  --file ./main.py \
  --file ./local_dataset.py=dataset.py \
  --name "mapped_file_example"
```
