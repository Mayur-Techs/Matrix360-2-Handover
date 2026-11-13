from __future__ import annotations

import csv
from pathlib import Path

from .models import CompanySeed


def read_seeds(path: Path, limit: int | None = None) -> list[CompanySeed]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = [CompanySeed(**row) for row in csv.DictReader(handle)]
    return rows[:limit] if limit else rows


def write_seeds(path: Path, seeds: list[CompanySeed]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(CompanySeed.__dataclass_fields__))
        writer.writeheader()
        for seed in seeds:
            writer.writerow({field: getattr(seed, field) for field in CompanySeed.__dataclass_fields__})
