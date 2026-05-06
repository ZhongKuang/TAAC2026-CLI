#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { validateTrainFileDownload } from "./scrape-taiji.mjs";

const DEFAULT_OUT_ROOT = "taiji-output";
const TAIJI_ORIGIN = "https://taiji.algo.qq.com";

function usage() {
  return `Usage:
  taac2026 submit doctor --bundle <submit-bundle-dir> [--json] [--out <file>]
  taac2026 submit verify --bundle <submit-bundle-dir> --job-internal-id <id> [--output-dir taiji-output]
  taac2026 compare jobs <job-internal-id...> [--output-dir taiji-output] [--json]
  taac2026 compare-runs --base <id> --exp <id> [--config] [--metrics] [--json]
  taac2026 logs --job <id> --errors [--tail 100] [--json]
  taac2026 ckpt-select --job <id> --by valid_auc [--json]
  taac2026 ckpt-publish --job <id> --ckpt <ckpt-name> --cookie-file <file> [--execute --yes] [--force]
  taac2026 config diff-ref --config <config.yaml> --job-internal-id <id> [--output-dir taiji-output]
  taac2026 ledger sync [--output-dir taiji-output] [--out <file>]
  taac2026 diagnose job --job-internal-id <id> [--output-dir taiji-output] [--json]`;
}

function parseArgs(argv) {
  const positional = [];
  const args = { positional };
  const booleanFlags = new Set(["json", "errors", "config", "metrics", "execute", "yes", "force"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (booleanFlags.has(key)) {
        args[key] = true;
        continue;
      }
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      args[key] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return args;
}

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function assertSafeRelativeOutputPath(outPath) {
  if (!path.isAbsolute(outPath) && String(outPath).split(/[\\/]+/).includes("..")) {
    throw new Error("Relative output paths must not contain '..'. Use an absolute path for custom locations outside taiji-output.");
  }
}

function resolveOutputPath(outPath, defaultSubdir) {
  assertSafeRelativeOutputPath(outPath);
  if (path.isAbsolute(outPath)) return outPath;
  if (outPath.split(/[\\/]/)[0] === DEFAULT_OUT_ROOT) return path.resolve(outPath);
  return path.resolve(DEFAULT_OUT_ROOT, defaultSubdir, outPath);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function csvParseRows(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\r") continue;
    if (ch === "\"" && inQuotes && text[i + 1] === "\"") {
      current += '"';
      i += 1;
    } else if (ch === "\"") {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(current);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += ch;
    }
  }
  row.push(current);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

async function readCsv(filePath) {
  if (!(await exists(filePath))) return [];
  const rows = csvParseRows(await readFile(filePath, "utf8"));
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
  });
}

function explicitTestScore(text) {
  const scores = [];
  for (const match of String(text ?? "").matchAll(/\btest\s*[:=]?\s*(0\.\d+)/gi)) {
    const prefix = String(text ?? "").slice(0, match.index).trim().split(/\s+/).at(-1)?.toLowerCase();
    if (prefix === "val") continue;
    scores.push(Number(match[1]));
  }
  return scores.length ? Math.max(...scores) : null;
}

async function loadJobRows(outputDir) {
  return readCsv(path.join(outputDir, "jobs-summary.csv"));
}

async function loadMetricRows(outputDir) {
  return readCsv(path.join(outputDir, "all-metrics-long.csv"));
}

async function loadCheckpointRows(outputDir) {
  return readCsv(path.join(outputDir, "all-checkpoints.csv"));
}

function extractCookieHeader(fileContent) {
  const text = fileContent.trim();
  const headerLine = text.match(/^cookie:\s*(.+)$/im);
  if (headerLine) return headerLine[1].trim();
  const curlHeader = text.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (curlHeader) return curlHeader[2].trim();
  return text.replace(/^cookie:\s*/i, "").trim();
}

function taijiHeaders(cookieHeader, refererPath = "/training") {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie: cookieHeader,
    referer: `${TAIJI_ORIGIN}${refererPath}`,
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147 Safari/537.36",
  };
}

