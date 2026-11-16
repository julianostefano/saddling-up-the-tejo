# Cloud & Database Operations Tooling (`tools/`)

[← Back to Repository Root](../README.md)

Operational CLI and TUI utilities designed for production database migrations, Oracle Data Pump (`expdp`) auditing, and high-throughput AWS S3 / S3-compatible object storage transfers.

---

## Directory Structure

```text
tools/
├── README.md
├── bun-s3-uploader/                    # Zero-dependency native Bun S3 Uploader CLI & TUI
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                    # Entrypoint dispatching CLI vs. interactive TUI
│   │   ├── cli.ts                      # Argument parser, progress bar, overwrite prompt, JSON mode
│   │   ├── tui.ts                      # Native ANSI raw-mode TUI with file browser & dashboard
│   │   ├── uploader.ts                 # Single-part & multipart S3 uploader + SSE-KMS verification
│   │   ├── shell.ts                    # Bun.$ path inspection & Bun.Glob wildcard/dir resolver
│   │   ├── hasher.ts                   # Main-thread Worker wrapper for checksum calculation
│   │   ├── workers/hash-worker.ts      # Background Worker computing SHA-256, MD5, multipart ETag
│   │   ├── session-runner.ts           # Isolated Bun.ModuleGraph session controller
│   │   ├── isolated-entry.ts           # ModuleGraph entrypoint for scoped env/cancellation
│   │   ├── env.ts                      # S3_*/AWS_* credentials, proxy & TLS resolution
│   │   ├── format.ts                   # Target normalization, size parsing & formatting helpers
│   │   ├── metrics.ts                  # EMA-smoothed TransferMeter (speed, bandwidth, ETA)
│   │   └── types.ts                    # Strict TypeScript domain interfaces
│   └── tests/                          # Unit, shell/worker & in-process S3/TLS/proxy tests
└── datapump-log-parser/                # Oracle Data Pump (expdp) log-to-CSV parser
    ├── README.md
    └── parse_expdp_log.py              # Zero-dependency Python 3 CLI parser
```

---

## Tool 1: Bun Native S3 Uploader

**Location:** [`bun-s3-uploader/`](./bun-s3-uploader/) · [Full Documentation](./bun-s3-uploader/README.md)

A standalone, zero-runtime-dependency S3 transfer utility built exclusively with **Bun's native APIs** (`Bun.S3Client`, `Bun.$`, `Bun.Glob`, `Worker`, `Bun.CryptoHasher`, `Bun.ModuleGraph`). Designed for large database dumps (`.DMP`), backups, and directory trees over corporate proxies or self-signed endpoints.

### Architecture Overview

| Module | Responsibility |
| --- | --- |
| [`src/index.ts`](./bun-s3-uploader/src/index.ts) | Entrypoint routing between non-interactive CLI and interactive TTY TUI |
| [`src/cli.ts`](./bun-s3-uploader/src/cli.ts) | Positional & flag parser (including bash-expanded wildcards), progress bar, interactive overwrite prompt, `--json` output |
| [`src/tui.ts`](./bun-s3-uploader/src/tui.ts) | Full-screen ANSI raw-mode TUI with `$ ls -l` directory browser, overwrite modal, and transfer dashboard |
| [`src/uploader.ts`](./bun-s3-uploader/src/uploader.ts) | File size analysis, Single-Part (`s3File.write`) vs. concurrent Multipart (`s3File.writer`), `exists()` checks, `SHA-256` & SSE-KMS verification |
| [`src/shell.ts`](./bun-s3-uploader/src/shell.ts) | Cross-platform `Bun.$` inspection (`dirname`, `basename`, `ls -l`), `Bun.Glob` recursion, automatic `${path}*` fallback, folder suffixing |
| [`src/hasher.ts`](./bun-s3-uploader/src/hasher.ts) & [`src/workers/hash-worker.ts`](./bun-s3-uploader/src/workers/hash-worker.ts) | Background `Worker` thread streaming `SHA-256`, `MD5`, and AWS S3 multipart `ETag` hashes |
| [`src/session-runner.ts`](./bun-s3-uploader/src/session-runner.ts) & [`src/isolated-entry.ts`](./bun-s3-uploader/src/isolated-entry.ts) | Isolated `Bun.ModuleGraph` execution with scoped `process.env` and `graph.dispose()` cancellation |
| [`src/env.ts`](./bun-s3-uploader/src/env.ts) | `S3_*`/`AWS_*` credential checks, `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` CIDR/wildcard evaluation, `NODE_TLS_REJECT_UNAUTHORIZED` |
| [`src/format.ts`](./bun-s3-uploader/src/format.ts) & [`src/metrics.ts`](./bun-s3-uploader/src/metrics.ts) | `normalizeS3Target`, byte/speed/ETA formatting, EMA-smoothed throughput & bandwidth utilization |

