import { resolve } from "node:path";
import {
  DEFAULT_LINK_SPEED_MBPS,
  DEFAULT_MULTIPART_THRESHOLD,
  DEFAULT_PART_SIZE,
  DEFAULT_QUEUE_SIZE,
  DEFAULT_RETRY,
  MIB,
  formatBandwidth,
  formatBytes,
  formatDurationMs,
  formatEta,
  formatSpeed,
  maskProxyUrl,
  renderProgressBar,
} from "./format.ts";
import {
  formatMissingConfigError,
  getEnvDiagnostics,
  resolveAndApplyProxy,
  resolveAndApplyTls,
  resolveTargetEndpointOrigin,
  validateAndResolveAuth,
} from "./env.ts";
import {
  listDirectoryEntriesWithShell,
  resolveUploadTargets,
  type DirectoryEntry,
} from "./shell.ts";
import { executeBatchUpload, executeS3Upload } from "./uploader.ts";
import type {
  BatchUploadReport,
  CliOptions,
  FileAnalysis,
  OverwriteDecision,
  OverwritePolicy,
  OverwritePromptInfo,
  ProgressSnapshot,
  ResolvedUploadTarget,
  UploadCallbacks,
  UploadReport,
  VerifyMode,
} from "./types.ts";

const ANSI = {
  enterAlt: "\x1b[?1049h",
  exitAlt: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clear: "\x1b[2J\x1b[H",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  inverse: "\x1b[7m",
};

interface TuiState {
  screen: "config" | "browse" | "running" | "confirm-overwrite" | "summary";
  selectedField: number;
  editingText: boolean;
  editBuffer: string;

  filePath: string;
  bucket: string;
  key: string;
  endpoint: string;
  region: string;
  partSizeMiB: number;
  queueSize: number;
  verifyMode: VerifyMode;
  overwritePolicy: OverwritePolicy;
  allowInvalidCerts: boolean;
  linkSpeedMbps: number;

  browseDir: string;
  browseEntries: DirectoryEntry[];
  browseIndex: number;

  batchIndex?: number;
  batchTotal?: number;
  currentTarget?: ResolvedUploadTarget;
  analysis?: FileAnalysis;
  phaseSnapshots: Partial<Record<ProgressSnapshot["phase"], ProgressSnapshot>>;
  logs: Array<{ level: string; text: string }>;
  pendingOverwrite?: OverwritePromptInfo;
  report?: UploadReport;
  batchReport?: BatchUploadReport;
  errorText?: string;
}