async function fetchTaijiJson(cookieHeader, endpoint, options = {}) {
  const url = new URL(endpoint, TAIJI_ORIGIN);
  const init = {
    method: options.method || "GET",
    headers: taijiHeaders(cookieHeader, options.refererPath),
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(url.href, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url.pathname}: ${String(text).slice(0, 300)}`);
  if (body?.error?.code && body.error.code !== "SUCCESS") {
    throw new Error(`Taiji API ${url.pathname} failed: ${body.error.code} ${body.error.message || body.error.cause || ""}`.trim());
  }
  return body;
}

function matchJob(row, options) {
  if (options.jobInternalId && String(row.jobInternalId) === String(options.jobInternalId)) return true;
  if (options.jobId && String(row.jobId) === String(options.jobId)) return true;
  return false;
}

async function resolveJob(outputDir, options) {
  const rows = await loadJobRows(outputDir);
  const job = rows.find((row) => matchJob(row, options));
  if (!job) throw new Error(`Job not found in ${outputDir}: ${options.jobInternalId || options.jobId}`);
  return job;
}

function trainFileLocalPath(outputDir, jobId, fileName) {
  return path.join(outputDir, "code", jobId, "files", fileName);
}

function pythonishConfigToObject(text) {
  const normalized = text
    .replace(/:\s*\(([^()]*)\)/g, ": [$1]")
    .replaceAll("'", '"')
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  return JSON.parse(normalized);
}

async function logFilesForJob(outputDir, jobId) {
  const dir = path.join(outputDir, "logs", jobId);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".txt")).map((name) => path.join(dir, name));
}

async function extractResolvedConfigs(outputDir, jobId) {
  const configs = [];
  for (const filePath of await logFilesForJob(outputDir, jobId)) {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    for (const line of lines) {
      const marker = "Resolved config: ";
      if (line.includes(marker)) {
        try {
          configs.push({
            file: filePath,
            config: pythonishConfigToObject(line.slice(line.indexOf(marker) + marker.length)),
          });
        } catch (error) {
          configs.push({ file: filePath, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return configs;
}

function flatten(value, prefix = "", out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function diffObjects(left, right, options = {}) {
  const a = flatten(left);
  const b = flatten(right);
  const added = [];
  const removed = [];
  const changed = [];
  for (const key of Object.keys(b).sort()) {
    if (!(key in a) && !options.ignoreAdded) added.push({ path: key, value: b[key] });
  }
  for (const key of Object.keys(a).sort()) {
    if (!(key in b)) removed.push({ path: key, value: a[key] });
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push({ path: key, current: a[key], reference: b[key] });
  }
  return { added, removed, changed };
}

function normalizeMetricText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/^Logloss\b/i, "LogLoss").replace(/\/Logloss\b/i, "/LogLoss");
}

function metricKey(row) {
  const metric = normalizeMetricText(row.metric);
  const chart = normalizeMetricText(row.chart);
  const series = normalizeMetricText(row.series);
  const fullKey = [series, chart, metric].find((value) => value.includes("/"));
  if (fullKey) return fullKey;
  if (metric && chart && chart !== metric) return `${metric}/${chart}`;
  if (metric && series && series !== metric) return `${metric}/${series}`;
  return metric || chart || series;
}

function summarizeMetricRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = metricKey(row);
    const value = Number(row.value);
    if (!key || !Number.isFinite(value)) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push({ step: Number(row.step), value });
    byKey.set(key, bucket);
  }

  const summary = {};
  for (const [key, points] of byKey.entries()) {
    const best = key.toLowerCase().includes("logloss")
      ? points.reduce((a, b) => (b.value < a.value ? b : a), points[0])
      : points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
    const last = points.at(-1);
    summary[key] = {
      points: points.length,
      bestStep: best.step,
      bestValue: best.value,
      lastStep: last.step,
      lastValue: last.value,
      deltaLastVsBest: last.value - best.value,
    };
  }
  return summary;
}

function metricRowsForJob(rows, jobInternalId) {
  return rows.filter((row) => String(row.jobInternalId) === String(jobInternalId));
}

function metricsAtStep(rows, step) {
  const result = {};
  for (const row of rows) {
    if (Number(row.step) === Number(step)) {
      const value = Number(row.value);
      if (Number.isFinite(value)) result[metricKey(row)] = value;
    }
  }
  return result;
}

function parseCheckpointName(ckpt) {
  const text = String(ckpt ?? "");
  const step = text.match(/global_step(\d+)/i);
  const epoch = text.match(/epoch=(\d+)/i);
  const auc = text.match(/AUC=([0-9]+(?:\.[0-9]+)?)/i);
  const logloss = text.match(/Logloss=([0-9]+(?:\.[0-9]+)?)/i);
  return {
    step: step ? Number(step[1]) : null,
    epoch: epoch ? Number(epoch[1]) : null,
    auc: auc ? Number(auc[1]) : null,
    logloss: logloss ? Number(logloss[1]) : null,
  };
}

function checkpointRowsForJob(rows, jobInternalId) {
  return rows
    .filter((row) => String(row.jobInternalId) === String(jobInternalId))
    .map((row) => ({ ...row, parsed: parseCheckpointName(row.ckpt) }));
}

function checkpointForStep(checkpoints, step) {
  return checkpoints.find((row) => Number(row.parsed.step) === Number(step)) ?? null;
}

function ruleSpec(rule) {
  const normalized = String(rule ?? "valid_auc").toLowerCase().replaceAll("-", "_");
  if (normalized === "valid_auc") return { rule: normalized, metric: "AUC/valid", mode: "max" };
  if (normalized === "valid_test_like_auc" || normalized === "test_like_auc") {
    return { rule: normalized, metric: "AUC/valid_test_like", mode: "max" };
  }
  if (normalized === "valid_logloss" || normalized === "logloss") return { rule: normalized, metric: "LogLoss/valid", mode: "min" };
  if (normalized === "pareto") return { rule: normalized, metric: null, mode: "pareto" };
  throw new Error(`Unsupported checkpoint rule: ${rule}`);
}

function candidateFromPoint(point, rows, checkpoints, spec) {
  const ckpt = checkpointForStep(checkpoints, point.step);
  return {
    rule: spec.rule,
    step: point.step,
    epoch: ckpt?.parsed.epoch ?? null,
    ckpt: ckpt?.ckpt ?? null,
    checkpoint: ckpt
      ? {
          ckpt: ckpt.ckpt,
          status: ckpt.status,
          createTime: ckpt.createTime,
          deleteTime: ckpt.deleteTime,
          ckptFileSize: ckpt.ckptFileSize,
        }
      : null,
    metrics: metricsAtStep(rows, point.step),
  };
}

function selectCandidateBySpec(rows, checkpoints, spec, jobInternalId) {
  const point = selectPointByMetric(rows, spec.metric, spec.mode);
  if (!point) throw new Error(`No metric rows found for ${spec.metric} on job ${jobInternalId}`);
  return candidateFromPoint(point, rows, checkpoints, spec);
}

function selectCandidateOrNull(rows, checkpoints, spec, jobInternalId) {
  try {
    return selectCandidateBySpec(rows, checkpoints, spec, jobInternalId);
  } catch {
    return null;
  }
}

function selectPointByMetric(rows, metric, mode) {
  const points = rows
    .filter((row) => metricKey(row) === metric)
    .map((row) => ({ step: Number(row.step), value: Number(row.value) }))
    .filter((point) => Number.isFinite(point.step) && Number.isFinite(point.value));
  if (!points.length) return null;
  return points.reduce((best, point) => {
    if (mode === "min") return point.value < best.value ? point : best;
    return point.value > best.value ? point : best;
  }, points[0]);
}

function paretoCandidates(rows, checkpoints) {
  const steps = [...new Set(rows.map((row) => Number(row.step)).filter(Number.isFinite))].sort((a, b) => a - b);
  const candidates = steps.map((step) => {
    const metrics = metricsAtStep(rows, step);
    return {
      rule: "pareto",
      step,
      epoch: checkpointForStep(checkpoints, step)?.parsed.epoch ?? null,
      ckpt: checkpointForStep(checkpoints, step)?.ckpt ?? null,
      metrics,
    };
  }).filter((candidate) => Number.isFinite(candidate.metrics["AUC/valid"]));
  return candidates.filter((candidate) => {
    return !candidates.some((other) => {
      if (other === candidate) return false;
      const auc = other.metrics["AUC/valid"] >= candidate.metrics["AUC/valid"];
      const like = (other.metrics["AUC/valid_test_like"] ?? -Infinity) >= (candidate.metrics["AUC/valid_test_like"] ?? -Infinity);
      const loss = (other.metrics["LogLoss/valid"] ?? Infinity) <= (candidate.metrics["LogLoss/valid"] ?? Infinity);
      const strictlyBetter =
        other.metrics["AUC/valid"] > candidate.metrics["AUC/valid"] ||
        (other.metrics["AUC/valid_test_like"] ?? -Infinity) > (candidate.metrics["AUC/valid_test_like"] ?? -Infinity) ||
        (other.metrics["LogLoss/valid"] ?? Infinity) < (candidate.metrics["LogLoss/valid"] ?? Infinity);
      return auc && like && loss && strictlyBetter;
    });
  });
}

function addFinding(findings, level, code, message, detail = {}) {
  findings.push({ level, code, message, ...detail });
}

function levelRank(level) {
  return { pass: 0, info: 0, warn: 1, fail: 2 }[level] ?? 0;
}

function summarizeFindings(findings) {
  const status = findings.some((finding) => finding.level === "fail")
    ? "fail"
    : findings.some((finding) => finding.level === "warn")
      ? "warn"
      : "pass";
  return {
    status,
    counts: {
      fail: findings.filter((finding) => finding.level === "fail").length,
      warn: findings.filter((finding) => finding.level === "warn").length,
      info: findings.filter((finding) => finding.level === "info").length,
    },
  };
}

function preparedFilesFromManifest(manifest) {
  const files = [];
  if (manifest.files?.codeZip) files.push({ name: "code.zip", ...manifest.files.codeZip });
  if (manifest.files?.config) files.push({ name: "config.yaml", ...manifest.files.config });
  if (manifest.files?.runSh) files.push({ name: "run.sh", ...manifest.files.runSh });
  for (const file of manifest.files?.genericFiles ?? []) files.push({ ...file });
  return files;
}

function parseYamlMapping(buffer, name) {
  const parsed = yaml.load(buffer.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name}: expected YAML mapping`);
  return parsed;
}

