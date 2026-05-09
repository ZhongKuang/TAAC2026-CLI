import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { resolveTaijiOutputFile } from "../compare-config-yaml.mjs";
import { resolveTaijiOutputDir as resolvePrepareOutputDir } from "../prepare-taiji-submit.mjs";
import { fetchTextDirect } from "../scrape-taiji.mjs";
import { replaceTrainFiles } from "../submit-taiji.mjs";

const execFileAsync = promisify(execFile);
const scriptsDir = fileURLToPath(new URL("..", import.meta.url));
const toolDir = fileURLToPath(new URL("../..", import.meta.url));

test("submit replaces only template trainFiles with matching names by default", () => {
  const next = replaceTrainFiles(
    [
      { name: "run.sh", path: "old/run.sh" },
      { name: "code.zip", path: "old/code.zip" },
      { name: "config.yaml", path: "old/config.yaml" },
    ],
    [
      { name: "code.zip", path: "new/code.zip" },
      { name: "config.yaml", path: "new/config.yaml" },
    ],
  );

  assert.deepEqual(next, [
    { name: "run.sh", path: "old/run.sh" },
    { name: "code.zip", path: "new/code.zip" },
    { name: "config.yaml", path: "new/config.yaml" },
  ]);
});

test("submit rejects uploaded trainFiles that do not exist in the template unless explicitly allowed", () => {
  assert.throws(
    () => replaceTrainFiles([{ name: "run.sh", path: "old/run.sh" }], [{ name: "code.zip", path: "new/code.zip" }]),
    /Template trainFiles does not contain required file: code\.zip/,
  );

  assert.deepEqual(
    replaceTrainFiles(
      [{ name: "run.sh", path: "old/run.sh" }],
      [{ name: "code.zip", path: "new/code.zip" }],
      { allowAddFile: true },
    ),
    [
      { name: "run.sh", path: "old/run.sh" },
      { name: "code.zip", path: "new/code.zip" },
    ],
  );
});

test("relative output paths stay under outputs/taiji-output unless an absolute path is used", () => {
  assert.equal(
    path.relative(process.cwd(), resolvePrepareOutputDir("submit-bundle")),
    path.join("outputs", "taiji-output", "submit", "submit-bundle"),
  );
  assert.equal(
    path.relative(process.cwd(), resolveTaijiOutputFile("diff.json")),
    path.join("outputs", "taiji-output", "reports", "config-diffs", "diff.json"),
  );
  assert.throws(() => resolvePrepareOutputDir("../escape"), /Relative output paths must not contain '\.\.'/);
  assert.throws(() => resolveTaijiOutputFile("../escape.json"), /Relative output paths must not contain '\.\.'/);
});

test("direct text download rejects non-2xx responses", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    await assert.rejects(
      () => fetchTextDirect({ directCookieHeader: "session=placeholder" }, `http://127.0.0.1:${port}/missing.txt`),
      /HTTP 404/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("prepare and dry-run submit include optional run.sh replacement", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taiji-runsh-"));
  const codeZip = path.join(tempRoot, "code.zip");
  const config = path.join(tempRoot, "config.yaml");
  const runSh = path.join(tempRoot, "run.sh");
  const bundle = path.join(tempRoot, "bundle");
  const submitOut = path.join(tempRoot, "submit-plan");

  await writeFile(codeZip, "placeholder zip bytes", "utf8");
  await writeFile(config, "experiment:\n  name: runsh\n", "utf8");
  await writeFile(runSh, "#!/usr/bin/env bash\necho runsh\n", "utf8");

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "prepare-taiji-submit.mjs"),
    "--template-job-url",
    "https://taiji.algo.qq.com/training/58620",
    "--zip",
    codeZip,
    "--config",
    config,
    "--run-sh",
    runSh,
    "--name",
    "runsh_test",
    "--out",
    bundle,
    "--allow-dirty",
  ], { cwd: toolDir });

  const manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
  assert.equal(manifest.files.runSh.basename, "run.sh");
  assert.equal(
    await readFile(path.join(bundle, manifest.files.runSh.preparedPath), "utf8"),
    "#!/usr/bin/env bash\necho runsh\n",
  );

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "submit-taiji.mjs"),
    "--bundle",
    bundle,
    "--template-job-internal-id",
    "58620",
    "--out",
    submitOut,
  ], { cwd: toolDir });

  const plan = JSON.parse(await readFile(path.join(submitOut, "plan.json"), "utf8"));
  assert.equal(plan.files.runSh.basename, "run.sh");
});

