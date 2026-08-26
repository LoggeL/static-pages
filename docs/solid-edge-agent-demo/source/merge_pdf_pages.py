#!/usr/bin/env python3

import argparse
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge PDF page files in the given order.")
    parser.add_argument("output", type=Path)
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args()

    writer = PdfWriter()
    for input_path in args.inputs:
        if input_path.read_bytes()[:5] != b"%PDF-":
            raise ValueError(f"Input is not a PDF: {input_path}")
        for page in PdfReader(str(input_path)).pages:
            writer.add_page(page)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as stream:
        writer.write(stream)
    print(f"Merged {len(writer.pages)} pages into {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
