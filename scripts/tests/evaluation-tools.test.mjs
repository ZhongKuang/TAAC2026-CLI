import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createEvaluation,
  listModels,
  stopEvaluation,
} from "../evaluation-tools.mjs";

async function makeInferDir(tempRoot) {
  const dir = path.join(tempRoot, "infer-files");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "dataset.py"), "print('dataset')\n");
  await writeFile(path.join(dir, "dense_transform.py"), "print('dense')\n");
  await writeFile(path.join(dir, "infer.py"), "print('infer')\n");
  await writeFile(path.join(dir, "model.py"), "print('model')\n");
  await writeFile(path.join(dir, "README.md"), "not an inference file by default\n");
  return dir;
}

test("eval create dry-run builds local inference upload payload", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-eval-plan-"));
  const fileDir = await makeInferDir(tempRoot);

  const report = await createEvaluation({
    modelId: "29132",
    creator: "ams_2026_1029735554728157691",
    name: "demo_eval",
    fileDir,
    now: new Date("2026-05-06T00:00:00Z"),
  });

  assert.equal(report.mode, "dry-run");
  assert.equal(report.endpoint, "/aide/api/evaluation_tasks/");
  assert.equal(report.body.mould_id, 29132);
  assert.equal(report.body.name, "demo_eval");
  assert.equal(report.body.creator, "ams_2026_1029735554728157691");
  assert.deepEqual(report.body.files.map((file) => file.name), ["dataset.py", "dense_transform.py", "infer.py", "model.py"]);
  assert.match(report.body.files[0].path, /^2026_AMS_ALGO_Competition\/ams_2026_1029735554728157691\/infer\/local--[a-f0-9]+\/dataset\.py$/);
  assert.equal(report.body.files[0].mtime, "2026-05-06 08:00:00");
  assert.equal(report.localFiles.length, 4);
  assert.equal(report.response, null);
});

test("eval create execute uploads local files and creates evaluation task", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-eval-create-"));
  const fileDir = await makeInferDir(tempRoot);
  const cookieFile = path.join(tempRoot, "cookie.txt");
  await writeFile(cookieFile, "cookie: a=b");
  const uploads = [];
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(String(url), "https://taiji.algo.qq.com/aide/api/evaluation_tasks/");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.cookie, "a=b");
    const body = JSON.parse(init.body);
    assert.equal(body.mould_id, 29132);
    assert.equal(body.name, "demo_eval");
    assert.equal(body.files.length, 4);
    return new Response(JSON.stringify({ id: 62362, status: "pending", name: "demo_eval" }), { status: 201 });
  };

  try {
    const report = await createEvaluation({
      modelId: "29132",
      creator: "ams_2026_1029735554728157691",
      name: "demo_eval",
      fileDir,
      cookieFile,
      execute: true,
      yes: true,
      uploadFile: async (cookieHeader, localPath, key, contentType) => {
        uploads.push({ cookieHeader, localPath, key, contentType });
        return { key, bytes: 1 };
      },
    });

    assert.equal(report.mode, "execute");
    assert.equal(report.response.id, 62362);
    assert.equal(uploads.length, 4);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eval create can resolve model by name and infer creator", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-eval-model-name-"));
  const fileDir = await makeInferDir(tempRoot);
  const cookieFile = path.join(tempRoot, "cookie.txt");
  await writeFile(cookieFile, "cookie: a=b");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://taiji.algo.qq.com/aide/api/external/mould/?page=1&page_size=20&search=1.4.6%20epoch");
    assert.equal(init.headers.referer, "https://taiji.algo.qq.com/model");
    return new Response(JSON.stringify({
      count: 1,
      next: null,
      previous: null,
      results: [{
        id: 29132,
        name: "1.4.6 epoch",
        desc: "demo",
        task_id: "angel_training_ams_2026_1029735554728157691_20260505230539_5fcfa937",
      }],
    }), { status: 200 });
  };

  try {
    const report = await createEvaluation({
      modelName: "1.4.6 epoch",
      name: "demo_eval",
      fileDir,
      cookieFile,
    });

    assert.equal(report.body.mould_id, 29132);
    assert.equal(report.body.creator, "ams_2026_1029735554728157691");
    assert.equal(report.model.name, "1.4.6 epoch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eval create can use inference_code from a local submit package", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-eval-submit-name-"));
  const inferenceDir = path.join(tempRoot, "submits", "0505", "V1.4.6_demo", "inference_code");
  await mkdir(inferenceDir, { recursive: true });
  await writeFile(path.join(inferenceDir, "dataset.py"), "print('dataset')\n");
  await writeFile(path.join(inferenceDir, "dense_transform.py"), "print('dense')\n");
  await writeFile(path.join(inferenceDir, "infer.py"), "print('infer')\n");
  await writeFile(path.join(inferenceDir, "model.py"), "print('model')\n");
  await writeFile(path.join(inferenceDir, "eda.py"), "print('eda')\n");

  const report = await createEvaluation({
    modelId: "29132",
    creator: "ams_2026_1029735554728157691",
    name: "demo_eval",
    submitName: "V1.4.6_demo",
    submitsRoot: path.join(tempRoot, "submits"),
  });

  assert.equal(report.inferenceSource.submitName, "V1.4.6_demo");
  assert.equal(report.inferenceSource.path, inferenceDir);
  assert.deepEqual(report.body.files.map((file) => file.name), [
    "dataset.py",
    "dense_transform.py",
    "eda.py",
    "infer.py",
    "model.py",
  ]);
});

