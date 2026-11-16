# Oracle Data Pump (`expdp`) Log Parser

[← Tools Index](../README.md) · [Repository Root](../../README.md)

A lightweight, zero-dependency Python CLI utility that parses Oracle Data Pump export (`expdp`) log files and extracts table and partition metrics into a clean, normalized CSV report.

## Features

- Zero external dependencies (Python 3 standard library only).
- Parses standard `expdp` export summary lines, including optional timestamps, partition names, and elapsed durations.
- Automatically normalizes exported data sizes across `B`, `KB`, `MB`, `GB`, and `TB` into a unified `size_mb` column for downstream spreadsheet or SQL analysis.
- Outputs UTF-8 with BOM (`utf-8-sig`) for seamless opening in Microsoft Excel as well as pandas / DuckDB / Snowflake ingestion.

## Usage

```bash
python parse_expdp_log.py <log_file> [-o OUTPUT] [--encoding ENCODING]
```

### Options

| Argument / Flag | Description | Default |
| --- | --- | --- |
| `log_file` | Path to the input Oracle Data Pump (`expdp`) log file | *(required)* |
| `-o`, `--output` | Destination path for the generated CSV file | `<log_file>.csv` |
| `--encoding` | Character encoding of the input log file | `utf-8` |

### Examples

```bash
# Parse an expdp log and write export_prod.csv alongside it
python parse_expdp_log.py export_prod.log

# Specify a custom CSV destination and Latin-1 encoding
python parse_expdp_log.py expdp_legacy.log -o reports/tables.csv --encoding latin-1
```

## Output CSV Schema

| Column | Type | Description |
| --- | --- | --- |
| `timestamp` | string | Log line timestamp (if present in the log line) |
| `schema` | string | Oracle schema / owner name |
| `table` | string | Exported table name |
| `partition` | string | Partition name (if exported at partition level) |
| `size` | float | Raw size value reported by `expdp` |
| `unit` | string | Raw size unit (`B`, `KB`, `MB`, `GB`, `TB`) |
| `size_mb` | float | Size normalized to megabytes (`MB`) |
| `row_count` | integer | Number of exported rows |
| `duration_seconds` | integer | Elapsed export duration in seconds (if logged) |
