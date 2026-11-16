#!/usr/bin/env python3
"""Parser de log do Oracle Data Pump (expdp) para exportação em CSV."""

import argparse
import csv
import re
import sys
from pathlib import Path

# Captura linhas no formato:
# 13-NOV-26 13:18:57.635: . . exported "ESQUEMA"."TABELA" 1.899 MB 36806 rows in 1 seconds
LOG_LINE_PATTERN = re.compile(
    r"^(?:(?P<data_hora>\d{2}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?):\s+)?"
    r"\.\s+\.\s+exported\s+"
    r'"(?P<esquema>[^"]+)"\."(?P<tabela>[^"]+)"(?::"(?P<particao>[^"]+)")?\s+'
    r"(?P<tamanho>\d+(?:\.\d+)?)\s+(?P<unidade>[KMGT]?B)\s+"
    r"(?P<total_linhas>\d+)\s+rows?"
    r"(?:\s+in\s+(?P<tempo_segundos>\d+)\s+seconds?)?\s*$"
)

UNIT_TO_MB = {
    "B": 1 / (1024 * 1024),
    "KB": 1 / 1024,
    "MB": 1.0,
    "GB": 1024.0,
    "TB": 1024.0 * 1024.0,
}

CSV_HEADERS = [
    "data_hora",
    "esquema",
    "tabela",
    "particao",
    "tamanho",
    "unidade",
    "tamanho_mb",
    "total_linhas",
    "tempo_segundos",
]


def parse_expdp_log(log_path: Path, csv_path: Path, encoding: str = "utf-8") -> int:
    """Lê o arquivo de log do Data Pump e grava as linhas de tabelas exportadas em CSV."""
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
            size_value = float(data["tamanho"])
            size_mb = round(size_value * UNIT_TO_MB[data["unidade"]], 4)

            writer.writerow(
                {
                    "data_hora": data["data_hora"] or "",
                    "esquema": data["esquema"],
                    "tabela": data["tabela"],
                    "particao": data["particao"] or "",
                    "tamanho": data["tamanho"],
                    "unidade": data["unidade"],
                    "tamanho_mb": size_mb,
                    "total_linhas": int(data["total_linhas"]),
                    "tempo_segundos": data["tempo_segundos"] or "",
                }
            )
            rows_written += 1

    return rows_written


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extrai tabelas exportadas de um log do Oracle Data Pump (expdp) para CSV."
    )
    parser.add_argument("log_file", type=Path, help="Caminho para o arquivo de log do expdp.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Caminho do CSV de saída (padrão: mesmo nome do log com extensão .csv).",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8",
        help="Codificação do arquivo de log de entrada (padrão: utf-8).",
    )

    args = parser.parse_args()
    if not args.log_file.is_file():
        print(f"Erro: arquivo não encontrado: {args.log_file}", file=sys.stderr)
        return 1

    output_path = args.output or args.log_file.with_suffix(".csv")
    count = parse_expdp_log(args.log_file, output_path, encoding=args.encoding)
    print(f"Concluído: {count} linha(s) exportada(s) para {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
