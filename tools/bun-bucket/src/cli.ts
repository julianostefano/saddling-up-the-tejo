import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_LINK_SPEED_MBPS,
  DEFAULT_MULTIPART_THRESHOLD,
  DEFAULT_PART_SIZE,
  DEFAULT_QUEUE_SIZE,
  DEFAULT_RETRY,
  formatBandwidth,
  formatBytes,
  formatDurationMs,
  formatEta,
  formatSpeed,
  maskProxyUrl,
  normalizeS3Target,
  parseByteSize,
  renderProgressBar,
} from "./format.ts";
import {
  formatMissingConfigError,
  resolveAndApplyProxy,
  resolveAndApplyTls,
  resolveTargetEndpointOrigin,
  validateAndResolveAuth,
} from "./env.ts";
import {
  executeBatchDownload,
  executeS3Download,
  resolveDownloadTargets,
} from "./downloader.ts";
import {
  startIsolatedBatchDownloadSession,
  startIsolatedBatchUploadSession,
  startIsolatedDownloadSession,
  startIsolatedUploadSession,
} from "./session-runner.ts";
import { hasGlobPattern, resolveUploadTargets } from "./shell.ts";
import { executeBatchUpload, executeS3Upload } from "./uploader.ts";
import type {
  BatchUploadReport,
  CliOptions,
  OverwriteDecision,
  OverwritePromptInfo,
  ProgressSnapshot,
  ResolvedDownloadTarget,
  ResolvedUploadTarget,
  S3Acl,
  S3StorageClass,
  TransferOperation,
  UploadCallbacks,
  UploadReport,
  VerifyMode,
} from "./types.ts";

export const APP_VERSION = "1.1.0";

const VALID_VERIFY_MODES = new Set<VerifyMode>(["full", "stat", "none"]);
const VALID_ACLS = new Set<S3Acl>([
  "private",
  "public-read",
  "public-read-write",
  "aws-exec-read",
  "authenticated-read",
  "bucket-owner-read",
  "bucket-owner-full-control",
  "log-delivery-write",
]);
const VALID_STORAGE_CLASSES = new Set<S3StorageClass>([
  "STANDARD",
  "REDUCED_REDUNDANCY",
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER",
  "DEEP_ARCHIVE",
  "OUTPOSTS",
  "GLACIER_IR",
  "SNOW",
  "EXPRESS_ONEZONE",
]);

export function getHelpText(): string {
  return `
Bun Bucket v${APP_VERSION} — Native Bun S3 Uploader & Downloader

Usage (Upload: Local -> S3):
  bun-bucket [upload] <file-dir-or-glob> <bucket> [key-or-prefix] [options]
  bun-bucket [upload] <file-dir-or-glob> s3://<bucket>/<prefix> [options]
  bun-bucket [upload] --file <path|dir|glob> --bucket <name> [options]

Usage (Download: S3 -> Local):
  bun-bucket download <s3://bucket/key-or-glob> [local-dest] [options]
  bun-bucket download <bucket>/<key-or-glob> [local-dest] [options]
  bun-bucket download <bucket> <key-or-glob> [local-dest] [options]
  bun-bucket <s3://bucket/key-or-glob> [local-dest] [options]
  bun-bucket --download --bucket <name> --key <key-or-glob> [--output <dir-or-file>]

Interactive Terminal UI:
  bun-bucket --tui

Direction & Path Options:
  -u, --upload                   Force upload mode (Local -> S3, default when source is local)
  -d, --download                 Force download mode (S3 -> Local, auto-detected for s3:// source)
  -o, --output <dir-or-file>     Local destination directory or file path for downloads (default: .)
  -f, --file <path|dir|glob>     Local file, directory (recursive), or wildcard pattern (repeatable)
  -b, --bucket <name>            S3 bucket (or bucket/prefix; fallback: S3_BUCKET / AWS_BUCKET)
      --key, --prefix <pattern>  Object key, prefix, or wildcard glob (*, ?, [...], {...})
      --dot, --include-hidden    Include hidden dotfiles/keys when scanning directories or wildcards
  -e, --endpoint <url>           S3-compatible endpoint URL (fallback: S3_ENDPOINT / AWS_ENDPOINT)
  -r, --region <region>          AWS region (fallback: S3_REGION / AWS_REGION, default: us-east-1)
      --virtual-hosted-style     Use virtual hosted-style S3 URLs
      --acl <acl>                Object ACL (private, public-read, bucket-owner-full-control, ...)
      --storage-class <class>    S3 storage class (STANDARD, STANDARD_IA, GLACIER, ...)
      --request-payer            Set x-amz-request-payer for requester-pays buckets

Overwrite Protection Options:
  -y, --yes, --overwrite         Overwrite existing S3 objects or local files without prompting
      --skip-existing, --no-overwrite
                                 Skip existing S3 objects or local files without overwriting

Multipart & Transfer Options:
      --part-size <size>         Multipart chunk size, 5MiB..5GiB (default: 5MiB)
      --multipart-threshold <s>  Size threshold to enable multipart upload (default: 5MiB)
      --queue-size <n>           Concurrent multipart uploads, 1..255 (default: 4)
      --retry <n>                Retry attempts per request, 0..255 (default: 3)
      --link-mbps <n>            Link capacity in Mbps for bandwidth % display (default: 1000)

Integrity, Proxy & TLS Options:
      --verify <mode>            Verification mode: full | stat | none (default: full)
      --proxy <url>              HTTP/HTTPS proxy URL (overrides HTTP_PROXY / HTTPS_PROXY)
  -k, --insecure, --allow-invalid-certs
                                 Allow invalid/self-signed TLS certificates (NODE_TLS_REJECT_UNAUTHORIZED=0)
      --strict-tls               Enforce strict TLS certificate verification

Execution & Output Options:
      --isolated                 Run transfer inside an isolated Bun.ModuleGraph session
      --tui                      Launch interactive Terminal UI
      --dry-run                  Analyze targets, validate env/proxy/TLS without transferring data
      --json                     Print final structured JSON report
  -h, --help                     Show this help message
  -v, --version                  Show version

Environment Variables:
  Credentials: S3_ACCESS_KEY_ID / AWS_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY / AWS_SECRET_ACCESS_KEY
               S3_SESSION_TOKEN / AWS_SESSION_TOKEN, S3_REGION / AWS_REGION
               S3_ENDPOINT / AWS_ENDPOINT, S3_BUCKET / AWS_BUCKET
  Proxy:       HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, NO_PROXY (case-insensitive)
  TLS:         NODE_TLS_REJECT_UNAUTHORIZED=0, S3_TLS_INSECURE=1, SSL_CERT_FILE, SSL_CERT_DIR
`.trim();
}