const PART_SIZE_CHOICES = [5, 10, 16, 32, 64];
const VERIFY_CHOICES: VerifyMode[] = ["full", "stat", "none"];
const OVERWRITE_CHOICES: OverwritePolicy[] = ["ask", "skip", "overwrite"];

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function renderScreen(state: TuiState): void {
  const cols = Math.max(74, Math.min(114, process.stdout.columns || 96));
  const inner = cols - 4;
  const line = "─".repeat(cols - 2);
  const out: string[] = [ANSI.clear];

  const boxLine = (content: string) => {
    out.push(`│ ${padRight(content, inner)} │`);
  };

  out.push(`┌${line}┐`);
  boxLine(`${ANSI.bold}${ANSI.cyan}BUN NATIVE S3 UPLOADER (TUI)${ANSI.reset}`);
  out.push(`├${line}┤`);

  if (state.screen === "config") {
    const fields: Array<{ label: string; value: string }> = [
      { label: "Path / Dir / Glob", value: state.filePath || "(empty - press B to browse or enter *.glob / dir)" },
      { label: "Destination Bucket", value: state.bucket || "(uses S3_BUCKET/AWS_BUCKET)" },
      { label: "Key / Prefix", value: state.key || "(auto: filename or relative path)" },
      { label: "Endpoint URL", value: state.endpoint || "(uses env or AWS default)" },
      { label: "AWS Region", value: state.region || "us-east-1" },
      { label: "Multipart Size", value: `${state.partSizeMiB} MiB` },
      { label: "Concurrency", value: `${state.queueSize} parallel parts` },
      { label: "Shasum Verify", value: state.verifyMode },
      { label: "Overwrite Policy", value: state.overwritePolicy },
      {
        label: "Allow Invalid TLS",
        value: state.allowInvalidCerts ? "[ENABLED] (NODE_TLS_REJECT_UNAUTHORIZED=0)" : "[DISABLED] (strict TLS)",
      },
    ];

    boxLine(`${ANSI.bold}Configuration${ANSI.reset}  (Up/Down: select, Enter: edit/toggle, B: browse, S: start, Q: quit)`);
    boxLine("");

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      const active = i === state.selectedField;
      const prefix = active ? `${ANSI.cyan}> ` : "  ";
      const labelStr = `${f.label.padEnd(20, " ")}: `;
      let valStr = f.value;
      if (active && state.editingText) {
        valStr = `${ANSI.inverse}${state.editBuffer}█${ANSI.reset}`;
      } else if (active) {
        valStr = `${ANSI.bold}${valStr}${ANSI.reset}`;
      }
      out.push(`│ ${prefix}${labelStr}${valStr}${ANSI.reset}`);
    }

    out.push(`├${line}┤`);
    boxLine(`${ANSI.bold}Environment & Network Diagnostics${ANSI.reset}`);
    const diag = getEnvDiagnostics();
    for (const d of diag) {
      const badge = d.present ? `${ANSI.green}[OK]${ANSI.reset}` : `${ANSI.yellow}[--]${ANSI.reset}`;
      out.push(`│  ${badge} ${d.label.padEnd(18, " ")} ${d.envVar.padEnd(36, " ")} ${d.maskedValue}`);
    }

    if (state.errorText) {
      out.push(`├${line}┤`);
      for (const errLine of state.errorText.split("\n")) {
        out.push(`│ ${ANSI.red}${errLine}${ANSI.reset}`);
      }
    }
  } else if (state.screen === "browse") {
    boxLine(`${ANSI.bold}Bun Shell File Browser ($ ls -l)${ANSI.reset}  (Enter: open/select, U: use current dir, Esc: back)`);
    boxLine(`Directory: ${state.browseDir}`);
    out.push(`├${line}┤`);

    const maxRows = 16;
    const start = Math.max(0, state.browseIndex - Math.floor(maxRows / 2));
    const slice = state.browseEntries.slice(start, start + maxRows);

    if (slice.length === 0) {
      boxLine("(empty directory)");
    } else {
      for (let i = 0; i < slice.length; i++) {
        const entry = slice[i]!;
        const idx = start + i;
        const active = idx === state.browseIndex;
        const prefix = active ? `${ANSI.inverse}> ` : "  ";
        const kindTag = entry.isDirectory ? "[DIR] " : "[FILE]";
        const sizeStr = entry.isDirectory ? "" : formatBytes(entry.sizeBytes);
        const row = `${kindTag} ${entry.name.padEnd(42, " ")} ${sizeStr}`;
        out.push(`│ ${prefix}${padRight(row, inner - 2)}${ANSI.reset}`);
      }
    }
  } else if (
    state.screen === "running" ||
    state.screen === "confirm-overwrite" ||
    state.screen === "summary"
  ) {
    const batchTag =
      state.batchTotal && state.batchTotal > 1 && state.batchIndex !== undefined
        ? ` [File ${state.batchIndex}/${state.batchTotal}]`
        : "";
    boxLine(`${ANSI.bold}Transfer Dashboard${batchTag}${ANSI.reset}`);
    if (state.currentTarget) {
      boxLine(`Key: ${state.currentTarget.objectKey}`);
    }
    if (state.analysis) {
      boxLine(`File: ${state.analysis.fileName} (${formatBytes(state.analysis.sizeBytes)}) | Type: ${state.analysis.mimeType}`);
      boxLine(`Strategy: ${state.analysis.reason}`);
    }
    out.push(`├${line}┤`);

    const orderedPhases: Array<{ key: ProgressSnapshot["phase"]; title: string }> = [
      { key: "hashing", title: "1. Local SHA-256" },
      { key: "uploading", title: "2. S3 Upload    " },
      { key: "verifying", title: "3. Verify/Read  " },
    ];

    for (const p of orderedPhases) {
      const snap = state.phaseSnapshots[p.key];
      if (!snap) {
        boxLine(`${p.title}: ${ANSI.dim}pending...${ANSI.reset}`);
      } else {
        const bar = renderProgressBar(snap.percent, 20);
        const speed = formatSpeed(snap.speedBytesPerSec);
        const bw = `${formatBandwidth(snap.bandwidthMbps)} (${snap.bandwidthUtilizationPct.toFixed(1)}%)`;
        const eta = formatEta(snap.etaSeconds);
        const part =
          snap.totalParts && snap.totalParts > 1 && snap.currentPart !== undefined
            ? ` [Part ${snap.currentPart}/${snap.totalParts}]`
            : "";
        out.push(`│ ${ANSI.cyan}${p.title}${ANSI.reset} ${bar} ${speed} | BW ${bw} | ETA ${eta}${part}`);
      }
    }

    if (state.screen === "confirm-overwrite" && state.pendingOverwrite) {
      const ov = state.pendingOverwrite;
      out.push(`├${line}┤`);
      out.push(`│ ${ANSI.yellow}${ANSI.bold}OVERWRITE CONFIRMATION REQUIRED${ANSI.reset}`);
      boxLine(`Target Object: s3://${ov.bucket}/${ov.key}`);
      boxLine(
        `Local Size: ${formatBytes(ov.localSizeBytes)} | Remote Size: ${ov.remoteSizeBytes !== undefined ? formatBytes(ov.remoteSizeBytes) : "unknown"}${ov.remoteEtag ? ` | ETag: ${ov.remoteEtag}` : ""}`,
      );
      out.push(`│ ${ANSI.bold}Press [Y]es, [N]o (skip), [A]ll (overwrite all), [S]kip all, or [Q]uit${ANSI.reset}`);
    }

    if (state.logs.length > 0) {
      out.push(`├${line}┤`);
      boxLine(`${ANSI.bold}Activity Log${ANSI.reset}`);
      for (const entry of state.logs.slice(-5)) {
        const color =
          entry.level === "error"
            ? ANSI.red
            : entry.level === "warn"
              ? ANSI.yellow
              : entry.level === "success"
                ? ANSI.green
                : ANSI.dim;
        out.push(`│ ${color}${entry.text}${ANSI.reset}`);
      }
    }

    if (state.screen === "summary") {
      out.push(`├${line}┤`);
      if (state.batchReport) {
        const b = state.batchReport;
        const headingColor = b.success ? ANSI.green : ANSI.red;
        out.push(`│ ${headingColor}${ANSI.bold}BATCH TRANSFER ${b.success ? "COMPLETED" : "FINISHED WITH ERRORS"}${ANSI.reset}`);
        boxLine(`Bucket:        s3://${b.bucket}`);
        boxLine(`Files:         ${b.totalFiles} total | ${b.uploadedCount} uploaded | ${b.skippedCount} skipped | ${b.failedCount} failed`);
        boxLine(`Total Volume:  ${formatBytes(b.uploadedBytes)} / ${formatBytes(b.totalBytes)} in ${formatDurationMs(b.durationMs)}`);
        boxLine(`Avg Speed/BW:  ${formatSpeed(b.avgSpeedBytesPerSec)} | ${formatBandwidth(b.avgBandwidthMbps)}`);
      } else if (state.report?.skipped) {
        const r = state.report;
        out.push(`│ ${ANSI.yellow}${ANSI.bold}UPLOAD SKIPPED${ANSI.reset}`);
        boxLine(`Target:  s3://${r.bucket}/${r.key}`);
        boxLine(`Reason:  ${r.skipReason ?? "Skipped"}`);
      } else if (state.report?.success) {
        const r = state.report;
        out.push(`│ ${ANSI.green}${ANSI.bold}UPLOAD & VERIFICATION SUCCEEDED${ANSI.reset}`);
        boxLine(`Target:          s3://${r.bucket}/${r.key}`);
        boxLine(`Strategy:        ${r.upload.strategy.toUpperCase()} (${r.upload.partsUploaded} part(s)) in ${formatDurationMs(r.upload.durationMs)}`);
        boxLine(`Upload Speed:    avg ${formatSpeed(r.upload.avgSpeedBytesPerSec)} | peak ${formatSpeed(r.upload.peakSpeedBytesPerSec)}`);
        boxLine(`Bandwidth Used:  ${formatBandwidth(r.upload.avgBandwidthMbps)} (${r.upload.bandwidthUtilizationPct.toFixed(1)}% link)`);
        if (r.verification.downloadSpeedBytesPerSec !== undefined) {
          boxLine(`Download Speed:  ${formatSpeed(r.verification.downloadSpeedBytesPerSec)} (${formatBandwidth(r.verification.downloadBandwidthMbps ?? 0)})`);
        }
        boxLine(`SHA-256:         ${r.checksum.sha256Hex} (${r.verification.sha256Match === true ? "VERIFIED" : r.verification.mode})`);
        if (r.proxy.activeProxyUrl) {
          boxLine(`Proxy:           ${maskProxyUrl(r.proxy.activeProxyUrl)}`);
        }
        boxLine(`TLS Mode:        ${r.tls.allowInvalidCerts ? "Allow Invalid Certs" : "Strict"}`);
      } else {
        out.push(`│ ${ANSI.red}${ANSI.bold}UPLOAD FAILED${ANSI.reset}`);
        for (const errLine of (state.errorText ?? "Unknown error").split("\n")) {
          out.push(`│ ${ANSI.red}${errLine}${ANSI.reset}`);
        }
      }
      out.push(`├${line}┤`);
      boxLine("Press Enter or R to return to config, Q to quit.");
    }
  }

  out.push(`└${line}┘`);
  process.stdout.write(out.join("\n") + "\n");
}

