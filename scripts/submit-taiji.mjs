#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const DEFAULT_OUT_ROOT = "outputs/taiji-output/submit";
const DEFAULT_SUBMIT_LIVE_DIR = "live";
const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";
const TAIJI_ORIGIN = "https://taiji.algo.qq.com";

function usage() {
  return `Usage:
  taac2026 submit --bundle <submit-bundle-dir> --cookie-file <cookie-file> --template-job-internal-id <id> [options]
  node scripts/submit-taiji.mjs --bundle <submit-bundle-dir> --cookie-file <cookie-file> --template-job-internal-id <id> [options]

Options:
  --bundle <dir>                    Prepared bundle directory from prepare-taiji-submit.mjs.
  --cookie-file <file>              Cookie header or Copy-as-cURL text.
  --template-job-internal-id <id>   Numeric Taiji job detail id, e.g. 58620.
  --template-job-url <url>          Optional URL; numeric id is inferred when possible.
  --name <name>                     Override Job Name from bundle manifest.
  --description <text>              Override Job Description from bundle manifest.
  --execute                         Actually upload files and create the Job. Default is dry-run.
  --run                             Start the new Job after creation.
  --yes                             Required together with --execute.
  --allow-add-file                  Allow uploaded files absent from the template trainFiles.
  --out <dir>                       Output directory. Relative paths are placed under outputs/taiji-output/submit/. Default: outputs/taiji-output/submit/live/<timestamp>.
  --help                            Show this help.

Dry-run is the default. It never uploads files, creates jobs, or starts jobs.`;
}

function parseArgs(argv) {
  const args = { allowAddFile: false, execute: false, run: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--run") args.run = true;
    else if (arg === "--yes") args.yes = true;
    else if (arg === "--allow-add-file") args.allowAddFile = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function assertSafeRelativeOutputPath(outDir) {
  if (!path.isAbsolute(outDir) && String(outDir).split(/[\\/]+/).includes("..")) {
    throw new Error("Relative output paths must not contain '..'. Use an absolute path for custom locations outside outputs/taiji-output.");
  }
}

export function resolveTaijiOutputDir(outDir) {
  assertSafeRelativeOutputPath(outDir);
  if (path.isAbsolute(outDir)) return outDir;
  const parts = outDir.split(/[\\/]+/);
  if (parts[0] === "outputs" && parts[1] === "taiji-output") return path.resolve(outDir);
  if (parts[0] === "taiji-output") return path.resolve(DEFAULT_OUT_ROOT, ...parts.slice(1));
  return path.resolve(DEFAULT_OUT_ROOT, outDir);
}

function extractCookieHeader(fileContent) {
  const text = fileContent.trim();
  const headerLine = text.match(/^cookie:\s*(.+)$/im);
  if (headerLine) return headerLine[1].trim();
  const curlHeader = text.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (curlHeader) return curlHeader[2].trim();
  return text.replace(/^cookie:\s*/i, "").trim();
}

function inferInternalId(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const numericParts = parsed.pathname.split("/").filter((part) => /^\d{4,}$/.test(part));
    return numericParts[0] || "";
  } catch {
    return "";
  }
}

function taijiHeaders(cookieHeader) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie: cookieHeader,
    referer: `${TAIJI_ORIGIN}/training`,
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147 Safari/537.36",
  };
}