test("prepare and dry-run submit include generic trainFiles after primary files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taiji-generic-"));
  const codeZip = path.join(tempRoot, "code.zip");
  const config = path.join(tempRoot, "config.yaml");
  const mainPy = path.join(tempRoot, "main.py");
  const localDataset = path.join(tempRoot, "local_dataset.py");
  const bundle = path.join(tempRoot, "bundle");
  const submitOut = path.join(tempRoot, "submit-plan");

  await writeFile(codeZip, "placeholder zip bytes", "utf8");
  await writeFile(config, "experiment:\n  name: generic\n", "utf8");
  await writeFile(mainPy, "print('main')\n", "utf8");
  await writeFile(localDataset, "print('dataset')\n", "utf8");

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "prepare-taiji-submit.mjs"),
    "--template-job-url",
    "https://taiji.algo.qq.com/training/58620",
    "--zip",
    codeZip,
    "--config",
    config,
    "--file",
    mainPy,
    "--file",
    `${localDataset}=dataset.py`,
    "--name",
    "generic_test",
    "--out",
    bundle,
    "--allow-dirty",
  ], { cwd: toolDir });

  const manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.files.genericFiles.map((file) => file.name), ["main.py", "dataset.py"]);
  assert.equal(await readFile(path.join(bundle, manifest.files.genericFiles[0].preparedPath), "utf8"), "print('main')\n");
  assert.equal(await readFile(path.join(bundle, manifest.files.genericFiles[1].preparedPath), "utf8"), "print('dataset')\n");

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "submit-taiji.mjs"),
    "--bundle",
    bundle,
    "--template-job-internal-id",
    "58620",
    "--out",
    submitOut,
  ], { cwd: toolDir });

  const plan = JSON.parse(await readFile(path.join(submitOut, "plan.json"), "utf8"));
  assert.deepEqual(plan.files.genericFiles.map((file) => file.name), ["main.py", "dataset.py"]);
});

test("generic trainFiles cannot use primary trainFile names", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taiji-reserved-"));
  const codeZip = path.join(tempRoot, "code.zip");
  const config = path.join(tempRoot, "config.yaml");
  const fakeConfig = path.join(tempRoot, "fake_config.yaml");
  const bundle = path.join(tempRoot, "bundle");

  await writeFile(codeZip, "placeholder zip bytes", "utf8");
  await writeFile(config, "experiment:\n  name: reserved\n", "utf8");
  await writeFile(fakeConfig, "reserved: true\n", "utf8");

  await assert.rejects(
    () => execFileAsync(process.execPath, [
      path.join(scriptsDir, "prepare-taiji-submit.mjs"),
      "--template-job-url",
      "https://taiji.algo.qq.com/training/58620",
      "--zip",
      codeZip,
      "--config",
      config,
      "--file",
      `${fakeConfig}=config.yaml`,
      "--name",
      "reserved_test",
      "--out",
      bundle,
      "--allow-dirty",
    ], { cwd: toolDir }),
    /reserved primary trainFile name: config\.yaml/,
  );
});