### Key Capabilities

- **Adaptive Single-Part vs. Multipart Upload**: Evaluates file size against `--multipart-threshold` (default `5 MiB`) and switches to concurrent S3 Multipart Upload (`S3File.writer`) with configurable `--part-size` (`5 MiB`–`5 GiB`), `--queue-size` (`1`–`255`), and `--retry` (`0`–`255`).
- **Smart Target Normalization & Wildcard Expansion**:
  - Accepts `s3://bucket/prefix/`, bare `bucket/prefix/`, or `<bucket> <key>` arguments.
  - Appends local filenames automatically when targeting a folder prefix (`dumps/20261116/` or `dumps/20261116`).
  - Supports quoted globs (`"./dumps/**/*.DMP"`), bash-expanded multi-file positional arguments (`./dumps/CLBP_* s3://bucket/prefix/`), recursive directories, and automatic `${path}*` wildcard fallback.
- **Overwrite Protection**: Checks `s3File.exists()` and `s3File.stat()` before transfer; prompts `[y]es / [N]o (skip) / [a]ll / [s]kip all / [q]uit` in interactive sessions and refuses silent overwrites in non-TTY scripts unless `--yes` / `--overwrite` or `--skip-existing` is passed.
- **Integrity & SSE-KMS Compatibility**: Computes local `SHA-256`, `MD5`, and multipart `ETag` in a `Worker` thread, validates remote size & multipart part counts even on **SSE-KMS** encrypted buckets (where cipher ETags differ from plaintext MD5), and streams back the object for full `SHA-256` verification (`--verify full`).
- **Enterprise Proxy & TLS Support**: Automatically routes through `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` respecting `NO_PROXY`, and supports invalid/self-signed certificates via `-k` / `--insecure` (`NODE_TLS_REJECT_UNAUTHORIZED=0`).
- **Standalone Linux x64 Binary**: Cross-compiles (`bun run build:linux-x64`) into a self-contained binary bundling the CLI, Worker, and `ModuleGraph` entrypoints.

### CLI Options Reference

| Category | Flag(s) | Description | Default |
| --- | --- | --- | --- |
| Target | `-f`, `--file <path\|dir\|glob>` | Local file, directory, or glob pattern (repeatable) | *(positional)* |
| Target | `-b`, `--bucket <name>` | Destination S3 bucket | `S3_BUCKET` / `AWS_BUCKET` |
| Target | `--key`, `--prefix <key>` | Object key or key prefix for batch uploads | File basename / relative path |
| Target | `--dot`, `--include-hidden` | Include dotfiles in directory/glob scans | `false` |
| Target | `-e`, `--endpoint <url>` | Custom S3-compatible endpoint URL | `S3_ENDPOINT` / `AWS_ENDPOINT` |
| Target | `-r`, `--region <region>` | AWS region | `us-east-1` |
| S3 Meta | `--virtual-hosted-style`, `--acl`, `--storage-class`, `--request-payer` | S3 URL style, ACL, storage class, requester-pays header | AWS defaults |
| Overwrite | `-y`, `--yes`, `--overwrite` | Overwrite existing objects without prompting | Prompt (`ask`) |
| Overwrite | `--skip-existing`, `--no-overwrite` | Skip existing objects without overwriting | Prompt (`ask`) |
| Transfer | `--part-size <size>` | Multipart chunk size (`5MiB`..`5GiB`) | `5MiB` |
| Transfer | `--multipart-threshold <size>` | File size threshold to trigger multipart upload | `5MiB` |
| Transfer | `--queue-size <n>` | Concurrent multipart upload requests (`1`..`255`) | `4` |
| Transfer | `--retry <n>` | Retry attempts per request (`0`..`255`) | `3` |
| Transfer | `--link-mbps <n>` | Link speed in Mbps for bandwidth `%` telemetry | `1000` |
| Security | `--verify <full\|stat\|none>` | Post-upload integrity verification mode | `full` |
| Security | `--proxy <url>` | Explicit HTTP/HTTPS proxy URL | Env `HTTPS_PROXY`/`HTTP_PROXY` |
| Security | `-k`, `--insecure`, `--allow-invalid-certs`, `--strict-tls` | Allow or enforce strict TLS certificate checks | Strict TLS |
| Runtime | `--isolated`, `--tui`, `--dry-run`, `--json`, `-h`, `-v` | Isolated `ModuleGraph`, TUI mode, dry run, JSON report | CLI mode |

