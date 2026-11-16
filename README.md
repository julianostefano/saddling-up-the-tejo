# Saddling Up the Tejo

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Oracle Cloud Infrastructure](https://img.shields.io/badge/OCI-Terraform-F80000?logo=oracle&logoColor=white)](./oci/terraform/autonomous-db-23ai/)
[![Snowflake & Python](https://img.shields.io/badge/Analytics-Snowflake%20%7C%20Python-29B5E8?logo=snowflake&logoColor=white)](./Notebooks/)
[![Bun Native Tooling](https://img.shields.io/badge/Tooling-Bun%20%7C%20TypeScript-FBF0DF?logo=bun&logoColor=black)](./tools/bun-bucket/)

**Multicloud Database Architecture, Infrastructure as Code (IaC), Quantitative Analytics, and Operations Tooling Portfolio** — Enterprise-grade implementations spanning Oracle Cloud Infrastructure (OCI), Oracle Autonomous Database 23ai/26ai, Snowflake Cloud Data Platform, Python quantitative modeling, and native Bun/TypeScript CLI tooling.

**Author:** Juliano Stefano  
**LinkedIn:** [linkedin.com/in/julianostefano](https://www.linkedin.com/in/julianostefano/)  
**Repository:** [github.com/julianostefano/saddling-up-the-tejo](https://github.com/julianostefano/saddling-up-the-tejo)

---

## Executive Overview

**Saddling Up the Tejo** brings together practical, production-oriented engineering across three core domains:

1. **Data Analytics, Quantitative Finance & SQL Engineering** — Snowflake SQL analytical workflows with Plotly visualizations and Markowitz Mean-Variance portfolio optimization in Python.
2. **Cloud Infrastructure as Code (OCI & Terraform)** — Modular Terraform stacks for Virtual Cloud Networks (VCNs), Always Free & production Oracle Autonomous Database 23ai/26ai deployments with AI Vector Search, cloud-init compute provisioning, and OCI Resource Manager integration.
3. **Cloud & Database Operations Tooling** — Purpose-built operational utilities including `bun-bucket` (a zero-dependency native Bun S3 uploader & downloader `CLI` + `TUI`) and an Oracle Data Pump (`expdp`) log-to-CSV parser.

---

## Repository Structure

```text
saddling-up-the-tejo/
├── Notebooks/
│   ├── Risk_Analysis/                      # FAANG Markowitz Portfolio Optimization (Python & Jupyter)
│   └── Snowflake_London_Travel_Network/    # TfL passenger analytics with Snowflake SQL & Plotly
├── oci/
│   └── terraform/
│       ├── autonomous-db-23ai/             # Oracle Autonomous DB 23ai/26ai + Compute VM + Resource Manager
│       └── network-infrastructure/         # OCI VCN, subnets, gateways, route tables & security controls
├── tools/
│   ├── README.md                           # Operations tooling index & end-to-end DBA workflow
│   ├── bun-bucket/                         # Native Bun S3 Uploader & Downloader CLI/TUI
│   │   ├── src/                            # CLI, TUI, S3 uploader/downloader, Worker hasher, Shell & ModuleGraph
│   │   └── tests/                          # Unit & integration tests (mock S3, self-signed TLS, proxy)
│   └── datapump-log-parser/                # Oracle Data Pump (expdp) log parser to structured CSV
├── LICENSE                                 # MIT License
└── README.md
```

---

## Portfolio Modules

### 1. Data Analytics & Quantitative Finance (`Notebooks/`)

#### A. Exploring London's Travel Network (`Snowflake` + `Plotly`)
**Location:** [`Notebooks/Snowflake_London_Travel_Network/`](./Notebooks/Snowflake_London_Travel_Network/)

Analytical notebook exploring Transport for London (`TFL.JOURNEYS`) transit volumes in Snowflake:
- **SQL Engineering:** Aggregations, filtering, and ranking across multi-million-row transit datasets.
- **Key Findings:** Mode-by-mode popularity breakdown (Bus, Underground & DLR, Overground, TfL Rail, Tram, Emirates Airline), historical peak periods for the Emirates Airline cable car, and lowest-volume years for the Underground & DLR.
- **Visualizations:** Dark-themed horizontal bar charts in **Plotly Express** with dynamic axis padding and formatted data labels.

#### B. FAANG Portfolio Risk & Allocation Analysis (`Markowitz MPT`)
**Location:** [`Notebooks/Risk_Analysis/`](./Notebooks/Risk_Analysis/)

Quantitative portfolio optimization on historical FAANG closing prices (`faang_stocks.csv`, 2020–2023) using **Modern Portfolio Theory (MPT)** via `PyPortfolioOpt`, `NumPy`, `pandas`, and `Matplotlib`:
- **Benchmark Portfolio (1/N Equal Weight):** Annualized expected return, volatility, and Sharpe ratio ($R_f = 0\%$).
- **Minimum Volatility Portfolio:** Global minimum-variance asset allocation.
- **Maximum Sharpe Ratio Portfolio:** Tangency portfolio maximizing risk-adjusted return.
- **Visual Outputs:** 5,000-trial Monte Carlo Efficient Frontier (`efficient_frontier.png`) and strategy weight comparison (`portfolio_allocation_comparison.png`), runnable both interactively in [`notebook.ipynb`](./Notebooks/Risk_Analysis/notebook.ipynb) and standalone via [`portfolio_analysis.py`](./Notebooks/Risk_Analysis/portfolio_analysis.py).

**Quick Start:**
```bash
cd Notebooks/Risk_Analysis
python portfolio_analysis.py
```

---

### 2. Cloud Infrastructure as Code (`oci/terraform/`)

#### A. Oracle Autonomous Database 23ai/26ai + AI Vector Search
**Location:** [`oci/terraform/autonomous-db-23ai/`](./oci/terraform/autonomous-db-23ai/)

Production-ready Terraform configuration deploying an Oracle Autonomous Database 23ai/26ai Lakehouse workload with AI Vector Search support on OCI:
- **Database & Compute:** Autonomous Database (Always Free 1 OCPU / 1 TB or paid auto-scaling tiers) paired with an Oracle Linux compute VM configured via [`cloud-init.yaml`](./oci/terraform/autonomous-db-23ai/cloud-init.yaml).
- **Automated Wallet Management:** Includes [`download-wallet.sh`](./oci/terraform/autonomous-db-23ai/download-wallet.sh) for retrieving and configuring TNS connection bundles (`HIGH`, `MEDIUM`, `LOW`).
- **OCI Resource Manager Ready:** Includes [`schema.yaml`](./oci/terraform/autonomous-db-23ai/schema.yaml) for one-click UI deployment directly from GitHub.
- **Documentation:** See [`README.md`](./oci/terraform/autonomous-db-23ai/README.md) and [`QUICKSTART.md`](./oci/terraform/autonomous-db-23ai/QUICKSTART.md).

**Quick Start:**
```bash
cd oci/terraform/autonomous-db-23ai
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -var-file="terraform.tfvars"
terraform apply -var-file="terraform.tfvars"
```

#### B. OCI Network Infrastructure
**Location:** [`oci/terraform/network-infrastructure/`](./oci/terraform/network-infrastructure/)

Reusable Terraform networking foundation provisioning:
- Virtual Cloud Network (`VCN`), custom DHCP options, and DNS resolution.
- Public and private subnets with Internet Gateway, NAT Gateway, and route tables.
- Hardened Security Lists and Network Security Groups (NSGs) for database and application tiers.

---

### 3. Cloud & Database Operations Tooling (`tools/`)

**Overview & CLI Reference:** [`tools/README.md`](./tools/README.md)

#### A. Bun Bucket — Native S3 Uploader & Downloader (`CLI` & `TUI`)
**Location:** [`tools/bun-bucket/`](./tools/bun-bucket/) · [Tool README](./tools/bun-bucket/README.md)

High-performance, zero-runtime-dependency S3 upload and download utility engineered exclusively with **Bun's native APIs** (`Bun.S3Client`, `Bun.$`, `Bun.Glob`, `Worker`, `Bun.CryptoHasher`, `Bun.ModuleGraph`):
- **Single-Part & Concurrent Multipart Uploads:** Analyzes file size against `--multipart-threshold` (default `5 MiB`) and selects Single-Part `PutObject` or concurrent S3 Multipart Upload (`S3File.writer()`) with configurable `--part-size`, `--queue-size`, and `--retry`.
- **Single-Object & Wildcard S3 Downloads:** Supports downloading individual objects (`s3://bucket/key`) as well as wildcard/prefix matches (`"s3://bucket/dumps/*.DMP"`, `download bucket/site/**/*.js`) via `S3Client.prototype.list()` + `Bun.Glob`, with local overwrite protection.
- **Integrity & Telemetry:** Offloads `SHA-256`, `MD5`, and multipart `ETag` hashing to a `Worker` thread; renders live progress bars, ETA, upload/download speeds, and bandwidth utilization (`Mbps` / `%`). Handles AWS S3 **SSE-KMS** multipart ETags seamlessly alongside full streaming `SHA-256` verification (`--verify full`).
- **Batching, Normalization & Overwrite Protection:** Accepts `s3://bucket/prefix/`, bare `bucket/prefix/`, or `<bucket> <key>` targets; appends local filenames automatically when uploading to folder targets; expands wildcards (`Bun.Glob` and bash-expanded multi-file args) and recursive directories; and enforces overwrite confirmation (`[y]es / [N]o / [a]ll / [s]kip all / [q]uit`, plus `--yes` and `--skip-existing`).
- **Enterprise Networking & Standalone Compilation:** Supports `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`, invalid/self-signed TLS certificates (`-k` / `--insecure` / `NODE_TLS_REJECT_UNAUTHORIZED=0`), isolated `Bun.ModuleGraph` execution (`--isolated`), interactive TTY TUI (`--tui`), and Linux x64 cross-compilation (`bun run build:linux-x64` -> `./dist/bun-bucket-linux-x64`).

**Quick Start:**
```bash
cd tools/bun-bucket
bun install
AGENT=1 bun check --no-script
bun test --check

# Upload a file or wildcard batch (with or without explicit s3:// prefix)
bun run src/index.ts ./backup.dmp my-bucket/dumps/20261116/ --insecure
bun run src/index.ts "./dumps/*.DMP" s3://my-bucket/dumps/20261116/ --skip-existing

# Download a single file or wildcard batch from S3 (auto-detected via s3:// prefix)
bun run src/index.ts "s3://my-bucket/dumps/20261116/*.DMP" ./restore/ --skip-existing
```

#### B. Oracle Data Pump (`expdp`) Log Parser
**Location:** [`tools/datapump-log-parser/`](./tools/datapump-log-parser/) · [Tool README](./tools/datapump-log-parser/README.md)

Zero-dependency Python 3 CLI utility ([`parse_expdp_log.py`](./tools/datapump-log-parser/parse_expdp_log.py)) that extracts exported schema, table, and partition entries from Oracle Data Pump (`expdp`) logs into normalized UTF-8-BOM CSV reports (`timestamp`, `schema`, `table`, `partition`, `size`, `unit`, `size_mb`, `row_count`, `duration_seconds`) for migration auditing and capacity planning.

**Quick Start:**
```bash
cd tools/datapump-log-parser
python parse_expdp_log.py export_prod.log -o exported_tables.csv
```

#### End-to-End Oracle Data Pump Audit & S3 Offload Workflow
```bash
# 1. Generate table-level export summary CSV from expdp log
python tools/datapump-log-parser/parse_expdp_log.py /storage/dumps/clbp_export.log -o /storage/dumps/clbp_export.csv

# 2. Upload all dump files and CSV report to S3 with multipart transfer & SHA-256 verification
./bun-bucket-linux-x64 /storage/dumps/CLBP_CRT_* s3://db-backups-bucket/dumps/20261116/ --skip-existing
./bun-bucket-linux-x64 /storage/dumps/clbp_export.csv s3://db-backups-bucket/dumps/20261116/ --yes
```

---

## Module Summary

| Module | Domain | Primary Stack | Path |
| --- | --- | --- | --- |
| London Travel Network | Cloud Data Warehousing | Snowflake SQL, Python, Plotly | [`Notebooks/Snowflake_London_Travel_Network/`](./Notebooks/Snowflake_London_Travel_Network/) |
| FAANG Risk Analysis | Quantitative Finance | Python, PyPortfolioOpt, NumPy, Matplotlib | [`Notebooks/Risk_Analysis/`](./Notebooks/Risk_Analysis/) |
| Autonomous DB 23ai/26ai | Cloud IaC & Vector DB | Terraform, OCI, Oracle Linux, Bash | [`oci/terraform/autonomous-db-23ai/`](./oci/terraform/autonomous-db-23ai/) |
| Network Infrastructure | Cloud Networking IaC | Terraform, OCI VCN/NSG | [`oci/terraform/network-infrastructure/`](./oci/terraform/network-infrastructure/) |
| Bun Bucket (`bun-bucket`) | Cloud Storage CLI & TUI | Bun, TypeScript, S3Client, Workers | [`tools/bun-bucket/`](./tools/bun-bucket/) |
| Data Pump Log Parser | Database Operations | Python 3 Standard Library | [`tools/datapump-log-parser/`](./tools/datapump-log-parser/) |

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

**Juliano Stefano** — Multicloud Database & Data Engineering  
[GitHub](https://github.com/julianostefano) · [LinkedIn](https://www.linkedin.com/in/julianostefano/)