test("file-dir maps primary trainFiles and generic files automatically", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taiji-file-dir-"));
  const fileDir = path.join(tempRoot, "taiji-files");
  const nestedDir = path.join(fileDir, "nested");
  const bundle = path.join(tempRoot, "bundle");
  const submitOut = path.join(tempRoot, "submit-plan");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(path.join(fileDir, "code.zip"), "placeholder zip bytes", "utf8");
  await writeFile(path.join(fileDir, "config.yaml"), "experiment:\n  name: file-dir\n", "utf8");
  await writeFile(path.join(fileDir, "run.sh"), "#!/usr/bin/env bash\necho file-dir\n", "utf8");
  await writeFile(path.join(fileDir, "model.py"), "print('model')\n", "utf8");
  await writeFile(path.join(fileDir, "ns_groups.json"), "{}\n", "utf8");
  await writeFile(path.join(nestedDir, "ignored.py"), "print('ignored')\n", "utf8");

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "prepare-taiji-submit.mjs"),
    "--template-job-url",
    "https://taiji.algo.qq.com/training/58620",
    "--file-dir",
    fileDir,
    "--name",
    "file_dir_test",
    "--out",
    bundle,
    "--allow-dirty",
  ], { cwd: toolDir });

  const manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
  assert.equal(manifest.files.codeZip.basename, "code.zip");
  assert.equal(manifest.files.config.basename, "config.yaml");
  assert.equal(manifest.files.runSh.basename, "run.sh");
  assert.deepEqual(manifest.files.genericFiles.map((file) => file.name), ["model.py", "ns_groups.json"]);

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "submit-taiji.mjs"),
    "--bundle",
    bundle,
    "--template-job-internal-id",
    "58620",
    "--out",
    submitOut,
  ], { cwd: toolDir });

  const plan = JSON.parse(await readFile(path.join(submitOut, "plan.json"), "utf8"));
  assert.equal(plan.files.codeZip.basename, "code.zip");
  assert.equal(plan.files.config.basename, "config.yaml");
  assert.equal(plan.files.runSh.basename, "run.sh");
  assert.deepEqual(plan.files.genericFiles.map((file) => file.name), ["model.py", "ns_groups.json"]);
});

test("file-dir supports loose trainFiles without code.zip or config.yaml", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taiji-loose-dir-"));
  const fileDir = path.join(tempRoot, "taiji-files");
  const bundle = path.join(tempRoot, "bundle");
  const submitOut = path.join(tempRoot, "submit-plan");

  await mkdir(fileDir, { recursive: true });
  await writeFile(path.join(fileDir, "run.sh"), "#!/usr/bin/env bash\npython3 train.py\n", "utf8");
  await writeFile(path.join(fileDir, "dataset.py"), "print('dataset')\n", "utf8");
  await writeFile(path.join(fileDir, "train.py"), "print('train')\n", "utf8");

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "prepare-taiji-submit.mjs"),
    "--template-job-url",
    "https://taiji.algo.qq.com/training/58620",
    "--file-dir",
    fileDir,
    "--name",
    "loose_file_dir_test",
    "--out",
    bundle,
    "--allow-dirty",
  ], { cwd: toolDir });

  const manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
  assert.equal(manifest.files.codeZip, undefined);
  assert.equal(manifest.files.config, undefined);
  assert.equal(manifest.files.runSh.basename, "run.sh");
  assert.deepEqual(manifest.files.genericFiles.map((file) => file.name), ["dataset.py", "train.py"]);

  await execFileAsync(process.execPath, [
    path.join(scriptsDir, "submit-taiji.mjs"),
    "--bundle",
    bundle,
    "--template-job-internal-id",
    "58620",
    "--out",
    submitOut,
  ], { cwd: toolDir });

  const plan = JSON.parse(await readFile(path.join(submitOut, "plan.json"), "utf8"));
  assert.equal(plan.files.codeZip, undefined);
  assert.equal(plan.files.config, undefined);
  assert.equal(plan.files.runSh.basename, "run.sh");
  assert.deepEqual(plan.files.genericFiles.map((file) => file.name), ["dataset.py", "train.py"]);
});