function looksLikeLocalDestPath(val: string): boolean {
  if (
    val === "." ||
    val === ".." ||
    val.startsWith("./") ||
    val.startsWith("../") ||
    val.startsWith(".\\") ||
    val.startsWith("..\\")
  ) {
    return true;
  }
  if (val.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(val)) {
    return true;
  }
  return existsSync(val);
}

/**
 * Parses CLI arguments into structured options without external dependencies.
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    operation: "upload",
    filePaths: [],
    partSize: DEFAULT_PART_SIZE,
    multipartThreshold: DEFAULT_MULTIPART_THRESHOLD,
    queueSize: DEFAULT_QUEUE_SIZE,
    retry: DEFAULT_RETRY,
    verifyMode: "full",
    linkSpeedMbps: DEFAULT_LINK_SPEED_MBPS,
    overwritePolicy: "ask",
    includeHidden: false,
    isolated: false,
    tui: false,
    json: false,
    dryRun: false,
    help: false,
    version: false,
  };

  let explicitOperation: TransferOperation | undefined;
  let explicitOverwrite = false;
  let explicitSkip = false;
  const positionals: string[] = [];

  const readValue = (idx: number, flag: string, inlineVal?: string): { value: string; nextIdx: number } => {
    if (inlineVal !== undefined) return { value: inlineVal, nextIdx: idx };
    const next = argv[idx + 1];
    if (next === undefined || next.startsWith("-")) {
      throw new Error(`Flag "${flag}" requires a value.`);
    }
    return { value: next, nextIdx: idx + 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!;
    if (!raw.startsWith("-") || raw === "-") {
      positionals.push(raw);
      continue;
    }

    const eqIdx = raw.indexOf("=");
    const flag = eqIdx === -1 ? raw : raw.slice(0, eqIdx);
    const inlineVal = eqIdx === -1 ? undefined : raw.slice(eqIdx + 1);

    switch (flag) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      case "-u":
      case "--upload":
        explicitOperation = "upload";
        options.operation = "upload";
        break;
      case "-d":
      case "--download":
        explicitOperation = "download";
        options.operation = "download";
        break;
      case "--tui":
        options.tui = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--isolated":
        options.isolated = true;
        break;
      case "--virtual-hosted-style":
        options.virtualHostedStyle = true;
        break;
      case "--request-payer":
        options.requestPayer = true;
        break;
      case "--dot":
      case "--include-hidden":
        options.includeHidden = true;
        break;
      case "-y":
      case "--yes":
      case "--overwrite":
        explicitOverwrite = true;
        options.overwritePolicy = "overwrite";
        break;
      case "--skip-existing":
      case "--no-overwrite":
        explicitSkip = true;
        options.overwritePolicy = "skip";
        break;
      case "-k":
      case "--insecure":
      case "--allow-invalid-certs":
        options.insecure = true;
        break;
      case "--strict-tls":
        options.strictTls = true;
        break;
      case "-f":
      case "--file": {
        const res = readValue(i, flag, inlineVal);
        options.filePaths!.push(res.value);
        if (!options.filePath) options.filePath = res.value;
        i = res.nextIdx;
        break;
      }
      case "-o":
      case "--output": {
        const res = readValue(i, flag, inlineVal);
        options.outputPath = res.value;
        i = res.nextIdx;
        break;
      }
      case "-b":
      case "--bucket": {
        const res = readValue(i, flag, inlineVal);
        const parsed = normalizeS3Target(res.value);
        options.bucket = parsed.bucket;
        if (parsed.key && !options.key) {
          options.key = parsed.key;
        }
        i = res.nextIdx;
        break;
      }
      case "--key":
      case "--prefix": {
        const res = readValue(i, flag, inlineVal);
        options.key = res.value;
        i = res.nextIdx;
        break;
      }
      case "-e":
      case "--endpoint": {
        const res = readValue(i, flag, inlineVal);
        options.endpoint = res.value;
        i = res.nextIdx;
        break;
      }
      case "-r":
      case "--region": {
        const res = readValue(i, flag, inlineVal);
        options.region = res.value;
        i = res.nextIdx;
        break;
      }
      case "--part-size": {
        const res = readValue(i, flag, inlineVal);
        options.partSize = parseByteSize(res.value);
        i = res.nextIdx;
        break;
      }
      case "--multipart-threshold": {
        const res = readValue(i, flag, inlineVal);
        options.multipartThreshold = parseByteSize(res.value);
        i = res.nextIdx;
        break;
      }
      case "--queue-size": {
        const res = readValue(i, flag, inlineVal);
        const parsed = Number(res.value);
        if (!Number.isInteger(parsed)) {
          throw new Error(`Invalid --queue-size "${res.value}". Expected an integer.`);
        }
        options.queueSize = parsed;
        i = res.nextIdx;
        break;
      }
      case "--retry": {
        const res = readValue(i, flag, inlineVal);
        const parsed = Number(res.value);
        if (!Number.isInteger(parsed)) {
          throw new Error(`Invalid --retry "${res.value}". Expected an integer.`);
        }
        options.retry = parsed;
        i = res.nextIdx;
        break;
      }
      case "--link-mbps": {
        const res = readValue(i, flag, inlineVal);
        const parsed = Number(res.value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid --link-mbps "${res.value}". Expected a positive number.`);
        }
        options.linkSpeedMbps = parsed;
        i = res.nextIdx;
        break;
      }
      case "--verify": {
        const res = readValue(i, flag, inlineVal);
        const mode = res.value.toLowerCase() as VerifyMode;
        if (!VALID_VERIFY_MODES.has(mode)) {
          throw new Error(`Invalid --verify mode "${res.value}". Allowed values: full, stat, none.`);
        }
        options.verifyMode = mode;
        i = res.nextIdx;
        break;
      }
      case "--proxy": {
        const res = readValue(i, flag, inlineVal);
        options.proxy = res.value;
        i = res.nextIdx;
        break;
      }
      case "--acl": {
        const res = readValue(i, flag, inlineVal);
        const acl = res.value as S3Acl;
        if (!VALID_ACLS.has(acl)) {
          throw new Error(`Invalid --acl "${res.value}".`);
        }
        options.acl = acl;
        i = res.nextIdx;
        break;
      }
      case "--storage-class": {
        const res = readValue(i, flag, inlineVal);
        const sc = res.value as S3StorageClass;
        if (!VALID_STORAGE_CLASSES.has(sc)) {
          throw new Error(`Invalid --storage-class "${res.value}".`);
        }
        options.storageClass = sc;
        i = res.nextIdx;
        break;
      }
      default:
        throw new Error(`Unknown option "${flag}". Run with --help to see supported flags.`);
    }
  }

  if (explicitOverwrite && explicitSkip) {
    throw new Error("Cannot combine --yes/--overwrite with --skip-existing/--no-overwrite.");
  }

  // Handle optional `upload` or `download` subcommand as first positional argument
  if (
    !explicitOperation &&
    positionals.length > 0 &&
    (positionals[0] === "download" || positionals[0] === "upload") &&
    !existsSync(positionals[0]!)
  ) {
    explicitOperation = positionals.shift() as TransferOperation;
    options.operation = explicitOperation;
  }

  // Auto-detect download when the first positional source begins with `s3://`
  if (!explicitOperation && positionals.length > 0 && /^s3:\/\//i.test(positionals[0]!)) {
    options.operation = "download";
  }

  const applyTargetString = (targetStr: string) => {
    const parsed = normalizeS3Target(targetStr);
    options.bucket = parsed.bucket;
    if (parsed.key) {
      if (!options.key) {
        options.key = parsed.key;
      } else {
        options.key = `${parsed.key.replace(/\/+$/, "")}/${options.key.replace(/^\/+/, "")}`;
      }
    }
  };

  if (options.operation === "download") {
    if (positionals.length > 0) {
      if (!options.bucket) {
        const first = positionals.shift()!;
        if (hasGlobPattern(first) && !/^s3:\/\//i.test(first) && !first.includes("/")) {
          // Bare glob such as "*.DMP" uses configured S3_BUCKET / AWS_BUCKET
          options.key = options.key ?? first;
        } else {
          applyTargetString(first);
          if (first.trim().endsWith("/") && !options.key) {
            options.key = "*";
          }
        }
      }

      if (positionals.length > 0 && !options.key) {
        const next = positionals[0]!;
        if (positionals.length >= 2 || (!looksLikeLocalDestPath(next) && next !== options.outputPath)) {
          options.key = positionals.shift();
        }
      }

      if (positionals.length > 0 && !options.outputPath) {
        options.outputPath = positionals.shift();
      }
    }

    if (positionals.length > 0) {
      throw new Error(`Unexpected extra positional arguments: ${positionals.join(" ")}`);
    }

    return options;
  }

  // Assign upload positional arguments, including shell-expanded wildcards (<file1> <file2> ... <target>)
  // and targets provided without an explicit `s3://` prefix.
  if (positionals.length > 0 && options.filePaths!.length === 0) {
    if (positionals.length === 1) {
      const only = positionals.shift()!;
      options.filePaths!.push(only);
      options.filePath = only;
    } else if (positionals.length === 2) {
      if (!options.bucket) {
        const first = positionals.shift()!;
        options.filePaths!.push(first);
        options.filePath = first;
        applyTargetString(positionals.shift()!);
      } else {
        const second = positionals[1]!;
        if (existsSync(second) || hasGlobPattern(second)) {
          options.filePaths!.push(...positionals);
          options.filePath = positionals[0];
          positionals.length = 0;
        } else {
          const first = positionals.shift()!;
          options.filePaths!.push(first);
          options.filePath = first;
        }
      }
    } else if (options.bucket) {
      const last = positionals[positionals.length - 1]!;
      if (!existsSync(last) && !hasGlobPattern(last) && !options.key) {
        const fileArgs = positionals.slice(0, -1);
        options.filePaths!.push(...fileArgs);
        options.filePath = fileArgs[0];
        options.key = last;
      } else {
        options.filePaths!.push(...positionals);
        options.filePath = positionals[0];
      }
      positionals.length = 0;
    } else {
      const last = positionals[positionals.length - 1]!;
      const secondLast = positionals[positionals.length - 2]!;
      const isMultiFileWithLastTarget =
        /^s3:\/\//i.test(last) ||
        existsSync(secondLast) ||
        hasGlobPattern(secondLast) ||
        positionals.length >= 4;

      if (isMultiFileWithLastTarget) {
        const fileArgs = positionals.slice(0, -1);
        options.filePaths!.push(...fileArgs);
        options.filePath = fileArgs[0];
        applyTargetString(last);
        positionals.length = 0;
      } else {
        const first = positionals.shift()!;
        options.filePaths!.push(first);
        options.filePath = first;
        applyTargetString(positionals.shift()!);
      }
    }
  }

  if (positionals.length > 0 && !options.bucket) {
    applyTargetString(positionals.shift()!);
  }
  if (positionals.length > 0 && !options.key) {
    options.key = positionals.shift();
  }
  if (positionals.length > 0) {
    throw new Error(`Unexpected extra positional arguments: ${positionals.join(" ")}`);
  }

  return options;
}

function formatProgressLine(snap: ProgressSnapshot): string {
  const phaseLabel =
    snap.phase === "hashing"
      ? "SHA-256  "
      : snap.phase === "uploading"
        ? "UPLOAD   "
        : snap.phase === "downloading"
          ? "DOWNLOAD "
          : snap.phase === "verifying"
            ? "VERIFY   "
            : snap.phase.toUpperCase().padEnd(9, " ");

  const bar = renderProgressBar(snap.percent, 22);
  const transferred = `${formatBytes(snap.bytesProcessed)}/${formatBytes(snap.totalBytes)}`;
  const speed = formatSpeed(snap.speedBytesPerSec);
  const bw = `${formatBandwidth(snap.bandwidthMbps)} (${snap.bandwidthUtilizationPct.toFixed(1)}%)`;
  const eta = `ETA ${formatEta(snap.etaSeconds)}`;
  const parts =
    snap.totalParts && snap.totalParts > 1 && snap.currentPart !== undefined
      ? ` Part ${snap.currentPart}/${snap.totalParts}`
      : "";

  return `${phaseLabel} ${bar} ${transferred}${parts} | ${speed} | BW ${bw} | ${eta}`;
}

async function promptCliOverwrite(info: OverwritePromptInfo): Promise<OverwriteDecision> {
  const remoteMetaParts: string[] = [];
  if (info.remoteSizeBytes !== undefined) {
    remoteMetaParts.push(`remote size: ${formatBytes(info.remoteSizeBytes)}`);
  }
  if (info.remoteEtag) {
    remoteMetaParts.push(`ETag: ${info.remoteEtag}`);
  }
  remoteMetaParts.push(`local size: ${formatBytes(info.localSizeBytes)}`);

  if (info.direction === "download") {
    process.stdout.write(
      `\nLocal file "${info.localPath}" already exists (${remoteMetaParts.join(", ")}).\n` +
        `Overwrite local file? [y]es / [N]o (skip) / [a]ll / [s]kip all / [q]uit: `,
    );
  } else {
    process.stdout.write(
      `\nObject "s3://${info.bucket}/${info.key}" already exists (${remoteMetaParts.join(", ")}).\n` +
        `Overwrite? [y]es / [N]o (skip) / [a]ll / [s]kip all / [q]uit: `,
    );
  }

  const answer = await new Promise<string>((resolveAnswer) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const nlIdx = buf.search(/\r?\n/);
      if (nlIdx !== -1) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolveAnswer(buf.slice(0, nlIdx).trim().toLowerCase());
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });

  if (answer === "y" || answer === "yes") return "overwrite";
  if (answer === "a" || answer === "all") return "overwrite-all";
  if (answer === "s" || answer === "skip" || answer === "skip-all") return "skip-all";
  if (answer === "q" || answer === "quit" || answer === "abort") return "abort";
  return "skip";
}

function printSingleReportSummary(report: UploadReport, options: CliOptions): void {
  const isDownload = report.operation === "download";
  const verbLabel = isDownload ? "Download" : "Upload";
  console.log("");
  console.log("=== Transfer & Integrity Summary ===");
  if (report.skipped) {
    console.log("Status:           SKIPPED");
    if (isDownload && report.localPath) {
      console.log(`Source:           s3://${report.bucket}/${report.key}`);
      console.log(`Local File:       ${report.localPath}`);
    } else {
      console.log(`Object:           s3://${report.bucket}/${report.key}`);
    }
    console.log(`Reason:           ${report.skipReason ?? "Target already exists"}`);
    return;
  }

  console.log(`Status:           ${report.success ? "SUCCESS" : "FAILED"}`);
  console.log(`Operation:        ${verbLabel.toUpperCase()}`);
  console.log(`Object:           s3://${report.bucket}/${report.key}`);
  if (isDownload && report.localPath) {
    console.log(`Local File:       ${report.localPath}`);
  }
  console.log(
    `${verbLabel} Strategy:  ${report.upload.strategy.toUpperCase()} (${report.upload.partsUploaded} part(s))`,
  );
  if (!options.dryRun) {
    console.log(`${verbLabel} Duration:  ${formatDurationMs(report.upload.durationMs)}`);
    console.log(
      `${verbLabel} Speed:     avg ${formatSpeed(report.upload.avgSpeedBytesPerSec)} | peak ${formatSpeed(report.upload.peakSpeedBytesPerSec)}`,
    );
    console.log(
      `Bandwidth Used:   ${formatBandwidth(report.upload.avgBandwidthMbps)} (${report.upload.bandwidthUtilizationPct.toFixed(1)}% of ${options.linkSpeedMbps} Mbps link)`,
    );
  }
  console.log(`Local SHA-256:    ${report.checksum.sha256Hex}`);
  console.log(`Local MD5:        ${report.checksum.md5Hex}`);
  if (report.checksum.multipartEtag) {
    console.log(`Multipart ETag:   ${report.checksum.multipartEtag}`);
  }
  if (report.verification.performed) {
    console.log(
      `Remote Size:      ${formatBytes(report.verification.remoteSizeBytes ?? 0)} (${report.verification.sizeMatch ? "MATCH" : "MISMATCH"})`,
    );
    if (report.verification.remoteEtag) {
      const etagStatus =
        report.verification.etagMatch === null
          ? "PRESENT"
          : report.verification.etagMatch
            ? "MATCH"
            : "MISMATCH";
      console.log(`Remote ETag:      ${report.verification.remoteEtag} (${etagStatus})`);
    }
    if (report.verification.remoteSha256Hex && !isDownload) {
      console.log(
        `Remote SHA-256:   ${report.verification.remoteSha256Hex} (${report.verification.sha256Match ? "MATCH" : "MISMATCH"})`,
      );
    }
    if (report.verification.downloadSpeedBytesPerSec !== undefined) {
      console.log(
        `Download Speed:   ${formatSpeed(report.verification.downloadSpeedBytesPerSec)} (${formatBandwidth(report.verification.downloadBandwidthMbps ?? 0)}) [verification readback]`,
      );
    }
  } else {
    console.log(`Verification:     skipped (mode=${report.verification.mode})`);
  }
}

function printBatchReportSummary(batch: BatchUploadReport): void {
  const isDownload = batch.operation === "download";
  const countVerb = isDownload ? "downloaded" : "uploaded";
  const volLabel = isDownload ? "Downloaded Vol:" : "Uploaded Volume:";
  console.log("");
  console.log("=== Batch Transfer Summary ===");
  console.log(`Status:           ${batch.success ? "SUCCESS" : "FAILED"}`);
  console.log(`Operation:        ${isDownload ? "DOWNLOAD" : "UPLOAD"}`);
  console.log(`Bucket:           s3://${batch.bucket}`);
  console.log(
    `Files:            ${batch.totalFiles} total | ${batch.uploadedCount} ${countVerb} | ${batch.skippedCount} skipped | ${batch.failedCount} failed`,
  );
  console.log(`${volLabel.padEnd(18, " ")}${formatBytes(batch.uploadedBytes)} / ${formatBytes(batch.totalBytes)}`);
  console.log(`Total Duration:   ${formatDurationMs(batch.durationMs)}`);
  console.log(`Average Speed:    ${formatSpeed(batch.avgSpeedBytesPerSec)}`);
  console.log(`Average BW Used:  ${formatBandwidth(batch.avgBandwidthMbps)}`);
  console.log("");
  for (const r of batch.results) {
    const tag = r.skipped ? "[SKIP]" : r.success ? "[OK]  " : "[FAIL]";
    const targetDesc =
      isDownload && r.localPath
        ? `s3://${r.bucket}/${r.key} -> ${r.localPath}`
        : `s3://${r.bucket}/${r.key}`;
    const detail = r.skipped
      ? r.skipReason ?? "skipped"
      : `${formatBytes(r.fileAnalysis.sizeBytes)} | ${r.upload.strategy} | SHA-256 ${r.checksum.sha256Hex.slice(0, 12)}...`;
    console.log(`  ${tag} ${targetDesc} (${detail})`);
  }
}

/**
 * Runs the CLI upload/download workflow and returns an exit code (0 on success, 1 on failure).
 */
