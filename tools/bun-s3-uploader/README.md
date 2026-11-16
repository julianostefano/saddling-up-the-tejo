# Bun Native S3 Uploader

[← Tools Index](../README.md) · [Repository Root](../../README.md)

A zero-runtime-dependency S3 upload **CLI** and **TUI** built exclusively with **Bun's native APIs**:

- **`Bun.S3Client` / `S3File`**: Native AWS S3 and S3-compatible object storage operations (`write()`, `writer()`, `exists()`, `stat()`, `stream()`).
- **`Bun.$` (Shell)**: Cross-platform path inspection (`dirname`, `basename`, `ls -l`) and interactive TUI directory browsing.
- **`Bun.Glob`**: Recursive directory uploads, wildcard pattern expansion, and automatic prefix fallback (`${path}*`).
- **`Worker` + `Bun.CryptoHasher`**: Off-main-thread streaming `SHA-256`, `MD5`, and AWS S3 multipart `ETag` computation.
- **`Bun.ModuleGraph`**: Optional isolated upload execution (`--isolated`) with scoped `process.env` and deterministic `graph.dispose()` cancellation.
- **`bun check`**: Strict TypeScript verification (`AGENT=1 bun check`).

## Features

- **Environment & Target Validation**: Reads `S3_*` credentials with automatic fallback to `AWS_*` (`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`, `ENDPOINT`, `BUCKET`, `SESSION_TOKEN`) and reports all missing required settings in English before starting.
- **Smart Target Normalization**: Accepts `s3://bucket/prefix/`, bare `bucket/prefix/`, or `<bucket> <key>` arguments; automatically appends the filename when uploading a single file to a folder-like prefix.
- **Wildcards & Recursive Directories**: Supports quoted globs (`"./logs/**/*.log"`), bash-expanded multi-file positional arguments (`./dumps/CLBP_* s3://bucket/prefix/`), recursive directory uploads, and repeatable `-f`/`--file` flags.
- **Overwrite Protection**: Checks `s3File.exists()` and `s3File.stat()` prior to upload and prompts `[y]es / [N]o (skip) / [a]ll / [s]kip all / [q]uit` in interactive CLI/TUI sessions, with `-y`/`--yes`/`--overwrite` and `--skip-existing`/`--no-overwrite` flags for non-interactive automation.
- **Adaptive Single-Part vs. Multipart Upload**: Analyzes file size against `--multipart-threshold` (default `5 MiB`) and selects Single-Part `PutObject` or concurrent Multipart Upload (`S3File.writer()`) with configurable `--part-size`, `--queue-size`, and `--retry`.
- **Live Telemetry & Integrity Verification**: Displays real-time **Progress (%)**, **ETA**, **Upload Speed**, **Download/Readback Speed**, **Bandwidth Utilization (`Mbps` & `%`)**, and **SHA-256 / ETag / Size** validation—including **SSE-KMS** multipart buckets where server-encrypted part digests match part count and pass full streaming `SHA-256` verification.
- **Proxy & Invalid TLS Support**: Honors `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, and `NO_PROXY` (wildcards, domains, `host:port`, IPv4 CIDRs) or `--proxy <url>`, plus `--insecure` (`-k`) / `NODE_TLS_REJECT_UNAUTHORIZED=0` for self-signed or untrusted TLS certificates.
- **Standalone Cross-Compilation**: Compiles to a self-contained Linux x64 binary bundling the main CLI, Worker, and isolated `ModuleGraph` entrypoints.

## Environment Variables

| Variable | Fallback | Purpose |
| --- | --- | --- |
| `S3_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` | Access key ID (required) |
| `S3_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` | Secret access key (required) |
| `S3_REGION` | `AWS_REGION` | AWS region (defaults to `us-east-1`) |
| `S3_ENDPOINT` | `AWS_ENDPOINT` | Custom S3-compatible endpoint URL |
| `S3_BUCKET` | `AWS_BUCKET` | Default destination bucket |
| `S3_SESSION_TOKEN` | `AWS_SESSION_TOKEN` | Temporary session token |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | lowercase variants | HTTP/HTTPS proxy URL |
| `NO_PROXY` | `no_proxy` | Comma/space-separated bypass rules |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `S3_TLS_INSECURE=1` | Set to `0` to allow invalid/self-signed TLS certificates |

## Usage

### CLI

```bash
# Single file upload (with or without explicit s3:// prefix)
bun run src/index.ts ./backup.dmp my-bucket/dumps/20261116/
bun run src/index.ts ./backup.dmp s3://my-bucket/dumps/20261116/backup.dmp

# Wildcard (quoted glob or shell-expanded) and recursive directory upload
bun run src/index.ts "./logs/**/*.log" my-bucket --prefix app-logs --skip-existing
bun run src/index.ts ./dist my-bucket/releases/v1/ --yes

# Multipart tuning + corporate proxy + self-signed TLS certificates
bun run src/index.ts ./large.tar.gz my-bucket \
  --part-size 10M \
  --queue-size 4 \
  --proxy http://proxy.corp:8080 \
  --insecure \
  --verify full

# Isolated Bun.ModuleGraph session + JSON report
bun run src/index.ts ./file.bin my-bucket --isolated --json
```

### Interactive TUI

```bash
bun run tui
# or
bun run src/index.ts --tui
```

## Type Check, Tests & Linux x64 Build

```bash
bun install
AGENT=1 bun check --no-script
bun test --check
bun run build:linux-x64
```

The standalone Linux x64 executable is written to `./dist/bun-s3-upload-linux-x64` (`chmod +x bun-s3-upload-linux-x64`).