function thresholdMention(text) {
  const match = String(text ?? "").match(/(?:阈值|threshold)\s*[:=]?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function inspectPreparedFile(bundleDir, file, findings) {
  const filePath = path.resolve(bundleDir, file.preparedPath ?? "");
  const result = {
    name: file.name,
    preparedPath: file.preparedPath,
    path: filePath,
    expectedBytes: file.bytes,
  };
  if (!file.preparedPath || !(await exists(filePath))) {
    addFinding(findings, "fail", "missing_prepared_file", `Prepared file is missing: ${file.name}`, { file: file.name });
    return result;
  }

  const buffer = await readFile(filePath);
  result.bytes = buffer.length;
  result.sha256 = createHash("sha256").update(buffer).digest("hex");

  try {
    validateTrainFileDownload({ name: file.name, size: file.bytes }, { buffer, contentType: "" });
  } catch (error) {
    addFinding(findings, "fail", "invalid_prepared_file", error instanceof Error ? error.message : String(error), { file: file.name });
  }
  return result;
}

export async function doctorBundle(options) {
  const bundleDir = path.resolve(required(options.bundleDir, "Missing bundleDir"));
  const manifestPath = path.join(bundleDir, "manifest.json");
  const findings = [];
  if (!(await exists(manifestPath))) {
    addFinding(findings, "fail", "missing_manifest", `manifest.json not found: ${manifestPath}`);
    return { bundleDir, summary: summarizeFindings(findings), findings, files: [] };
  }

  const manifest = await readJson(manifestPath);
  const files = [];
  for (const file of preparedFilesFromManifest(manifest)) {
    files.push(await inspectPreparedFile(bundleDir, file, findings));
  }

  if (manifest.git?.dirty) {
    addFinding(findings, "warn", "git_dirty", "Bundle was prepared from a dirty git working tree.", {
      head: manifest.git.head,
      statusShort: manifest.git.statusShort,
    });
  }

  const configFile = files.find((file) => file.name === "config.yaml" && file.bytes);
  if (configFile) {
    const config = parseYamlMapping(await readFile(configFile.path), "config.yaml");
    const mentionedThreshold = thresholdMention(`${manifest.job?.name ?? ""} ${manifest.job?.description ?? ""}`);
    if (mentionedThreshold != null && Number(config.item_id_oov_threshold) !== mentionedThreshold) {
      addFinding(
        findings,
        "warn",
        "description_threshold_mismatch",
        `Job text mentions threshold ${mentionedThreshold}, but config item_id_oov_threshold is ${config.item_id_oov_threshold}.`,
      );
    }
  }

  return {
    bundleDir,
    job: manifest.job ?? {},
    git: manifest.git ?? {},
    summary: summarizeFindings(findings),
    findings: findings.sort((a, b) => levelRank(b.level) - levelRank(a.level)),
    files,
  };
}

export async function verifyBundleAgainstJob(options) {
  const bundleReport = await doctorBundle({ bundleDir: options.bundleDir });
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const findings = [...bundleReport.findings];
  const files = [];

  for (const file of bundleReport.files) {
    const platformPath = trainFileLocalPath(outputDir, job.jobId, file.name);
    const platformExists = await exists(platformPath);
    const platformSha256 = platformExists ? await sha256File(platformPath) : null;
    const hashMatch = Boolean(file.sha256 && platformSha256 && file.sha256 === platformSha256);
    if (!platformExists) addFinding(findings, "fail", "missing_platform_file", `Platform file not found: ${file.name}`, { file: file.name });
    else if (!hashMatch) addFinding(findings, "fail", "platform_hash_mismatch", `Platform file hash mismatch: ${file.name}`, { file: file.name });
    files.push({ name: file.name, bundleSha256: file.sha256, platformSha256, hashMatch });
  }

  let resolvedConfig = { match: null };
  const bundleConfig = bundleReport.files.find((file) => file.name === "config.yaml");
  const resolvedConfigs = await extractResolvedConfigs(outputDir, job.jobId);
  if (bundleConfig?.path && resolvedConfigs[0]?.config) {
    const config = parseYamlMapping(await readFile(bundleConfig.path), "config.yaml");
    const diff = diffObjects(config, resolvedConfigs[0].config, { ignoreAdded: true });
    resolvedConfig = {
      match: !diff.added.length && !diff.removed.length && !diff.changed.length,
      diff,
    };
    if (!resolvedConfig.match) addFinding(findings, "fail", "resolved_config_mismatch", "Log Resolved config differs from bundle config.");
  }

  return {
    job,
    bundleDir: path.resolve(options.bundleDir),
    outputDir,
    summary: summarizeFindings(findings),
    findings: findings.sort((a, b) => levelRank(b.level) - levelRank(a.level)),
    files,
    resolvedConfig,
  };
}

export async function compareJobs(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const jobs = await loadJobRows(outputDir);
  const metrics = await loadMetricRows(outputDir);
  const wanted = new Set((options.jobInternalIds ?? []).map(String));
  const selected = jobs.filter((job) => !wanted.size || wanted.has(String(job.jobInternalId)));

  return {
    outputDir,
    decision: "not_provided",
    jobs: selected.map((job) => {
      const rows = metricRowsForJob(metrics, job.jobInternalId);
      return {
        jobId: job.jobId,
        jobInternalId: job.jobInternalId,
        name: job.name,
        description: job.description,
        status: job.status,
        updateTime: job.updateTime,
        explicitTestScore: explicitTestScore(`${job.name} ${job.description}`),
        metrics: summarizeMetricRows(rows),
      };
    }),
  };
}

export async function selectCheckpoint(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const spec = ruleSpec(options.by);
  const rows = metricRowsForJob(await loadMetricRows(outputDir), job.jobInternalId);
  const checkpoints = checkpointRowsForJob(await loadCheckpointRows(outputDir), job.jobInternalId);

  if (spec.mode === "pareto") {
    return {
      job,
      decision: "not_provided",
      selectedByRule: null,
      candidates: paretoCandidates(rows, checkpoints),
    };
  }

  return {
    job,
    decision: "not_provided",
    selectedByRule: selectCandidateBySpec(rows, checkpoints, spec, job.jobInternalId),
  };
}

export async function compareRuns(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const base = await resolveJob(outputDir, { jobInternalId: required(options.baseJobInternalId, "Missing baseJobInternalId") });
  const exp = await resolveJob(outputDir, { jobInternalId: required(options.expJobInternalId, "Missing expJobInternalId") });
  const metrics = await loadMetricRows(outputDir);
  const baseRows = metricRowsForJob(metrics, base.jobInternalId);
  const expRows = metricRowsForJob(metrics, exp.jobInternalId);
  const checkpoints = await loadCheckpointRows(outputDir);
  const expCheckpoints = checkpointRowsForJob(checkpoints, exp.jobInternalId);
  const baseSummary = summarizeMetricRows(baseRows);
  const expSummary = summarizeMetricRows(expRows);
  const metricDeltas = {};

  for (const key of Object.keys(baseSummary).filter((key) => expSummary[key])) {
    metricDeltas[key] = {
      baseBestValue: baseSummary[key].bestValue,
      expBestValue: expSummary[key].bestValue,
      bestDelta: expSummary[key].bestValue - baseSummary[key].bestValue,
      baseLastValue: baseSummary[key].lastValue,
      expLastValue: expSummary[key].lastValue,
      lastDelta: expSummary[key].lastValue - baseSummary[key].lastValue,
    };
  }

  const validDelta = metricDeltas["AUC/valid"]?.bestDelta ?? null;
  const testLikeDelta = metricDeltas["AUC/valid_test_like"]?.bestDelta ?? null;

  return {
    outputDir,
    decision: "not_provided",
    base: {
      jobId: base.jobId,
      jobInternalId: base.jobInternalId,
      name: base.name,
      metrics: baseSummary,
      explicitTestScore: explicitTestScore(`${base.name} ${base.description}`),
    },
    exp: {
      jobId: exp.jobId,
      jobInternalId: exp.jobInternalId,
      name: exp.name,
      metrics: expSummary,
      explicitTestScore: explicitTestScore(`${exp.name} ${exp.description}`),
    },
    config: diffObjects(await jobConfig(outputDir, base), await jobConfig(outputDir, exp)),
    metrics: metricDeltas,
    direction: {
      validAndTestLikeSameDirection:
        validDelta == null || testLikeDelta == null ? null : Math.sign(validDelta) === Math.sign(testLikeDelta),
    },
    candidates: {
      byValidAuc: selectCandidateOrNull(expRows, expCheckpoints, ruleSpec("valid_auc"), exp.jobInternalId),
      byValidTestLikeAuc: selectCandidateOrNull(expRows, expCheckpoints, ruleSpec("valid_test_like_auc"), exp.jobInternalId),
    },
  };
}

function defaultCheckpointModelName(job, checkpoint) {
  const parsed = checkpoint.parsed ?? parseCheckpointName(checkpoint.ckpt);
  const parts = [job.name || job.jobInternalId || job.jobId].filter(Boolean);
  if (parsed.epoch != null) parts.push(`epoch${parsed.epoch}`);
  if (parsed.auc != null) parts.push(`val auc ${parsed.auc.toFixed(6)}`);
  return parts.join(" ");
}

async function resolveCheckpointPublishTarget(outputDir, job, options) {
  const checkpoints = checkpointRowsForJob(await loadCheckpointRows(outputDir), job.jobInternalId);
  let ckptName = options.ckpt;
  if (!ckptName && options.by) {
    const spec = ruleSpec(options.by);
    if (spec.mode === "pareto") throw new Error("ckpt-publish does not accept --by pareto; pass an explicit --ckpt");
    const rows = metricRowsForJob(await loadMetricRows(outputDir), job.jobInternalId);
    ckptName = selectCandidateBySpec(rows, checkpoints, spec, job.jobInternalId).ckpt;
  }
  required(ckptName, "Missing --ckpt or --by");

  const matches = checkpoints.filter((checkpoint) => {
    const ckptMatches = checkpoint.ckpt === ckptName;
    const instanceMatches = !options.instanceId || checkpoint.instanceId === options.instanceId;
    return ckptMatches && instanceMatches;
  });
  if (!matches.length) {
    throw new Error(`Checkpoint not found in cached all-checkpoints.csv for job ${job.jobInternalId}: ${ckptName}`);
  }
  if (matches.length > 1) {
    throw new Error(`Checkpoint appears in multiple instances; pass --instance-id. Matches: ${matches.map((item) => item.instanceId).join(", ")}`);
  }
  return matches[0];
}

export async function publishCheckpoint(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const checkpoint = await resolveCheckpointPublishTarget(outputDir, job, options);
  const body = {
    name: options.name || defaultCheckpointModelName(job, checkpoint),
    desc: options.desc ?? options.description ?? job.description ?? job.name ?? "",
    ckpt: checkpoint.ckpt,
  };
  const endpoint = `/taskmanagement/api/v1/instances/external/${checkpoint.instanceId}/release_ckpt`;
  const result = {
    outputDir,
    mode: options.execute ? "execute" : "dry-run",
    job: {
      jobId: job.jobId,
      jobInternalId: job.jobInternalId,
      name: job.name,
      description: job.description,
    },
    instanceId: checkpoint.instanceId,
    checkpoint,
    alreadyPublished: checkpoint.status === true || checkpoint.status === "true",
    publish: { endpoint, body },
    response: null,
    after: null,
    verification: null,
  };

  if (!options.execute) return result;
  if (!options.yes) throw new Error("--execute requires --yes");
  if (result.alreadyPublished && !options.force) {
    throw new Error("Checkpoint is already published according to cached all-checkpoints.csv; pass --force to publish it again.");
  }
  const cookieFile = required(options.cookieFile, "--execute requires --cookie-file");
  const cookieHeader = extractCookieHeader(await readFile(cookieFile, "utf8"));
  result.response = await fetchTaijiJson(cookieHeader, endpoint, { method: "POST", body });
  const after = await fetchTaijiJson(cookieHeader, `/taskmanagement/api/v1/instances/external/${checkpoint.instanceId}/get_ckpt`);
  const released = (after?.data ?? []).filter((item) => item.status === true);
  const target = released.find((item) => item.ckpt === checkpoint.ckpt) ?? null;
  result.after = { released, target };
  result.verification = { released: Boolean(target) };
  return result;
}

async function jobConfig(outputDir, job) {
  const configPath = trainFileLocalPath(outputDir, job.jobId, "config.yaml");
  if (await exists(configPath)) return parseYamlMapping(await readFile(configPath), "config.yaml");
  const resolved = (await extractResolvedConfigs(outputDir, job.jobId)).find((item) => item.config);
  if (resolved?.config) return resolved.config;
  throw new Error(`No config.yaml or Resolved config found for job ${job.jobInternalId}`);
}

export async function diffConfigRef(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const current = parseYamlMapping(await readFile(path.resolve(required(options.configPath, "Missing configPath"))), "config.yaml");
  const reference = await jobConfig(outputDir, job);
  return {
    configPath: path.resolve(options.configPath),
    reference: { type: "job", jobId: job.jobId, jobInternalId: job.jobInternalId },
    ...diffObjects(current, reference),
  };
}

export async function syncLedger(options = {}) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const compared = await compareJobs({ outputDir });
  const out = options.out
    ? resolveOutputPath(options.out, "ledger")
    : path.join(outputDir, "ledger", "experiments.json");
  const result = {
    generatedAt: new Date().toISOString(),
    outputDir,
    writtenTo: out,
    experiments: compared.jobs,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function diagnoseJob(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const errors = [];
  const lastLines = [];
  for (const filePath of await logFilesForJob(outputDir, job.jobId)) {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      if (/traceback|error|exception|valueerror|runtimeerror/i.test(line)) errors.push({ file: filePath, line: index + 1, text: line });
    });
    lastLines.push({ file: filePath, lines: lines.slice(-20) });
  }
  return {
    job,
    errors,
    resolvedConfigs: await extractResolvedConfigs(outputDir, job.jobId),
    lastLines,
  };
}

export async function logsForJob(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const tailCount = Number(options.tail ?? 100);
  const errors = [];
  const tail = [];
  for (const filePath of await logFilesForJob(outputDir, job.jobId)) {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      if (/traceback|error|exception|oom|out of memory|filenotfound|no such file|valueerror|runtimeerror/i.test(line)) {
        errors.push({ file: filePath, line: index + 1, text: line });
      }
    });
    tail.push({ file: filePath, lines: lines.slice(-tailCount) });
  }
  return {
    job,
    errorsOnly: Boolean(options.errorsOnly),
    errors,
    tail,
  };
}

