import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  compareJobs,
  compareRuns,
  diagnoseJob,
  diffConfigRef,
  doctorBundle,
  logsForJob,
  publishCheckpoint,
  selectCheckpoint,
  syncLedger,
  verifyBundleAgainstJob,
} from "../experiment-tools.mjs";

async function makeBundle(tempRoot, options = {}) {
  const bundle = path.join(tempRoot, options.name ?? "bundle");
  await mkdir(path.join(bundle, "files"), { recursive: true });

  const configText = options.configText ?? "item_id_oov_threshold: 5\nitem_id_oov_buckets: 32\n";
  const runShText = options.runShText ?? "#!/usr/bin/env bash\necho train\n";
  await writeFile(path.join(bundle, "files", "code.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await writeFile(path.join(bundle, "files", "config.yaml"), configText);
  await writeFile(path.join(bundle, "files", "run.sh"), runShText);
  await writeFile(
    path.join(bundle, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        job: options.job ?? { name: "v1 bucket 32", description: "阈值10 but config uses 5" },
        files: {
          codeZip: { basename: "code.zip", bytes: 4, preparedPath: "files/code.zip" },
          config: { basename: "config.yaml", bytes: Buffer.byteLength(configText), preparedPath: "files/config.yaml" },
          runSh: { basename: "run.sh", bytes: Buffer.byteLength(runShText), preparedPath: "files/run.sh" },
        },
        git: options.git ?? { available: true, dirty: true, head: "abc123", statusShort: " M config.yaml" },
      },
      null,
      2,
    ),
  );
  return bundle;
}

async function makeTaijiOutput(tempRoot) {
  const outputDir = path.join(tempRoot, "taiji-output");
  const jobId = "angel_job_a";
  const instanceId = "instance_a";
  const codeDir = path.join(outputDir, "code", jobId);
  const filesDir = path.join(codeDir, "files");
  const logDir = path.join(outputDir, "logs", jobId);
  await mkdir(filesDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  await writeFile(path.join(filesDir, "code.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await writeFile(path.join(filesDir, "config.yaml"), "item_id_oov_threshold: 5\nitem_id_oov_buckets: 32\n");
  await writeFile(path.join(filesDir, "run.sh"), "#!/usr/bin/env bash\necho train\n");
  const jobBCodeDir = path.join(outputDir, "code", "angel_job_b");
  const jobBFilesDir = path.join(jobBCodeDir, "files");
  await mkdir(jobBFilesDir, { recursive: true });
  await writeFile(path.join(jobBFilesDir, "config.yaml"), "item_id_oov_threshold: 10\nitem_id_oov_buckets: 32\n");
  await writeFile(
    path.join(codeDir, "train-files.json"),
    JSON.stringify({
      saved: [
        { name: "code.zip", saved: true, relativePath: "code/angel_job_a/files/code.zip" },
        { name: "config.yaml", saved: true, relativePath: "code/angel_job_a/files/config.yaml" },
        { name: "run.sh", saved: true, relativePath: "code/angel_job_a/files/run.sh" },
      ],
    }),
  );
  await writeFile(
    path.join(logDir, `${instanceId}.txt`),
    "start\nResolved config: {'item_id_oov_threshold': 5, 'item_id_oov_buckets': 32}\nTraceback (most recent call last):\nValueError: example\n",
  );
  await writeFile(
    path.join(outputDir, "jobs-summary.csv"),
    [
      "jobId,jobInternalId,name,description,status,jzStatus,updateTime,syncMode,lastSeenAt,lastDeepFetchedAt,instances",
      'angel_job_a,56242,"v1 test 0.816577","bucket 32\nsecond line",SUCCEED,END,2026-05-05T01:00:00+08:00,deep,,,1',
      'angel_job_b,58244,"v2 test 0.815174","threshold 10",SUCCEED,END,2026-05-05T02:00:00+08:00,deep,,,1',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(outputDir, "all-metrics-long.csv"),
    [
      "jobId,jobInternalId,jobName,instanceId,metric,chart,chartIndex,series,step,value",
      "angel_job_a,56242,v1,instance_a,AUC,AUC/valid,0,AUC/valid,1,0.86",
      "angel_job_a,56242,v1,instance_a,AUC,AUC/valid,0,AUC/valid,2,0.865",
      "angel_job_a,56242,v1,instance_a,AUC,AUC/valid_test_like,0,AUC/valid_test_like,2,0.864",
      "angel_job_a,56242,v1,instance_a,LogLoss,LogLoss/valid,0,LogLoss/valid,2,0.27",
      "angel_job_a,56242,v1,instance_a,Loss,Loss/train,0,Loss/train,3,0.25",
      "angel_job_b,58244,v2,instance_b,AUC,AUC/valid,0,AUC/valid,1,0.861",
      "angel_job_b,58244,v2,instance_b,AUC,AUC/valid_test_like,0,AUC/valid_test_like,1,0.866",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(outputDir, "all-checkpoints.csv"),
    [
      "jobId,jobInternalId,jobName,instanceId,ckpt,ckptFileSize,createTime,deleteTime,status",
      "angel_job_a,56242,v1,instance_a,global_step1.epoch=1.AUC=0.860000.Logloss=0.280000.best_model,100,2026-05-05T01:10:00+08:00,,false",
      "angel_job_a,56242,v1,instance_a,global_step2.epoch=2.AUC=0.865000.Logloss=0.270000.best_model,100,2026-05-05T01:20:00+08:00,,true",
      "angel_job_b,58244,v2,instance_b,global_step1.epoch=1.AUC=0.861000.Logloss=0.275000.best_model,100,2026-05-05T02:10:00+08:00,,true",
      "",
    ].join("\n"),
  );
  return { outputDir, jobId, instanceId };
}

test("doctor validates a prepared submit bundle and records file hashes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-doctor-"));
  const bundle = await makeBundle(tempRoot);

  const report = await doctorBundle({ bundleDir: bundle });

  assert.equal(report.summary.status, "warn");
  assert.equal(report.files.length, 3);
  assert.equal(report.files.find((file) => file.name === "code.zip").sha256.length, 64);
  assert(report.findings.some((finding) => finding.code === "git_dirty"));
  assert(report.findings.some((finding) => finding.code === "description_threshold_mismatch"));
});

test("verify compares a bundle with downloaded platform trainFiles and resolved config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-verify-"));
  const bundle = await makeBundle(tempRoot, { job: { name: "v1", description: "bucket 32" }, git: { dirty: false } });
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await verifyBundleAgainstJob({ bundleDir: bundle, outputDir, jobInternalId: "56242" });

  assert.equal(report.summary.status, "pass");
  assert(report.files.every((file) => file.hashMatch));
  assert.equal(report.resolvedConfig.match, true);
});

