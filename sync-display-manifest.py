#!/usr/bin/env python3
"""Sync SnowBirds display manifest from the shared Snowflake FLOCK table."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time


QUERY = """
SELECT
  BIRD_ID,
  ARTIST_NAME,
  ORIGIN_CITY,
  SPECIES,
  PERSONALITY,
  IMAGE_FILENAME,
  IMAGE_DATA_URL,
  TO_JSON(ANIMATION_JSON) AS ANIMATION_JSON,
  CREATED_AT
FROM DATA_BIRDS_DB.AVIARY.FLOCK
ORDER BY CREATED_AT ASC
LIMIT 500
""".strip()


def parse_animation(value):
    if isinstance(value, dict):
        return value
    if not value:
        return {
            "css_keyframes": "@keyframes fly_fallback { 0% { transform: translate(-20vw, 50vh); } 100% { transform: translate(120vw, 50vh); } }",
            "animation_name": "fly_fallback",
            "duration": "20s",
            "timing_function": "linear",
        }
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return parse_animation(None)


def fetch_rows(connection: str):
    result = subprocess.run(
        ["snow", "sql", "-c", connection, "-q", QUERY, "--format", "json"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip())

    output = result.stdout.strip()
    start = output.find("[")
    if start > 0:
        output = output[start:]
    return json.loads(output or "[]")


def image_is_displayable(image: str, root: pathlib.Path) -> bool:
    if not image:
        return False
    if image.startswith("data:image/"):
        return True
    if image.startswith(("http://", "https://")):
        return True
    return (root / image).is_file()


def existing_manifest(manifest_path: pathlib.Path):
    if not manifest_path.exists():
        return []
    try:
        data = json.loads(manifest_path.read_text() or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    root = manifest_path.parent
    return [entry for entry in data if image_is_displayable(str(entry.get("image") or ""), root)]


def write_manifest(connection: str, manifest_path: pathlib.Path):
    root = manifest_path.parent
    by_id = {entry.get("id"): entry for entry in existing_manifest(manifest_path) if entry.get("id")}

    rows = fetch_rows(connection)
    for row in rows:
        filename = row.get("IMAGE_FILENAME") or ""
        image = row.get("IMAGE_DATA_URL") or (f"birds/{filename}" if filename else "")
        if not image_is_displayable(image, root):
            continue
        by_id[row.get("BIRD_ID")] = {
            "id": row.get("BIRD_ID"),
            "image": image,
            "bird_name": row.get("ARTIST_NAME") or "Anonymous",
            "origin": row.get("ORIGIN_CITY") or "",
            "species": row.get("SPECIES") or "Mystery Bird",
            "personality": row.get("PERSONALITY") or "A free spirit",
            "animation": parse_animation(row.get("ANIMATION_JSON")),
        }

    manifest = list(by_id.values())
    tmp = manifest_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2) + "\n")
    tmp.replace(manifest_path)
    return len(manifest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--connection", default=os.environ.get("SNOWFLAKE_CONNECTION", "databirds"))
    parser.add_argument("--manifest", default="manifest.json")
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    manifest_path = pathlib.Path(args.manifest)

    while True:
        try:
            count = write_manifest(args.connection, manifest_path)
            print(f"Synced {count} bird(s) from Snowflake to {manifest_path}", flush=True)
        except Exception as exc:
            print(f"warning: display sync failed: {exc}", file=sys.stderr, flush=True)
            if args.once:
                return 1

        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
