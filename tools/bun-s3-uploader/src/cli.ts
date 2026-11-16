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
  parseByteSize,
  parseS3Uri,
  renderProgressBar,
} from "./format.ts";
import {
  formatMissingConfigError,
  resolveAndApplyProxy,
  resolveAndApplyTls,
  resolveTargetEndpointOrigin,
  validateAndResolveAuth,
} from "./env.ts";
import { startIsolatedUploadSession } from "./session-runner.ts";
import { executeS3Upload } from "./uploader.ts";
import type {
  CliOptions,
  ProgressSnapshot,
  S3Acl,
  S3StorageClass,
  UploadReport,
  VerifyMode,
} from "./types.ts";

export const APP_VERSION = "1.0.0";

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
Bun Native S3 Uploader v${APP_VERSION}

Usage:
  bun run src/index.ts <file-path> <bucket> [key] [options]
  bun run src/index.ts <file-path> s3://<bucket>/<key> [options]
  bun run src/index.ts --file <path> --bucket <name> [options]
  bun run src/index.ts --tui

Target & File Options:
  -f, --file <path>              Local file path to upload
  -b, --bucket <name>            Destination S3 bucket (fallback: S3_BUCKET / AWS_BUCKET)
  -k, --key <object-key>         Destination object key (default: file basename)
  -e, --endpoint <url>           S3-compatible endpoint URL (fallback: S3_ENDPOINT / AWS_ENDPOINT)
  -r, --region <region>          AWS region (fallback: S3_REGION / AWS_REGION, default: us-east-1)
      --virtual-hosted-style     Use virtual hosted-style S3 URLs
      --acl <acl>                Object ACL (private, public-read, bucket-owner-full-control, ...)
      --storage-class <class>    S3 storage class (STANDARD, STANDARD_IA, GLACIER, ...)
      --request-payer            Set x-amz-request-payer for requester-pays buckets

Multipart & Transfer Options:
      --part-size <size>         Multipart chunk size, 5MiB..5GiB (default: 5MiB)
      --multipart-threshold <s>  Size threshold to enable multipart upload (default: 5MiB)
      --queue-size <n>           Concurrent multipart uploads, 1..255 (default: 4)
      --retry <n>                Retry attempts per request, 0..255 (default: 3)
      --link-mbps <n>            Link capacity in Mbps for bandwidth % display (default: 1000)

Integrity, Proxy & TLS Options:
      --verify <mode>            Verification mode: full | stat | none (default: full)
      --proxy <url>              HTTP/HTTPS proxy URL (overrides HTTP_PROXY / HTTPS_PROXY)
      --insecure, --allow-invalid-certs
                                 Allow invalid/self-signed TLS certificates (NODE_TLS_REJECT_UNAUTHORIZED=0)
      --strict-tls               Enforce strict TLS certificate verification

Execution & Output Options:
      --isolated                 Run upload inside an isolated Bun.ModuleGraph session
      --tui                      Launch interactive Terminal UI
      --dry-run                  Analyze file, validate env/proxy/TLS, and compute SHA-256 without uploading
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

/**
 * Parses CLI arguments into structured options without external dependencies.
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    partSize: DEFAULT_PART_SIZE,
    multipartThreshold: DEFAULT_MULTIPART_THRESHOLD,
    queueSize: DEFAULT_QUEUE_SIZE,
    retry: DEFAULT_RETRY,
    verifyMode: "full",
    linkSpeedMbps: DEFAULT_LINK_SPEED_MBPS,
    isolated: false,
    tui: false,
    json: false,
    dryRun: false,
    help: false,
    version: false,
  };

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
        options.filePath = res.value;
        i = res.nextIdx;
        break;
      }
      case "-b":
      case "--bucket": {
        const res = readValue(i, flag, inlineVal);
        options.bucket = res.value;
        i = res.nextIdx;
        break;
      }
      case "-k":
        // Support `-k` both as curl-style `--insecure` when no value follows or `--key` if not ambiguous?
        // To stay unambiguous, `-k` is `--insecure` (like curl) and `--key` is object key; if user wants short flag for key, use `--key`.
        options.insecure = true;
        break;
      case "--key": {
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

  // Assign positional arguments: <filePath> <bucket-or-s3-uri> [key]
  if (positionals.length > 0 && !options.filePath) {
    options.filePath = positionals.shift();
  }
  if (positionals.length > 0 && !options.bucket) {
    const second = positionals.shift()!;
    const s3Uri = parseS3Uri(second);
    if (s3Uri) {
      options.bucket = s3Uri.bucket;
      if (s3Uri.key && !options.key) {
        options.key = s3Uri.key;
      }
    } else {
      options.bucket = second;
    }
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

/**
 * Runs the CLI upload workflow and returns an exit code (0 on success, 1 on failure).
 */
