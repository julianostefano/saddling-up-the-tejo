#!/usr/bin/env python3
"""Oracle Data Pump (expdp) log parser for structured CSV export."""

import argparse
import csv
import re
import sys
from pathlib import Path

# Matches Oracle Data Pump export lines such as:
# 13-NOV-26 13:18:57.635: . . exported "SCHEMA"."TABLE" 1.899 MB 36806 rows in 1 seconds
LOG_LINE_PATTERN = re.compile(
    r"^(?:(?P<timestamp>\d{2}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?):\s+)?"
    r"\.\s+\.\s+exported\s+"
    r'"(?P<schema>[^"]+)"\."(?P<table>[^"]+)"(?::"(?P<partition>[^"]+)")?\s+'
    r"(?P<size>\d+(?:\.\d+)?)\s+(?P<unit>[KMGT]?B)\s+"
    r"(?P<row_count>\d+)\s+rows?"
    r"(?:\s+in\s+(?P<duration_seconds>\d+)\s+seconds?)?\s*$"
)

UNIT_TO_MB = {
    "B": 1 / (1024 * 1024),
    "KB": 1 / 1024,
    "MB": 1.0,
    "GB": 1024.0,
    "TB": 1024.0 * 1024.0,
}

CSV_HEADERS = [
    "timestamp",
    "schema",
    "table",
    "partition",
    "size",
    "unit",
    "size_mb",
    "row_count",
    "duration_seconds",
]


def parse_expdp_log(log_path: Path, csv_path: Path, encoding: str = "utf-8") -> int:
    """Read an Oracle Data Pump log file and write exported table metrics to a CSV file."""
    rows_written = 0

    with (
        log_path.open("r", encoding=encoding, errors="replace") as log_file,
        csv_path.open("w", newline="", encoding="utf-8-sig") as csv_file,
    ):
        writer = csv.DictWriter(csv_file, fieldnames=CSV_HEADERS)
        writer.writeheader()

        for line in log_file:
            match = LOG_LINE_PATTERN.match(line.strip())
            if not match:
                continue

            data = match.groupdict()
            size_value = float(data["size"])
            size_mb = round(size_value * UNIT_TO_MB[data["unit"]], 4)

            writer.writerow(
                {
                    "timestamp": data["timestamp"] or "",
                    "schema": data["schema"],
                    "table": data["table"],
                    "partition": data["partition"] or "",
                    "size": data["size"],
                    "unit": data["unit"],
                    "size_mb": size_mb,
                    "row_count": int(data["row_count"]),
                    "duration_seconds": data["duration_seconds"] or "",
                }
            )
            rows_written += 1

    return rows_written


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract exported table entries from an Oracle Data Pump (expdp) log into CSV."
    )
    parser.add_argument("log_file", type=Path, help="Path to the input expdp log file.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output CSV path (default: input filename with .csv extension).",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8",
        help="Input log file character encoding (default: utf-8).",
    )

    args = parser.parse_args()
    if not args.log_file.is_file():
        print(f"Error: file not found: {args.log_file}", file=sys.stderr)
        return 1

    output_path = args.output or args.log_file.with_suffix(".csv")
    count = parse_expdp_log(args.log_file, output_path, encoding=args.encoding)
    print(f"Done: {count} row(s) exported to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