/**
 * Runs the interactive Terminal UI using exclusively native Bun APIs (`process.stdin`, ANSI, `$`, `Bun.Glob`).
 */
export async function runTui(initialOptions: Partial<CliOptions> = {}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Interactive TUI requires a TTY terminal. Pass CLI arguments or run with --help.");
    return 1;
  }

  const state: TuiState = {
    screen: "config",
    selectedField: 0,
    editingText: false,
    editBuffer: "",
    filePath: initialOptions.filePath ?? "",
    bucket: initialOptions.bucket ?? process.env.S3_BUCKET ?? process.env.AWS_BUCKET ?? "",
    key: initialOptions.key ?? "",
    endpoint: initialOptions.endpoint ?? process.env.S3_ENDPOINT ?? process.env.AWS_ENDPOINT ?? "",
    region: initialOptions.region ?? process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1",
    partSizeMiB: Math.max(5, Math.round((initialOptions.partSize ?? DEFAULT_PART_SIZE) / MIB)),
    queueSize: initialOptions.queueSize ?? DEFAULT_QUEUE_SIZE,
    verifyMode: initialOptions.verifyMode ?? "full",
    overwritePolicy: initialOptions.overwritePolicy ?? "ask",
    allowInvalidCerts:
      initialOptions.insecure ?? process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0",
    linkSpeedMbps: initialOptions.linkSpeedMbps ?? DEFAULT_LINK_SPEED_MBPS,
    browseDir: process.cwd(),
    browseEntries: [],
    browseIndex: 0,
    phaseSnapshots: {},
    logs: [],
  };

  let running = true;
  let exitCode = 0;
  let overwriteResolver: ((decision: OverwriteDecision) => void) | null = null;

  const restoreTerminal = () => {
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    } catch {
      // Ignore cleanup errors
    }
    process.stdout.write(ANSI.showCursor + ANSI.exitAlt);
  };

  process.stdout.write(ANSI.enterAlt + ANSI.hideCursor);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const startUpload = async () => {
    state.errorText = undefined;
    state.report = undefined;
    state.batchReport = undefined;
    state.analysis = undefined;
    state.currentTarget = undefined;
    state.batchIndex = undefined;
    state.batchTotal = undefined;
    state.phaseSnapshots = {};
    state.logs = [];

    const cliOpts: CliOptions = {
      filePath: state.filePath.trim(),
      bucket: state.bucket.trim() || undefined,
      key: state.key.trim() || undefined,
      endpoint: state.endpoint.trim() || undefined,
      region: state.region.trim() || undefined,
      partSize: state.partSizeMiB * MIB,
      multipartThreshold: DEFAULT_MULTIPART_THRESHOLD,
      queueSize: state.queueSize,
      retry: DEFAULT_RETRY,
      verifyMode: state.verifyMode,
      overwritePolicy: state.overwritePolicy,
      linkSpeedMbps: state.linkSpeedMbps,
      insecure: state.allowInvalidCerts,
      strictTls: !state.allowInvalidCerts,
      isolated: false,
      tui: true,
      json: false,
      dryRun: false,
      help: false,
      version: false,
    };

    if (!cliOpts.filePath) {
      state.errorText = "Please enter a File, Directory, or Wildcard pattern (or press B to browse).";
      renderScreen(state);
      return;
    }

    const validation = validateAndResolveAuth(cliOpts);
    if (!validation.valid || !validation.auth) {
      state.errorText = formatMissingConfigError(validation.missing);
      renderScreen(state);
      return;
    }

    let targets: ResolvedUploadTarget[];
    try {
      targets = await resolveUploadTargets([cliOpts.filePath], cliOpts.key);
    } catch (err) {
      state.errorText = err instanceof Error ? err.message : String(err);
      renderScreen(state);
      return;
    }

    const auth = validation.auth;
    const targetOrigin = resolveTargetEndpointOrigin(auth);
    const proxy = resolveAndApplyProxy(targetOrigin, initialOptions.proxy);
    const tls = resolveAndApplyTls(cliOpts);

    state.screen = "running";
    state.logs.push({
      level: "info",
      text: `Matched ${targets.length} file(s) -> s3://${auth.bucket} via ${targetOrigin}`,
    });
    if (proxy.activeProxyUrl) {
      state.logs.push({
        level: "info",
        text: `Proxy: ${maskProxyUrl(proxy.activeProxyUrl)} (${proxy.sourceEnvVar})`,
      });
    }
    state.logs.push({
      level: tls.allowInvalidCerts ? "warn" : "info",
      text: `TLS: ${tls.allowInvalidCerts ? "Invalid certificates allowed" : "Strict verification"}`,
    });
    renderScreen(state);

    let lastRenderMs = 0;
    const callbacks: UploadCallbacks = {
      onTargetStart: (idx, total, target) => {
        state.batchIndex = idx;
        state.batchTotal = total;
        state.currentTarget = target;
        state.phaseSnapshots = {};
        state.analysis = undefined;
        renderScreen(state);
      },
      onAnalysis: (analysis) => {
        state.analysis = analysis;
        state.logs.push({ level: "info", text: analysis.reason });
        renderScreen(state);
      },
      onLog: (level, msg) => {
        state.logs.push({ level, text: msg });
        renderScreen(state);
      },
      onProgress: (snap) => {
        state.phaseSnapshots[snap.phase] = snap;
        const now = performance.now();
        if (now - lastRenderMs >= 80 || snap.percent >= 100) {
          lastRenderMs = now;
          renderScreen(state);
        }
      },
      confirmOverwrite: async (info) => {
        state.pendingOverwrite = info;
        state.screen = "confirm-overwrite";
        renderScreen(state);
        return await new Promise<OverwriteDecision>((resolveDecision) => {
          overwriteResolver = (decision) => {
            overwriteResolver = null;
            state.pendingOverwrite = undefined;
            state.screen = "running";
            renderScreen(state);
            resolveDecision(decision);
          };
        });
      },
    };

    try {
      if (targets.length === 1) {
        const singleOpts: CliOptions = {
          ...cliOpts,
          filePath: targets[0]!.localPath,
          key: targets[0]!.objectKey,
        };
        const report = await executeS3Upload(singleOpts, auth, proxy, tls, callbacks);
        state.report = report;
        state.screen = "summary";
        exitCode = report.success ? 0 : 1;
      } else {
        const batchReport = await executeBatchUpload(targets, cliOpts, auth, proxy, tls, callbacks);
        state.batchReport = batchReport;
        state.screen = "summary";
        exitCode = batchReport.success ? 0 : 1;
      }
      renderScreen(state);
    } catch (err) {
      state.errorText = err instanceof Error ? err.message : String(err);
      state.screen = "summary";
      exitCode = 1;
      renderScreen(state);
    }
  };

  const openBrowser = async () => {
    state.screen = "browse";
    state.browseEntries = await listDirectoryEntriesWithShell(state.browseDir);
    state.browseIndex = 0;
    renderScreen(state);
  };

  renderScreen(state);

  try {
    await new Promise<void>((resolveLoop) => {
      const onData = async (chunk: Buffer) => {
        const key = chunk.toString("utf8");

        if (key === "\x03") {
          overwriteResolver?.("abort");
          running = false;
          process.stdin.off("data", onData);
          resolveLoop();
          return;
        }

        if (state.screen === "confirm-overwrite" && overwriteResolver) {
          const lower = key.toLowerCase();
          if (lower === "y") overwriteResolver("overwrite");
          else if (lower === "n" || key === "\r" || key === "\n") overwriteResolver("skip");
          else if (lower === "a") overwriteResolver("overwrite-all");
          else if (lower === "s") overwriteResolver("skip-all");
          else if (lower === "q") overwriteResolver("abort");
          return;
        }

        if (state.screen === "running") {
          return;
        }

        if (state.screen === "summary") {
          if (key === "q" || key === "Q") {
            running = false;
            process.stdin.off("data", onData);
            resolveLoop();
            return;
          }
          if (key === "\r" || key === "\n" || key === "r" || key === "R") {
            state.screen = "config";
            renderScreen(state);
          }
          return;
        }

        if (state.screen === "browse") {
          if (key === "\x1b" || key === "q" || key === "Q") {
            state.screen = "config";
            renderScreen(state);
            return;
          }
          if (key === "u" || key === "U") {
            state.filePath = state.browseDir;
            state.screen = "config";
            renderScreen(state);
            return;
          }
          if (key === "\x1b[A") {
            state.browseIndex = Math.max(0, state.browseIndex - 1);
            renderScreen(state);
            return;
          }
          if (key === "\x1b[B") {
            state.browseIndex = Math.min(Math.max(0, state.browseEntries.length - 1), state.browseIndex + 1);
            renderScreen(state);
            return;
          }
          if (key === "\x7f" || key === "\b") {
            state.browseDir = resolve(state.browseDir, "..");
            state.browseEntries = await listDirectoryEntriesWithShell(state.browseDir);
            state.browseIndex = 0;
            renderScreen(state);
            return;
          }
          if (key === "\r" || key === "\n") {
            const chosen = state.browseEntries[state.browseIndex];
            if (!chosen) return;
            if (chosen.isDirectory) {
              state.browseDir = chosen.fullPath;
              state.browseEntries = await listDirectoryEntriesWithShell(state.browseDir);
              state.browseIndex = 0;
              renderScreen(state);
            } else {
              state.filePath = chosen.fullPath;
              state.screen = "config";
              renderScreen(state);
            }
          }
          return;
        }

        // Config screen
        if (state.editingText) {
          if (key === "\r" || key === "\n") {
            const val = state.editBuffer;
            if (state.selectedField === 0) state.filePath = val;
            else if (state.selectedField === 1) state.bucket = val;
            else if (state.selectedField === 2) state.key = val;
            else if (state.selectedField === 3) state.endpoint = val;
            else if (state.selectedField === 4) state.region = val;
            state.editingText = false;
            renderScreen(state);
            return;
          }
          if (key === "\x1b") {
            state.editingText = false;
            renderScreen(state);
            return;
          }
          if (key === "\x7f" || key === "\b") {
            state.editBuffer = state.editBuffer.slice(0, -1);
            renderScreen(state);
            return;
          }
          if (key.length === 1 && key >= " " && key <= "~") {
            state.editBuffer += key;
            renderScreen(state);
          }
          return;
        }

        if (key === "q" || key === "Q") {
          running = false;
          process.stdin.off("data", onData);
          resolveLoop();
          return;
        }
        if (key === "b" || key === "B") {
          await openBrowser();
          return;
        }
        if (key === "s" || key === "S") {
          await startUpload();
          return;
        }
        const totalFields = 10;
        if (key === "\x1b[A") {
          state.selectedField = (state.selectedField + totalFields - 1) % totalFields;
          renderScreen(state);
          return;
        }
        if (key === "\x1b[B") {
          state.selectedField = (state.selectedField + 1) % totalFields;
          renderScreen(state);
          return;
        }
        if (key === "\r" || key === "\n" || key === " ") {
          if (state.selectedField <= 4) {
            const current =
              state.selectedField === 0
                ? state.filePath
                : state.selectedField === 1
                  ? state.bucket
                  : state.selectedField === 2
                    ? state.key
                    : state.selectedField === 3
                      ? state.endpoint
                      : state.region;
            state.editingText = true;
            state.editBuffer = current;
            renderScreen(state);
          } else if (state.selectedField === 5) {
            const idx = PART_SIZE_CHOICES.indexOf(state.partSizeMiB);
            state.partSizeMiB = PART_SIZE_CHOICES[(idx + 1) % PART_SIZE_CHOICES.length]!;
            renderScreen(state);
          } else if (state.selectedField === 6) {
            state.queueSize = state.queueSize >= 8 ? 1 : state.queueSize + 1;
            renderScreen(state);
          } else if (state.selectedField === 7) {
            const idx = VERIFY_CHOICES.indexOf(state.verifyMode);
            state.verifyMode = VERIFY_CHOICES[(idx + 1) % VERIFY_CHOICES.length]!;
            renderScreen(state);
          } else if (state.selectedField === 8) {
            const idx = OVERWRITE_CHOICES.indexOf(state.overwritePolicy);
            state.overwritePolicy = OVERWRITE_CHOICES[(idx + 1) % OVERWRITE_CHOICES.length]!;
            renderScreen(state);
          } else if (state.selectedField === 9) {
            state.allowInvalidCerts = !state.allowInvalidCerts;
            renderScreen(state);
          }
        }
      };

      process.stdin.on("data", onData);
      if (!running) resolveLoop();
    });
  } finally {
    restoreTerminal();
  }

  return exitCode;
}