function formatReport(report) {
  const lines = [`status: ${report.summary?.status ?? "unknown"}`];
  for (const finding of report.findings ?? []) lines.push(`- ${finding.level}: ${finding.code}: ${finding.message}`);
  return `${lines.join("\n")}\n`;
}

async function writeResult(result, args, defaultName) {
  if (args.out) {
    const outPath = resolveOutputPath(args.out, "reports");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outPath}`);
    return;
  }
  console.log(args.json ? JSON.stringify(result, null, 2) : formatReport(result));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.positional.length) {
    console.log(usage());
    return;
  }

  const [domain, action] = args.positional;
  if (domain === "submit" && action === "doctor") {
    await writeResult(await doctorBundle({ bundleDir: args.bundle }), args, "doctor.json");
    return;
  }
  if (domain === "submit" && action === "verify") {
    await writeResult(await verifyBundleAgainstJob({
      bundleDir: args.bundle,
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId,
      jobId: args.jobId,
    }), args, "verify.json");
    return;
  }
  if (domain === "compare" && action === "jobs") {
    await writeResult(await compareJobs({
      outputDir: args.outputDir,
      jobInternalIds: args.positional.slice(2),
    }), { ...args, json: args.json ?? true }, "compare-jobs.json");
    return;
  }
  if ((domain === "compare" && action === "runs") || domain === "compare-runs") {
    await writeResult(await compareRuns({
      outputDir: args.outputDir,
      baseJobInternalId: args.base,
      expJobInternalId: args.exp,
    }), { ...args, json: args.json ?? true }, "compare-runs.json");
    return;
  }
  if (domain === "logs") {
    await writeResult(await logsForJob({
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId ?? args.job,
      jobId: args.jobId,
      errorsOnly: args.errors,
      tail: args.tail,
    }), { ...args, json: args.json ?? true }, "logs.json");
    return;
  }
  if (domain === "ckpt-select") {
    await writeResult(await selectCheckpoint({
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId ?? args.job,
      jobId: args.jobId,
      by: args.by,
    }), { ...args, json: args.json ?? true }, "ckpt-select.json");
    return;
  }
  if (domain === "ckpt-publish") {
    await writeResult(await publishCheckpoint({
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId ?? args.job,
      jobId: args.jobId,
      instanceId: args.instanceId ?? args.instance,
      ckpt: args.ckpt,
      by: args.by,
      name: args.name,
      desc: args.desc,
      description: args.description,
      cookieFile: args.cookieFile,
      execute: args.execute,
      yes: args.yes,
      force: args.force,
    }), { ...args, json: args.json ?? true }, "ckpt-publish.json");
    return;
  }
  if (domain === "config" && action === "diff-ref") {
    await writeResult(await diffConfigRef({
      configPath: args.config,
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId,
      jobId: args.jobId,
    }), { ...args, json: args.json ?? true }, "config-diff-ref.json");
    return;
  }
  if (domain === "ledger" && action === "sync") {
    const result = await syncLedger({ outputDir: args.outputDir, out: args.out });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Wrote ${result.writtenTo} (${result.experiments.length} experiments)`);
    return;
  }
  if (domain === "diagnose" && action === "job") {
    await writeResult(await diagnoseJob({
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId,
      jobId: args.jobId,
    }), { ...args, json: args.json ?? true }, "diagnose-job.json");
    return;
  }

  throw new Error(`Unsupported experiment tool command: ${args.positional.join(" ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