test("compare jobs summarizes evidence without selecting a winner", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-compare-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await compareJobs({ outputDir, jobInternalIds: ["56242", "58244"] });

  assert.equal(report.jobs.length, 2);
  assert.equal(report.jobs[0].jobInternalId, "56242");
  assert.equal(report.jobs[0].metrics["AUC/valid"].bestValue, 0.865);
  assert.equal(report.jobs[0].explicitTestScore, 0.816577);
  assert.equal(report.decision, "not_provided");
});

test("config diff-ref compares local config against a downloaded job config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-diff-ref-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);
  const currentConfig = path.join(tempRoot, "current.yaml");
  await writeFile(currentConfig, "item_id_oov_threshold: 10\nitem_id_oov_buckets: 32\n");

  const report = await diffConfigRef({ configPath: currentConfig, outputDir, jobInternalId: "56242" });

  assert.deepEqual(report.changed.map((item) => item.path), ["item_id_oov_threshold"]);
});

test("ledger sync writes a structured experiment ledger", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ledger-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);
  const out = path.join(tempRoot, "ledger.json");

  const report = await syncLedger({ outputDir, out });
  const saved = JSON.parse(await readFile(out, "utf8"));

  assert.equal(report.experiments.length, 2);
  assert.equal(saved.experiments[0].jobInternalId, "56242");
  assert.equal(saved.experiments[0].explicitTestScore, 0.816577);
});

test("diagnose job extracts errors and resolved config from logs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-diagnose-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await diagnoseJob({ outputDir, jobInternalId: "56242" });

  assert.equal(report.job.jobInternalId, "56242");
  assert.equal(report.errors.length, 2);
  assert.equal(report.resolvedConfigs.length, 1);
});