export async function runCli(argv: string[]): Promise<number> {
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
    console.log(`bun-s3-uploader v${APP_VERSION} (Bun ${Bun.version})`);
    return 0;
  }

  const missingInputs: string[] = [];
  if (!options.filePath) {
    missingInputs.push("Missing input file path (<file-path> or --file <path>).");
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

  const isTty = Boolean(process.stdout.isTTY) && !options.json;

  if (!options.json) {
    console.log("=== Bun Native S3 Uploader ===");
    for (const warning of validation.warnings) {
      console.log(`Warning: ${warning}`);
    }
    console.log(`File:      ${options.filePath}`);
    const displayKey = options.key
      ? options.key.replace(/^\/+/, "")
      : options.filePath!.split(/[\\/]/).pop();
    console.log(`Target:    s3://${auth.bucket}/${displayKey}`);
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
    console.log(`Verify:    ${options.verifyMode}${options.isolated ? " | Execution: isolated Bun.ModuleGraph" : ""}`);
    console.log("");
  }

  let lastRenderedPhase = "";
  let lastNonTtyPct = -1;

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

  const callbacks = {
    onAnalysis: (analysis: UploadReport["fileAnalysis"]) => {
      if (!options.json) {
        console.log(
          `Analysis:  ${analysis.fileName} (${formatBytes(analysis.sizeBytes)}, ${analysis.mimeType})`,
        );
        console.log(`Strategy:  ${analysis.reason}`);
      }
    },
    onLog: (level: "info" | "warn" | "error" | "success", message: string) => {
      if (options.json) return;
      if (level === "warn") console.warn(`Warning: ${message}`);
      else if (level === "error") console.error(`Error: ${message}`);
    },
    onProgress: renderProgress,
  };

  let report: UploadReport;
  try {
    if (options.isolated) {
      const controller = startIsolatedUploadSession(
        options,
        auth,
        proxy,
        tls,
        {
          HTTP_PROXY: process.env.HTTP_PROXY,
          HTTPS_PROXY: process.env.HTTPS_PROXY,
          ALL_PROXY: process.env.ALL_PROXY,
          NO_PROXY: process.env.NO_PROXY,
        },
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
      report = await executeS3Upload(options, auth, proxy, tls, callbacks);
    }
  } catch (err) {
    if (isTty && lastRenderedPhase) {
      process.stdout.write("\n");
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.error(JSON.stringify({ success: false, error: msg }, null, 2));
    } else {
      console.error(`\nUpload Failed: ${msg}`);
    }
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.success ? 0 : 1;
  }

  console.log("");
  console.log("=== Transfer & Integrity Summary ===");
  console.log(`Status:           ${report.success ? "SUCCESS" : "FAILED"}`);
  console.log(`Object:           s3://${report.bucket}/${report.key}`);
  console.log(
    `Upload Strategy:  ${report.upload.strategy.toUpperCase()} (${report.upload.partsUploaded} part(s))`,
  );
  if (!options.dryRun) {
    console.log(`Upload Duration:  ${formatDurationMs(report.upload.durationMs)}`);
    console.log(
      `Upload Speed:     avg ${formatSpeed(report.upload.avgSpeedBytesPerSec)} | peak ${formatSpeed(report.upload.peakSpeedBytesPerSec)}`,
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
    if (report.verification.remoteSha256Hex) {
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

  return report.success ? 0 : 1;
}
