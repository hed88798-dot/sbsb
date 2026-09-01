from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from canonical_evidence import write_canonical_json


SUBJECTS = {
    "linux-runtime": "b6397a493afb9c555dde18a5c44947aee88692cf837f84f226bb9cdab451e9f2",
    "linux-worker-build": "de1538e8753bbee056f238f6483d3f9d080eb018ec74b5f5926a58a078fcf56c",
    "windows-runtime": "5d7cd9e0e93af5606f33af97d54588f1fdfb9949089c658e62ad5b185f0cce8a",
    "windows-worker-build": "c7ed5092c627fdbad3d28c7cd85246a03c1cacbbb65664c377fce94d23de7cc7",
    "linux-toolchain": "4e6a5e8a7b5ef245124ff188f8c2a74cba61a4ce37cfc8e4b2a6079f6fd4f95f",
    "windows-toolchain": "f19a6ef7a06bcfe2f804afb0f61c2f04fa4bc8638d5af61e8262f8e7c4fa5f88",
}
TARGETS = {
    "linux": "2b71b8be5739e2ef139ac4e6d3e15a6bdd7dd1805484ce227dbfcf094a36da67",
    "windows": "713f76e0a170611b00700e3a9705a6046b0f0f5869836420b51e342e8233d418",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--target", choices=["linux", "windows"], required=True)
    arguments = parser.parse_args()
    candidates: dict[str, list[Path]] = {key: [] for key in SUBJECTS}
    target_descriptors: dict[str, list[Path]] = {key: [] for key in TARGETS}
    for path in arguments.bundle_root.rglob("*.json"):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        digest = sha256(path)
        for key, expected in SUBJECTS.items():
            if digest == expected:
                candidates[key].append(path)
        for target, expected in TARGETS.items():
            if digest == expected or document.get("target_descriptor_id", "").startswith(
                f"code-c-{target}-"
            ):
                if digest == expected:
                    target_descriptors[target].append(path)
    for key, matches in candidates.items():
        if len(matches) != 1:
            raise SystemExit(f"approved subject {key} was not uniquely found in bundle ({len(matches)})")
    for target, matches in target_descriptors.items():
        if len(matches) != 1:
            raise SystemExit(f"approved target descriptor {target} was not uniquely found ({len(matches)})")

    output = arguments.output_root.resolve()
    output.mkdir(parents=True, exist_ok=True)
    subject_output: dict[str, str] = {}
    for key, source in sorted((key, paths[0]) for key, paths in candidates.items()):
        destination = output / f"{key}.json"
        shutil.copyfile(source, destination)
        if sha256(destination) != SUBJECTS[key]:
            raise SystemExit(f"approved subject bytes changed while copied: {key}")
        subject_output[key] = str(destination)
    descriptor_output: dict[str, str] = {}
    for target, source in sorted((target, paths[0]) for target, paths in target_descriptors.items()):
        destination = output / f"{target}-target-descriptor.json"
        shutil.copyfile(source, destination)
        if sha256(destination) != TARGETS[target]:
            raise SystemExit(f"approved target descriptor bytes changed while copied: {target}")
        descriptor_output[target] = str(destination)
    result = {
        "schema_version": "1",
        "status": "PASS",
        "subjects": subject_output,
        "target_descriptors": descriptor_output,
        "approved_subject_sha256": SUBJECTS,
        "approved_target_descriptor_sha256": TARGETS,
    }
    write_canonical_json(output / "approved-inputs.json", result)
    print(f"approved-build-inputs: PASS ({len(subject_output)} subjects; 2 target descriptors)")


if __name__ == "__main__":
    main()
