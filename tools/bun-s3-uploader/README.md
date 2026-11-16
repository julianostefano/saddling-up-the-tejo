# Bun Native S3 Uploader

A zero-runtime-dependency S3 upload **CLI** and **TUI** built exclusively with **Bun's native APIs**:

- **`Bun.S3Client` / `S3File`**: Native AWS S3 & S3-compatible uploads, automatic Single-Part (`PutObject`) vs Multipart Upload (`S3File.writer()`), `stat()`, and `stream()`.
- **`Bun.$` (Shell)**: Cross-platform local path inspection and TUI directory browsing (`dirname`, `basename`, `ls -l`).
- **`Worker`**: Background thread computing streaming `SHA-256`, `MD5`, and AWS Multipart `ETag` via `Bun.CryptoHasher`.
- **`Bun.ModuleGraph`**: Optional isolated session execution (`--isolated`) with scoped `process.env` and deterministic `graph.dispose()` cancellation.
- **`bun check`**: Strict TypeScript verification (`AGENT=1 bun check`).

## Features

- Reads credentials from `S3_*` or `AWS_*` environment variables and reports all missing variables/parameters clearly in English.
- Analyzes local file size before uploading and automatically selects Single-Part or Multipart Upload (`>= 5 MiB` default threshold), informing the user of the chosen strategy and part count.
- Displays live **Progress (%)**, **ETA**, **Upload Speed**, **Download/Readback Speed** (during `full` SHA-256 verification), **Bandwidth utilization (`Mbps` & `%`)**, and **SHA-256 / ETag / Size** validation.
- Honors `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, and `NO_PROXY` (or `--proxy <url>`).
- Supports invalid/self-signed TLS certificates via `--insecure` (`-k`), `NODE_TLS_REJECT_UNAUTHORIZED=0`, or `S3_TLS_INSECURE=1`.
- Works both as a scriptable **CLI** (with `--json` support) and an interactive **TUI** (`--tui`).

## Environment Variables

| Variable | Fallback | Purpose |
| --- | --- | --- |
| `S3_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` | Access key ID (required) |
| `S3_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` | Secret access key (required) |
| `S3_REGION` | `AWS_REGION` | Region (defaults to `us-east-1`) |
| `S3_ENDPOINT` | `AWS_ENDPOINT` | Custom S3-compatible endpoint |
| `S3_BUCKET` | `AWS_BUCKET` | Default destination bucket |
| `S3_SESSION_TOKEN` | `AWS_SESSION_TOKEN` | Temporary session token |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | lowercase variants | Proxy URL |
| `NO_PROXY` | `no_proxy` | Comma/space-separated proxy bypass rules |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `S3_TLS_INSECURE=1` | Set to `0` to allow invalid/self-signed TLS certs |

## Usage

### CLI

```bash
# Basic upload
bun run src/index.ts ./path/to/file.bin my-bucket

# Explicit object key or s3:// URI
bun run src/index.ts ./path/to/file.bin s3://my-bucket/backups/file.bin

# Multipart tuning + proxy + invalid TLS certificates
bun run src/index.ts ./large.tar.gz my-bucket \
  --part-size 10M \
  --queue-size 4 \
  --proxy http://proxy.corp:8080 \
  --insecure \
  --verify full

# Isolated Bun.ModuleGraph session + JSON output
bun run src/index.ts ./file.bin my-bucket --isolated --json
```

### TUI

```bash
bun run tui
# or
bun run src/index.ts --tui
```

## Type Check, Tests & Linux x64 Build

```bash
AGENT=1 bun check
bun test --check
bun run build:linux-x64
```

The standalone Linux x64 executable is written to `./dist/bun-s3-upload-linux-x64` (make it executable on Linux with `chmod +x bun-s3-upload-linux-x64`).