async function fetchJson(cookieHeader, endpoint, options = {}) {
  const url = new URL(endpoint, TAIJI_ORIGIN);
  const init = {
    method: options.method || "GET",
    headers: taijiHeaders(cookieHeader),
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
  return body;
}

async function loadBundle(bundleDir) {
  const manifestPath = path.join(bundleDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const codeZip = manifest.files.codeZip?.preparedPath ? path.resolve(bundleDir, manifest.files.codeZip.preparedPath) : null;
  const config = manifest.files.config?.preparedPath ? path.resolve(bundleDir, manifest.files.config.preparedPath) : null;
  const runSh = manifest.files.runSh?.preparedPath ? path.resolve(bundleDir, manifest.files.runSh.preparedPath) : null;
  const genericFiles = (manifest.files.genericFiles ?? []).map((file) => ({
    name: file.name,
    path: path.resolve(bundleDir, file.preparedPath),
  }));
  return { manifest, codeZip, config, runSh, genericFiles };
}

async function fileMeta(filePath) {
  const s = await stat(filePath);
  return { bytes: s.size, basename: path.basename(filePath) };
}

function formatTaijiTime(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const bj = new Date(utc + 8 * 60 * 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

function inferCosPrefix(templateData) {
  for (const file of templateData.trainFiles || []) {
    const match = String(file.path || "").match(/^(.*?\/ams_[^/]+)\/train\//);
    if (match) return match[1];
  }
  throw new Error("Cannot infer COS prefix from template trainFiles");
}

function newCosKey(prefix, filename) {
  return `${prefix}/train/local--${randomUUID().replaceAll("-", "")}/${filename}`;
}

function contentTypeForTrainFile(name) {
  if (name.endsWith(".zip")) return "application/x-zip-compressed";
  if (name.endsWith(".sh")) return "text/x-shellscript";
  if (name.endsWith(".py")) return "text/x-python";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "";
  return "";
}

async function getFederationToken(cookieHeader) {
  const token = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/get_federation_token/");
  for (const key of ["id", "key", "Token"]) {
    if (!token?.[key]) throw new Error(`Federation token missing ${key}`);
  }
  return token;
}

function putObject(cos, params) {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function uploadToCos(cookieHeader, localPath, key, contentType) {
  const token = await getFederationToken(cookieHeader);
  const s = await stat(localPath);
  const cos = new COS({
    SecretId: token.id,
    SecretKey: token.key,
    SecurityToken: token.Token,
  });
  await putObject(cos, {
    Bucket: BUCKET,
    Region: REGION,
    Key: key,
    Body: createReadStream(localPath),
    ContentLength: s.size,
    ContentType: contentType,
  });
  return { key, bytes: s.size };
}

export function replaceTrainFiles(templateFiles, uploaded, options = {}) {
  const byName = new Map(uploaded.map((file) => [file.name, file]));
  const next = [];
  const matchedNames = new Set();
  for (const file of templateFiles || []) {
    if (byName.has(file.name)) {
      next.push(byName.get(file.name));
      matchedNames.add(file.name);
    } else {
      next.push(file);
    }
  }
  const missing = uploaded.filter((file) => !matchedNames.has(file.name));
  if (missing.length && !options.allowAddFile) {
    throw new Error(`Template trainFiles does not contain required file: ${missing.map((file) => file.name).join(", ")}`);
  }
  if (options.allowAddFile) {
    for (const file of missing) next.push(file);
  }
  return next;
}

function buildTaskPayload(templateData, job, uploadedTrainFiles, options = {}) {
  return {
    ...templateData,
    name: job.name,
    description: job.description || "",
    trainFiles: replaceTrainFiles(templateData.trainFiles || [], uploadedTrainFiles, options),
  };
}

function safeResult(result) {
  return JSON.parse(JSON.stringify(result, (key, value) => {
    if (/cookie|token|secret|credential|authorization|signature/i.test(key)) return "<redacted>";
    return value;
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const bundleDir = path.resolve(required(args.bundle, "Missing --bundle"));
  const defaultOut = path.join(DEFAULT_SUBMIT_LIVE_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
  const outDir = resolveTaijiOutputDir(args.out || defaultOut);
  const { manifest, codeZip, config, runSh, genericFiles } = await loadBundle(bundleDir);
  const templateJobUrl = args.templateJobUrl || manifest.templateJobUrl;
  const templateJobInternalId = args.templateJobInternalId || inferInternalId(templateJobUrl);
  required(templateJobInternalId, "Missing --template-job-internal-id, and it could not be inferred from template URL");
  const job = {
    name: args.name || manifest.job?.name,
    description: args.description ?? manifest.job?.description ?? "",
  };
  required(job.name, "Missing --name and bundle manifest has no job.name");

  const [zipMeta, configMeta, runShMeta, genericFileMetas] = await Promise.all([
    codeZip ? fileMeta(codeZip) : null,
    config ? fileMeta(config) : null,
    runSh ? fileMeta(runSh) : null,
    Promise.all(genericFiles.map(async (file) => ({ ...file, ...(await fileMeta(file.path)) }))),
  ]);
  const plan = {
    mode: args.execute ? "execute" : "dry-run",
    templateJobUrl,
    templateJobInternalId,
    runAfterSubmit: Boolean(args.run || manifest.runAfterSubmit),
    allowAddFile: Boolean(args.allowAddFile),
    job,
    files: {
      ...(codeZip ? { codeZip: { path: codeZip, ...zipMeta } } : {}),
      ...(config ? { config: { path: config, ...configMeta } } : {}),
      ...(runSh ? { runSh: { path: runSh, ...runShMeta } } : {}),
      ...(genericFileMetas.length ? { genericFiles: genericFileMetas } : {}),
    },
  };

  if (args.execute && !args.yes) throw new Error("--execute requires --yes");
  if (!args.cookieFile) {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(`Wrote dry-run plan without network: ${path.join(outDir, "plan.json")}`);
    return;
  }

  const cookieHeader = extractCookieHeader(await readFile(args.cookieFile, "utf8"));
  const template = await fetchJson(cookieHeader, `/taskmanagement/api/v1/webtasks/external/task/${templateJobInternalId}`);
  const templateData = template.data;
  if (!templateData?.trainFiles) throw new Error("Template detail response has no data.trainFiles");
  const cosPrefix = inferCosPrefix(templateData);
  const codeKey = codeZip ? newCosKey(cosPrefix, zipMeta.basename) : null;
  const configKey = config ? newCosKey(cosPrefix, configMeta.basename) : null;
  const uploadedTrainFiles = [
    ...(codeZip ? [{ name: "code.zip", path: codeKey, mtime: formatTaijiTime(), size: zipMeta.bytes }] : []),
    ...(config ? [{ name: "config.yaml", path: configKey, mtime: formatTaijiTime(), size: configMeta.bytes }] : []),
    ...(runSh
      ? [{ name: "run.sh", path: newCosKey(cosPrefix, runShMeta.basename), mtime: formatTaijiTime(), size: runShMeta.bytes }]
      : []),
    ...genericFileMetas.map((file) => ({
      name: file.name,
      path: newCosKey(cosPrefix, file.name),
      mtime: formatTaijiTime(),
      size: file.bytes,
    })),
  ];
  const taskPayload = buildTaskPayload(templateData, job, uploadedTrainFiles, { allowAddFile: args.allowAddFile });
  const networkPlan = { ...plan, cosPrefix, uploadedTrainFiles, taskPayloadPreview: safeResult(taskPayload) };

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(networkPlan, null, 2)}\n`, "utf8");

  if (!args.execute) {
    console.log(`Wrote dry-run plan: ${path.join(outDir, "plan.json")}`);
    console.log("No upload/create/start happened. Add --execute --yes to run live.");
    return;
  }

  const uploadResults = [];
  if (codeZip) uploadResults.push(await uploadToCos(cookieHeader, codeZip, codeKey, "application/x-zip-compressed"));
  if (config) uploadResults.push(await uploadToCos(cookieHeader, config, configKey, ""));
  if (runSh) {
    const runShFile = uploadedTrainFiles.find((file) => file.name === "run.sh");
    uploadResults.push(await uploadToCos(cookieHeader, runSh, runShFile.path, "text/x-shellscript"));
  }
  for (const file of genericFileMetas) {
    const uploadedFile = uploadedTrainFiles.find((candidate) => candidate.name === file.name);
    uploadResults.push(await uploadToCos(cookieHeader, file.path, uploadedFile.path, contentTypeForTrainFile(file.name)));
  }
  const created = await fetchJson(cookieHeader, "/taskmanagement/api/v1/webtasks/external/task", {
    method: "POST",
    body: taskPayload,
  });
  const taskId = created?.data?.taskId;
  if (!taskId) throw new Error("Created task response has no data.taskId");

  let startResponse = null;
  if (args.run || manifest.runAfterSubmit) {
    startResponse = await fetchJson(cookieHeader, `/taskmanagement/api/v1/webtasks/${taskId}/start`, {
      method: "POST",
      body: {},
    });
  }
  const instances = await fetchJson(cookieHeader, "/taskmanagement/api/v1/instances/list", {
    method: "POST",
    body: { desc: true, orderBy: "create", task_id: taskId, page: 0, size: 10 },
  });

  const result = {
    ...networkPlan,
    uploadResults,
    created: safeResult(created),
    startResponse: safeResult(startResponse),
    instances: safeResult(instances),
    jobUrl: `${TAIJI_ORIGIN}/training`,
    taskId,
  };
  await writeFile(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Created Taiji job: ${taskId}`);
  console.log(`Wrote live result: ${path.join(outDir, "result.json")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