test("compare-runs combines config and metric evidence without selecting a winner", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-compare-runs-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await compareRuns({ outputDir, baseJobInternalId: "58244", expJobInternalId: "56242" });

  assert.equal(report.decision, "not_provided");
  assert.equal(report.base.jobInternalId, "58244");
  assert.equal(report.exp.jobInternalId, "56242");
  assert.deepEqual(report.config.changed.map((item) => item.path), ["item_id_oov_threshold"]);
  assert.equal(report.metrics["AUC/valid"].bestDelta, 0.0040000000000000036);
  assert.equal(report.direction.validAndTestLikeSameDirection, false);
  assert.equal(report.candidates.byValidAuc.step, 2);
});

test("logs command extracts errors and configurable tail lines", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-logs-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await logsForJob({ outputDir, jobInternalId: "56242", errorsOnly: true, tail: 2 });

  assert.equal(report.job.jobInternalId, "56242");
  assert.equal(report.errors.length, 2);
  assert.equal(report.tail[0].lines.length, 2);
});

test("ckpt-select returns a checkpoint candidate by explicit rule", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ckpt-select-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await selectCheckpoint({ outputDir, jobInternalId: "56242", by: "valid_auc" });

  assert.equal(report.decision, "not_provided");
  assert.equal(report.selectedByRule.rule, "valid_auc");
  assert.equal(report.selectedByRule.step, 2);
  assert.equal(report.selectedByRule.epoch, 2);
  assert.match(report.selectedByRule.ckpt, /global_step2/);
  assert.equal(report.selectedByRule.metrics["AUC/valid"], 0.865);
});

test("ckpt-select pareto ignores train-only steps", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ckpt-pareto-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await selectCheckpoint({ outputDir, jobInternalId: "56242", by: "pareto" });

  assert(report.candidates.length > 0);
  assert(!report.candidates.some((candidate) => candidate.step === 3));
  assert(report.candidates.every((candidate) => Number.isFinite(candidate.metrics["AUC/valid"])));
});

test("ckpt-publish dry-run builds a safe release plan from cached evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ckpt-publish-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await publishCheckpoint({
    outputDir,
    jobInternalId: "56242",
    ckpt: "global_step1.epoch=1.AUC=0.860000.Logloss=0.280000.best_model",
  });

  assert.equal(report.mode, "dry-run");
  assert.equal(report.publish.endpoint, "/taskmanagement/api/v1/instances/external/instance_a/release_ckpt");
  assert.equal(report.publish.body.name, "v1 test 0.816577 epoch1 val auc 0.860000");
  assert.equal(report.publish.body.desc, "bucket 32\nsecond line");
  assert.equal(report.publish.body.ckpt, "global_step1.epoch=1.AUC=0.860000.Logloss=0.280000.best_model");
  assert.equal(report.checkpoint.status, "false");
  assert.equal(report.response, null);
});

test("ckpt-publish execute calls release_ckpt and verifies target status", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ckpt-publish-live-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);
  const cookieFile = path.join(tempRoot, "cookie.txt");
  await writeFile(cookieFile, "cookie: a=b");
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/release_ckpt")) {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.cookie, "a=b");
      assert.deepEqual(JSON.parse(init.body), {
        name: "v1 test 0.816577 epoch1 val auc 0.860000",
        desc: "bucket 32\nsecond line",
        ckpt: "global_step1.epoch=1.AUC=0.860000.Logloss=0.280000.best_model",
      });
      return new Response(JSON.stringify({ error: { code: "SUCCESS", message: "", cause: "" }, data: null }), { status: 200 });
    }
    if (String(url).endsWith("/get_ckpt")) {
      return new Response(JSON.stringify({
        error: { code: "SUCCESS", message: "", cause: "" },
        data: [{ ckpt: "global_step1.epoch=1.AUC=0.860000.Logloss=0.280000.best_model", status: true }],
      }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const report = await publishCheckpoint({
      outputDir,
      jobInternalId: "56242",
      ckpt: "global_step1.epoch=1.AUC=0.860000.Logloss=0.280000.best_model",
      cookieFile,
      execute: true,
      yes: true,
    });

    assert.equal(report.mode, "execute");
    assert.equal(report.verification.released, true);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ckpt-publish execute refuses an already published checkpoint unless forced", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ckpt-publish-duplicate-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);
  const cookieFile = path.join(tempRoot, "cookie.txt");
  await writeFile(cookieFile, "cookie: a=b");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    await assert.rejects(
      publishCheckpoint({
        outputDir,
        jobInternalId: "56242",
        ckpt: "global_step2.epoch=2.AUC=0.865000.Logloss=0.270000.best_model",
        cookieFile,
        execute: true,
        yes: true,
      }),
      /already published/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