export async function runCli(
  argv: string[],
  hooks: { confirmOverwrite?: UploadCallbacks["confirmOverwrite"] } = {},
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    console.error(`Argument Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Run with --help for usage details.");
    return 1;
  }

  if (options.help) {
    console.log(getHelpText());
    return 0;
  }

  if (options.version) {
    console.log(`bun-bucket v${APP_VERSION} (Bun ${Bun.version})`);
    return 0;
  }

  const isDownload = options.operation === "download";
  const inputPatterns = options.filePaths?.length
    ? options.filePaths
    : options.filePath
      ? [options.filePath]
      : [];

  const missingInputs: string[] = [];
  if (!isDownload && inputPatterns.length === 0) {
    missingInputs.push("Missing input path (<file-dir-or-glob> or --file <path>).");
  }
  if (isDownload && !options.bucket && !options.key) {
    missingInputs.push(
      "Missing remote source (<s3://bucket/key-or-glob>, <bucket>/<key-or-glob>, or --key <pattern>).",
    );
  }

  const validation = validateAndResolveAuth(options);
  if (!validation.valid || !validation.auth || missingInputs.length > 0) {
    if (options.json) {
      console.error(
        JSON.stringify(
          {
            success: false,
            error: "Missing required arguments or environment variables",
            missingInputs,
            missingEnv: validation.missing,
          },
          null,
          2,
        ),
      );
    } else {
      for (const msg of missingInputs) {
        console.error(`Error: ${msg}`);
      }
      if (!validation.valid) {
        console.error(formatMissingConfigError(validation.missing));
      }
      console.error("\nRun with --help for usage information or --tui for interactive mode.");
    }
    return 1;
  }

  const auth = validation.auth;
  const targetOrigin = resolveTargetEndpointOrigin(auth);
  const proxy = resolveAndApplyProxy(targetOrigin, options.proxy);
  const tls = resolveAndApplyTls(options);

  let uploadTargets: ResolvedUploadTarget[] = [];
  let downloadTargets: ResolvedDownloadTarget[] = [];

  try {
    if (isDownload) {
      downloadTargets = await resolveDownloadTargets(
        options,
        auth,
        proxy,
        tls,
        options.key,
        options.outputPath,
      );
    } else {
      uploadTargets = await resolveUploadTargets(inputPatterns, options.key, {
        includeHidden: options.includeHidden,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.error(JSON.stringify({ success: false, error: msg }, null, 2));
    } else {
      console.error(`Input Error: ${msg}`);
    }
    return 1;
  }

  const isTty = Boolean(process.stdout.isTTY) && !options.json;
  const isInteractiveStdin = Boolean(process.stdin.isTTY) && isTty;

  if (!options.json) {
    console.log("=== Bun Bucket (Native S3 CLI) ===");
    for (const warning of validation.warnings) {
      console.log(`Warning: ${warning}`);
    }
    if (isDownload) {
      const totalDownloadBytes = downloadTargets.reduce((acc, t) => acc + (t.remoteSizeBytes ?? 0), 0);
      if (downloadTargets.length === 1) {
        console.log(`Source:    s3://${auth.bucket}/${downloadTargets[0]!.objectKey}`);
        console.log(`Target:    ${downloadTargets[0]!.localPath}`);
      } else {
        console.log(`Source:    s3://${auth.bucket}/${options.key ?? "*"}`);
        console.log(`Matched:   ${downloadTargets.length} object(s) (${formatBytes(totalDownloadBytes)})`);
        console.log(`Target:    ${resolve(options.outputPath ?? ".")}`);
      }
    } else {
      const totalBatchBytes = uploadTargets.reduce((acc, t) => acc + t.sizeBytes, 0);
      if (uploadTargets.length === 1) {
        console.log(`File:      ${uploadTargets[0]!.localPath}`);
        console.log(`Target:    s3://${auth.bucket}/${uploadTargets[0]!.objectKey}`);
      } else {
        console.log(`Inputs:    ${inputPatterns.join(", ")}`);
        console.log(`Matched:   ${uploadTargets.length} file(s) (${formatBytes(totalBatchBytes)})`);
        console.log(`Target:    s3://${auth.bucket}/${options.key ? `${options.key.replace(/^\/+|\/+$/g, "")}/` : ""}`);
      }
    }
    console.log(`Endpoint:  ${targetOrigin} (region: ${auth.region})`);
    console.log(
      `Auth:      key=${auth.sources.accessKeyId}, secret=${auth.sources.secretAccessKey}${auth.sources.sessionToken ? `, token=${auth.sources.sessionToken}` : ""}`,
    );
    if (proxy.activeProxyUrl) {
      console.log(`Proxy:     ${maskProxyUrl(proxy.activeProxyUrl)} (via ${proxy.sourceEnvVar})`);
    } else if (proxy.bypassedByNoProxy) {
      console.log(`Proxy:     direct (bypassed by NO_PROXY="${proxy.noProxy}")`);
    } else {
      console.log("Proxy:     direct (no proxy configured)");
    }
    console.log(
      `TLS:       ${tls.allowInvalidCerts ? `allow invalid certificates (${tls.source})` : "strict certificate verification"}`,
    );
    console.log(
      `Overwrite: ${options.overwritePolicy} | Verify: ${options.verifyMode}${options.isolated ? " | Execution: isolated Bun.ModuleGraph" : ""}`,
    );
    console.log("");
  }

  let lastRenderedPhase = "";
  let lastNonTtyPct = -1;

  const resetProgressState = () => {
    if (isTty && lastRenderedPhase) {
      process.stdout.write("\n");
    }
    lastRenderedPhase = "";
    lastNonTtyPct = -1;
  };

  const renderProgress = (snap: ProgressSnapshot) => {
    if (options.json) return;
    const line = formatProgressLine(snap);
    if (isTty) {
      if (lastRenderedPhase && lastRenderedPhase !== snap.phase) {
        process.stdout.write("\n");
      }
      lastRenderedPhase = snap.phase;
      process.stdout.write(`\r\x1b[K${line}`);
      if (snap.percent >= 100) {
        process.stdout.write("\n");
        lastRenderedPhase = "";
      }
    } else {
      const bucketPct = snap.percent >= 100 ? 100 : Math.floor(snap.percent / 25) * 25;
      if (lastRenderedPhase !== snap.phase || bucketPct > lastNonTtyPct) {
        if (lastRenderedPhase !== snap.phase) {
          lastNonTtyPct = -1;
        }
        lastRenderedPhase = snap.phase;
        lastNonTtyPct = bucketPct;
        console.log(line);
      }
    }
  };

  const confirmOverwriteHandler: UploadCallbacks["confirmOverwrite"] =
    hooks.confirmOverwrite ??
    (isInteractiveStdin
      ? async (info) => {
          resetProgressState();
          return await promptCliOverwrite(info);
        }
      : undefined);

  const callbacks: UploadCallbacks = {
    onTargetStart: (idx, total, target) => {
      resetProgressState();
      if (!options.json && total > 1) {
        if (isDownload) {
          console.log(
            `\n[${idx}/${total}] s3://${auth.bucket}/${target.objectKey} -> ${target.localPath}`,
          );
        } else {
          console.log(
            `\n[${idx}/${total}] ${target.relativePath} -> s3://${auth.bucket}/${target.objectKey}`,
          );
        }
      }
    },
    onAnalysis: (analysis) => {
      if (!options.json) {
        console.log(
          `Analysis:  ${analysis.fileName} (${formatBytes(analysis.sizeBytes)}, ${analysis.mimeType})`,
        );
        console.log(`Strategy:  ${analysis.reason}`);
      }
    },
    onLog: (level, message) => {
      if (options.json) return;
      if (level === "warn") console.warn(`Warning: ${message}`);
      else if (level === "error") console.error(`Error: ${message}`);
    },
    onProgress: renderProgress,
    confirmOverwrite: confirmOverwriteHandler,
  };

  const envProxyOverrides = {
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    ALL_PROXY: process.env.ALL_PROXY,
    NO_PROXY: process.env.NO_PROXY,
  };

  try {
    if (isDownload) {
      if (downloadTargets.length === 1) {
        const singleTarget = downloadTargets[0]!;
        let report: UploadReport;
        if (options.isolated) {
          const controller = startIsolatedDownloadSession(
            singleTarget,
            options,
            auth,
            proxy,
            tls,
            envProxyOverrides,
            callbacks,
          );
          const onSigInt = () => controller.cancel("Interrupted by SIGINT");
          process.once("SIGINT", onSigInt);
          try {
            report = await controller.promise;
          } finally {
            process.removeListener("SIGINT", onSigInt);
          }
        } else {
          report = await executeS3Download(singleTarget, options, auth, proxy, tls, callbacks);
        }

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printSingleReportSummary(report, options);
        }
        return report.success ? 0 : 1;
      }

      let batchReport: BatchUploadReport;
      if (options.isolated) {
        const controller = startIsolatedBatchDownloadSession(
          downloadTargets,
          options,
          auth,
          proxy,
          tls,
          envProxyOverrides,
          callbacks,
        );
        const onSigInt = () => controller.cancel("Interrupted by SIGINT");
        process.once("SIGINT", onSigInt);
        try {
          batchReport = await controller.promise;
        } finally {
          process.removeListener("SIGINT", onSigInt);
        }
      } else {
        batchReport = await executeBatchDownload(downloadTargets, options, auth, proxy, tls, callbacks);
      }

      if (options.json) {
        console.log(JSON.stringify(batchReport, null, 2));
      } else {
        printBatchReportSummary(batchReport);
      }
      return batchReport.success ? 0 : 1;
    }

    if (uploadTargets.length === 1) {
      const singleTarget = uploadTargets[0]!;
      const singleOpts: CliOptions = {
        ...options,
        filePath: singleTarget.localPath,
        key: singleTarget.objectKey,
      };

      let report: UploadReport;
      if (options.isolated) {
        const controller = startIsolatedUploadSession(
          singleOpts,
          auth,
          proxy,
          tls,
          envProxyOverrides,
          callbacks,
        );
        const onSigInt = () => controller.cancel("Interrupted by SIGINT");
        process.once("SIGINT", onSigInt);
        try {
          report = await controller.promise;
        } finally {
          process.removeListener("SIGINT", onSigInt);
        }
      } else {
        report = await executeS3Upload(singleOpts, auth, proxy, tls, callbacks);
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printSingleReportSummary(report, options);
      }
      return report.success ? 0 : 1;
    }

    // Batch upload (wildcards or directory)
    let batchReport: BatchUploadReport;
    if (options.isolated) {
      const controller = startIsolatedBatchUploadSession(
        uploadTargets,
        options,
        auth,
        proxy,
        tls,
        envProxyOverrides,
        callbacks,
      );
      const onSigInt = () => controller.cancel("Interrupted by SIGINT");
      process.once("SIGINT", onSigInt);
      try {
        batchReport = await controller.promise;
      } finally {
        process.removeListener("SIGINT", onSigInt);
      }
    } else {
      batchReport = await executeBatchUpload(uploadTargets, options, auth, proxy, tls, callbacks);
    }

    if (options.json) {
      console.log(JSON.stringify(batchReport, null, 2));
    } else {
      printBatchReportSummary(batchReport);
    }
    return batchReport.success ? 0 : 1;
  } catch (err) {
    resetProgressState();
    const msg = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.error(JSON.stringify({ success: false, error: msg }, null, 2));
    } else {
      console.error(`\n${isDownload ? "Download" : "Upload"} Failed: ${msg}`);
    }
    return 1;
  }
}