### Environment Variables

| Variable | Fallback | Purpose |
| --- | --- | --- |
| `S3_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` | Access key ID (required) |
| `S3_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` | Secret access key (required) |
| `S3_REGION` | `AWS_REGION` | Region (defaults to `us-east-1`) |
| `S3_ENDPOINT` | `AWS_ENDPOINT` | Custom S3-compatible endpoint |
| `S3_BUCKET` | `AWS_BUCKET` | Default destination bucket |
| `S3_SESSION_TOKEN` | `AWS_SESSION_TOKEN` | Temporary STS session token |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | lowercase variants | Proxy URL |
| `NO_PROXY` | `no_proxy` | Comma/space-separated proxy bypass rules |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `S3_TLS_INSECURE=1` | Set to `0` to allow invalid/self-signed certificates |

### Usage Examples

```bash
# Upload a single dump file (s3:// prefix optional; filename appended automatically)
bun run src/index.ts /dumps/CLBP_CRT_261112_01.DMP my-bucket/dumps/20261116/

# Upload multiple wildcard-matched dumps (quoted glob or bash-expanded) with proxy & self-signed TLS
./bun-s3-upload-linux-x64 /dumps/CLBP_CRT_261112_* s3://my-bucket/dumps/20261116/ --insecure --yes

# Launch interactive TUI
bun run tui
```

---

## Tool 2: Oracle Data Pump (`expdp`) Log Parser

**Location:** [`datapump-log-parser/`](./datapump-log-parser/) · [Full Documentation](./datapump-log-parser/README.md)

A lightweight, zero-dependency Python 3 CLI utility ([`parse_expdp_log.py`](./datapump-log-parser/parse_expdp_log.py)) that extracts table and partition export lines from Oracle Data Pump (`expdp`) logs and converts them into normalized UTF-8-BOM CSV reports ready for Excel, pandas, or Snowflake analysis.

### Key Capabilities

- **Zero External Dependencies**: Uses only the Python 3 standard library (`argparse`, `csv`, `re`, `sys`, `pathlib`).
- **Complete Metadata Extraction**: Captures optional log timestamps, schema names, table names, partition names, row counts, and export durations.
- **Unified Size Normalization**: Converts `B`, `KB`, `MB`, `GB`, and `TB` values into a consistent `size_mb` metric for sorting and capacity planning.

### CLI Options

| Argument / Flag | Description | Default |
| --- | --- | --- |
| `log_file` | Path to the input Oracle Data Pump (`expdp`) log file | *(required)* |
| `-o`, `--output` | Output CSV file path | `<log_file>.csv` |
| `--encoding` | Input log character encoding | `utf-8` |

### Output CSV Schema

| Column | Type | Description |
| --- | --- | --- |
| `timestamp` | string | Export log timestamp (if present) |
| `schema` | string | Oracle schema / owner name |
| `table` | string | Exported table name |
| `partition` | string | Partition name (for partitioned exports) |
| `size` | float | Raw size value reported by `expdp` |
| `unit` | string | Raw size unit (`B`, `KB`, `MB`, `GB`, `TB`) |
| `size_mb` | float | Size normalized to megabytes (`MB`) |
| `row_count` | integer | Number of rows exported |
| `duration_seconds` | integer | Elapsed export duration in seconds (if logged) |

---

## End-to-End DBA Workflow: Oracle Data Pump Audit + S3 Offload

Both tools complement each other in automated Oracle Database / RDS export pipelines:

```bash
# 1. Extract table-level metrics from the Oracle Data Pump log into CSV
python tools/datapump-log-parser/parse_expdp_log.py \
  /storage/dumps/clbp_export.log \
  -o /storage/dumps/clbp_export_summary.csv

# 2. Upload all dump files and the CSV audit report to S3 (multipart + SHA-256 verified)
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="sa-east-1"
export HTTPS_PROXY="http://proxy.corp:3000"

./bun-s3-upload-linux-x64 /storage/dumps/CLBP_CRT_* s3://db-backups-bucket/dumps/20261116/ --skip-existing
./bun-s3-upload-linux-x64 /storage/dumps/clbp_export_summary.csv s3://db-backups-bucket/dumps/20261116/ --yes
```

---

## Verification & Testing

```bash
# Validate Bun S3 Uploader types and full test suite (28 unit + integration tests)
cd tools/bun-s3-uploader
bun install
AGENT=1 bun check --no-script
bun test --check

# Validate Data Pump Log Parser CLI
cd ../datapump-log-parser
python parse_expdp_log.py --help
```
