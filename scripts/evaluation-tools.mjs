#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const DEFAULT_OUT_ROOT = "taiji-output";
const TAIJI_ORIGIN = "https://taiji.algo.qq.com";
const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";

function usage() {
  return `Usage:
  taac2026 model list --cookie-file <file> [--search <text>] [--json] [--out <file>]
  taac2026 eval create (--model-id <id> --creator <ams_id> | --model-name <name> --cookie-file <file>) (--submit-name <name> | --file-dir <dir>) [--name <eval-name>] [--execute --yes]
  taac2026 eval stop --task-id <id> --cookie-file <file> [--execute --yes]

Dry-run is the default for create and stop. Live create uploads local inference files and creates one evaluation task.
By default --file-dir includes only dataset.py, dense_transform.py, eda.py, infer.py, and model.py when present.
--submit-name resolves submits/*/<name>/inference_code and uploads all direct files in that curated package directory.`;
}

function parseArgs(argv) {
  const positional = [];
  const args = { positional };
  const booleanFlags = new Set(["json", "execute", "yes", "includeAllFiles"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
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

function extractCookieHeader(fileContent) {
  const text = fileContent.trim();
  const headerLine = text.match(/^cookie:\s*(.+)$/im);
  if (headerLine) return headerLine[1].trim();
  const curlHeader = text.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (curlHeader) return curlHeader[2].trim();
  return text.replace(/^cookie:\s*/i, "").trim();
}

function taijiHeaders(cookieHeader, refererPath = "/evaluation") {
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
  return body;
}

function formatTaijiTime(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const bj = new Date(utc + 8 * 60 * 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

function inferCreatorFromModel(model) {
  const match = String(model?.task_id ?? "").match(/angel_training_(ams_\d+_\d+)_/);
  return match?.[1] ?? "";
}

function inferFileCosKey(creator, fileName, id = randomUUID().replaceAll("-", "")) {
  return `2026_AMS_ALGO_Competition/${creator}/infer/local--${id}/${fileName}`;
}

async function directFilesFromDir(fileDir, options = {}) {
  const dir = path.resolve(required(fileDir, "Missing --file-dir"));
  const entries = await readdir(dir, { withFileTypes: true });
  const defaultNames = new Set(["dataset.py", "dense_transform.py", "eda.py", "infer.py", "model.py"]);
  const files = [];
  const selected = entries
    .filter((item) => item.isFile())
    .filter((item) => options.includeAllFiles || defaultNames.has(item.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of selected) {
    const filePath = path.join(dir, entry.name);
    const s = await stat(filePath);
    files.push({ name: entry.name, path: filePath, bytes: s.size });
  }
  if (!files.length) throw new Error(`No direct files found in ${dir}`);
  return files;
}

async function findInferenceCodeDirs(submitsRoot) {
  const root = path.resolve(submitsRoot ?? "submits");
  const matches = [];

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Submits root not found: ${root}`);
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === "inference_code") {
        matches.push({
          submitName: path.basename(path.dirname(fullPath)),
          path: fullPath,
        });
        continue;
      }
      if (depth < 4) await walk(fullPath, depth + 1);
    }
  }

  await walk(root, 0);
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

async function resolveInferenceSource(options) {
  if (options.submitName && options.fileDir) {
    throw new Error("Use only one of --submit-name or --file-dir");
  }
  if (!options.submitName) {
    return {
      fileDir: options.fileDir,
      includeAllFiles: options.includeAllFiles,
      source: options.fileDir ? { type: "file-dir", path: path.resolve(options.fileDir) } : null,
    };
  }

  const candidates = await findInferenceCodeDirs(options.submitsRoot);
  const exactMatches = candidates.filter((candidate) => candidate.submitName === options.submitName);
  const fuzzyMatches = exactMatches.length
    ? exactMatches
    : candidates.filter((candidate) => candidate.submitName.includes(options.submitName));
  if (!fuzzyMatches.length) {
    throw new Error(`No local submit package inference_code found for --submit-name ${options.submitName}`);
  }
  if (fuzzyMatches.length > 1) {
    const preview = fuzzyMatches.map((candidate) => `${candidate.submitName}: ${candidate.path}`).join("\n");
    throw new Error(`Ambiguous --submit-name ${options.submitName}. Candidates:\n${preview}`);
  }
  const match = fuzzyMatches[0];
  return {
    fileDir: match.path,
    includeAllFiles: true,
    source: { type: "submit-package", submitName: match.submitName, path: match.path },
  };
}

function contentTypeForInferFile(name) {
  if (name.endsWith(".py")) return "text/x-python";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".zip")) return "application/x-zip-compressed";
  return "";
}

async function getFederationToken(cookieHeader) {
  const token = await fetchTaijiJson(cookieHeader, "/aide/api/evaluation_tasks/get_federation_token/");
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

export async function listModels(options) {
  const cookieHeader = extractCookieHeader(await readFile(required(options.cookieFile, "Missing --cookie-file"), "utf8"));
  const page = Number(options.page ?? 1);
  const pageSize = Number(options.pageSize ?? 20);
  const search = encodeURIComponent(options.search ?? "");
  const body = await fetchTaijiJson(cookieHeader, `/aide/api/external/mould/?page=${page}&page_size=${pageSize}&search=${search}`, {
    refererPath: "/model",
  });
  return {
    page,
    pageSize,
    search: options.search ?? "",
    count: body.count,
    next: body.next,
    previous: body.previous,
    results: body.results ?? [],
  };
}

async function findModel(cookieHeader, options) {
  if (!cookieHeader) return null;
  const search = options.modelName ?? options.modelSearch ?? "";
  let page = 1;
  for (;;) {
    const body = await fetchTaijiJson(cookieHeader, `/aide/api/external/mould/?page=${page}&page_size=20&search=${encodeURIComponent(search)}`, {
      refererPath: "/model",
    });
    const models = body.results ?? [];
    const match = models.find((model) => String(model.id) === String(options.modelId)) ??
      models.find((model) => options.modelName && model.name === options.modelName) ??
      models.find((model) => options.modelSearch && String(model.name ?? "").includes(options.modelSearch));
    if (match) return match;
    if (!body.next || page >= 20) return null;
    page += 1;
  }
}

async function buildEvaluationFiles(options, creator, inferenceSource) {
  if (!inferenceSource.fileDir) return null;
  const localFiles = await directFilesFromDir(inferenceSource.fileDir, {
    ...options,
    includeAllFiles: inferenceSource.includeAllFiles,
  });
  const mtime = formatTaijiTime(options.now ?? new Date());
  return localFiles.map((file) => ({
    name: file.name,
    localPath: file.path,
    path: inferFileCosKey(creator, file.name),
    mtime,
    size: file.bytes,
  }));
}

async function templateFiles(cookieHeader) {
  const body = await fetchTaijiJson(cookieHeader, "/aide/api/evaluation_tasks/get_template/");
  return body.inferFiles ?? [];
}

export async function createEvaluation(options) {
  const cookieHeader = options.cookieFile ? extractCookieHeader(await readFile(options.cookieFile, "utf8")) : "";
  const inferenceSource = await resolveInferenceSource(options);
  const needsModelLookup = !options.modelId || !options.creator || options.modelName || options.modelSearch;
  const model = needsModelLookup ? await findModel(cookieHeader, options) : null;
  const modelId = Number(required(options.modelId ?? model?.id, "Missing --model-id, or no matching --model-name / --model-search was found"));
  const creator = required(options.creator ?? inferCreatorFromModel(model), "Missing --creator, and it could not be inferred from the selected model");
  const files = await buildEvaluationFiles(options, creator, inferenceSource) ?? (cookieHeader ? await templateFiles(cookieHeader) : null);
  if (!files?.length) throw new Error("Missing --submit-name / --file-dir, or use --cookie-file to fetch evaluation template files");
  const name = options.name ?? `${model?.name ?? `model_${modelId}`}_eval_${Date.now()}`;
  const body = {
    mould_id: modelId,
    name,
    image_name: options.imageName ?? "",
    creator,
    files: files.map((file) => ({ name: file.name, path: file.path, mtime: file.mtime, size: file.size })),
  };
  const result = {
    mode: options.execute ? "execute" : "dry-run",
    model: model ? { id: model.id, name: model.name, desc: model.desc, task_int_id: model.task_int_id } : null,
    inferenceSource: inferenceSource.source,
    endpoint: "/aide/api/evaluation_tasks/",
    body,
    localFiles: files.filter((file) => file.localPath).map((file) => ({ name: file.name, path: file.localPath, size: file.size })),
    uploadResults: [],
    response: null,
  };

  if (!options.execute) return result;
  if (!options.yes) throw new Error("--execute requires --yes");
  const liveCookieHeader = required(cookieHeader, "--execute requires --cookie-file");
  const uploadFile = options.uploadFile ?? uploadToCos;
  for (const file of files.filter((item) => item.localPath)) {
    result.uploadResults.push(await uploadFile(liveCookieHeader, file.localPath, file.path, contentTypeForInferFile(file.name)));
  }
  result.response = await fetchTaijiJson(liveCookieHeader, "/aide/api/evaluation_tasks/", {
    method: "POST",
    body,
    refererPath: "/evaluation",
  });
  return result;
}

export async function listEvaluations(options) {
  const cookieHeader = extractCookieHeader(await readFile(required(options.cookieFile, "Missing --cookie-file"), "utf8"));
  const page = Number(options.page ?? 1);
  const pageSize = Number(options.pageSize ?? 20);
  const body = await fetchTaijiJson(cookieHeader, `/aide/api/evaluation_tasks/?page=${page}&page_size=${pageSize}`, {
    refererPath: "/evaluation",
  });
  return { page, pageSize, count: body.count, next: body.next, previous: body.previous, results: body.results ?? [] };
}

export async function stopEvaluation(options) {
  const taskId = Number(required(options.taskId, "Missing --task-id"));
  const result = {
    mode: options.execute ? "execute" : "dry-run",
    endpoint: "/aide/api/evaluation_tasks/stop_task/",
    body: { task_id: taskId },
    response: null,
  };
  if (!options.execute) return result;
  if (!options.yes) throw new Error("--execute requires --yes");
  const cookieHeader = extractCookieHeader(await readFile(required(options.cookieFile, "--execute requires --cookie-file"), "utf8"));
  result.response = await fetchTaijiJson(cookieHeader, "/aide/api/evaluation_tasks/stop_task/", {
    method: "POST",
    body: result.body,
    refererPath: "/evaluation",
  });
  return result;
}

async function writeResult(result, args, defaultName) {
  if (args.out) {
    const outPath = resolveOutputPath(args.out, "reports");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outPath}`);
    return;
  }
  console.log(args.json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.positional.length) {
    console.log(usage());
    return;
  }
  const [domain, action] = args.positional;
  if (domain === "model" && action === "list") {
    await writeResult(await listModels(args), { ...args, json: args.json ?? true }, "model-list.json");
    return;
  }
  if ((domain === "eval" || domain === "evaluation") && action === "create") {
    await writeResult(await createEvaluation(args), { ...args, json: args.json ?? true }, "eval-create.json");
    return;
  }
  if ((domain === "eval" || domain === "evaluation") && action === "list") {
    await writeResult(await listEvaluations(args), { ...args, json: args.json ?? true }, "eval-list.json");
    return;
  }
  if ((domain === "eval" || domain === "evaluation") && action === "stop") {
    await writeResult(await stopEvaluation(args), { ...args, json: args.json ?? true }, "eval-stop.json");
    return;
  }
  throw new Error(`Unsupported evaluation command: ${args.positional.join(" ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