test("eval create rejects ambiguous local submit package names", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-eval-submit-ambiguous-"));
  await mkdir(path.join(tempRoot, "submits", "0505", "V1.4.6_a", "inference_code"), { recursive: true });
  await mkdir(path.join(tempRoot, "submits", "0506", "V1.4.6_b", "inference_code"), { recursive: true });

  await assert.rejects(
    () => createEvaluation({
      modelId: "29132",
      creator: "ams_2026_1029735554728157691",
      submitName: "V1.4.6",
      submitsRoot: path.join(tempRoot, "submits"),
    }),
    /Ambiguous --submit-name/,
  );
});

test("model list reads the model management endpoint", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-model-list-"));
  const cookieFile = path.join(tempRoot, "cookie.txt");
  await writeFile(cookieFile, "cookie: a=b");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://taiji.algo.qq.com/aide/api/external/mould/?page=1&page_size=20&search=1.4.6");
    assert.equal(init.headers.referer, "https://taiji.algo.qq.com/model");
    return new Response(JSON.stringify({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 29132, name: "1.4.6 epoch", task_id: "angel_training_ams_2026_1029735554728157691_abc" }],
    }), { status: 200 });
  };

  try {
    const report = await listModels({ cookieFile, search: "1.4.6" });
    assert.equal(report.count, 1);
    assert.equal(report.results[0].id, 29132);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eval stop is dry-run by default and live only with execute yes", async () => {
  const dryRun = await stopEvaluation({ taskId: "62362" });
  assert.equal(dryRun.mode, "dry-run");
  assert.deepEqual(dryRun.body, { task_id: 62362 });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-eval-stop-"));
  const cookieFile = path.join(tempRoot, "cookie.txt");
  await writeFile(cookieFile, "cookie: a=b");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://taiji.algo.qq.com/aide/api/evaluation_tasks/stop_task/");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { task_id: 62362 });
    return new Response(JSON.stringify({ message: "Evaluation_task stopped." }), { status: 200 });
  };

  try {
    const live = await stopEvaluation({ taskId: "62362", cookieFile, execute: true, yes: true });
    assert.equal(live.mode, "execute");
    assert.equal(live.response.message, "Evaluation_task stopped.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
