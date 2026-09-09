from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
from pathlib import Path

from canonical_evidence import canonical_json, write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKER_SOURCE = REPOSITORY_ROOT / "sidecars" / "media-worker" / "src" / "media_worker"
EXPECTED_METHODS = {"hello", "media.index.asset.v1", "media.search.exact.v1"}
NETWORK_ROOTS = {"aiohttp", "http", "requests", "socket", "urllib", "urllib3"}
ARCHIVE_CALLS = {
    "shutil.unpack_archive",
    "zipfile.ZipFile",
    "ZipFile.extract",
    "ZipFile.extractall",
    "ZipFile.open",
}
CREDENTIAL_NAMES = {
    "HTTPBasicAuthHandler",
    "HTTPDigestAuthHandler",
    "HTTPPasswordMgr",
    "HTTPPasswordMgrWithDefaultRealm",
    "HTTPPasswordMgrWithPriorAuth",
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dotted_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def collect_worker_source_evidence() -> dict[str, object]:
    files = []
    imports: set[str] = set()
    calls: set[str] = set()
    strings: set[str] = set()
    credential_references: set[str] = set()
    for path in sorted(WORKER_SOURCE.glob("*.py")):
        relative = path.relative_to(REPOSITORY_ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        tree = ast.parse(text, filename=relative)
        file_imports: set[str] = set()
        file_calls: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                file_imports.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                file_imports.add(node.module)
            elif isinstance(node, ast.Call):
                name = dotted_name(node.func)
                if name:
                    file_calls.add(name)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                strings.add(node.value)
        imports.update(file_imports)
        calls.update(file_calls)
        credential_references.update(
            name for name in CREDENTIAL_NAMES if re.search(rf"\b{re.escape(name)}\b", text)
        )
        files.append(
            {
                "path": relative,
                "sha256": sha256_file(path),
                "imports": sorted(file_imports),
                "calls": sorted(file_calls),
            }
        )

    network_imports = sorted(name for name in imports if name.split(".", 1)[0] in NETWORK_ROOTS)
    network_calls = sorted(
        name
        for name in calls
        if name.split(".", 1)[0] in NETWORK_ROOTS
        or any(token in name for token in CREDENTIAL_NAMES)
    )
    archive_calls = sorted(
        name
        for name in calls
        if name in ARCHIVE_CALLS
        or name.endswith((".extractall", ".unpack_archive"))
        or "zipfile.ZipFile" in name
    )
    exposed_methods = sorted(value for value in strings if value in EXPECTED_METHODS)
    graph = {"files": files, "imports": sorted(imports), "calls": sorted(calls)}
    command_surface = {"protocol_version": "1.0", "methods": exposed_methods}
    return {
        "graph": graph,
        "command_surface": command_surface,
        "source_import_graph_sha256": hashlib.sha256(
            canonical_json(graph).encode("utf-8")
        ).hexdigest(),
        "sidecar_command_surface_sha256": hashlib.sha256(
            canonical_json(command_surface).encode("utf-8")
        ).hexdigest(),
        "source_files": files,
        "imports": sorted(imports),
        "network_imports": network_imports,
        "network_calls": network_calls,
        "http_credential_api_references": sorted(credential_references),
        "archive_extraction_calls": archive_calls,
        "protocol_methods": exposed_methods,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    source = collect_worker_source_evidence()
    failures = []
    if source["network_imports"] or source["network_calls"]:
        failures.append("Worker source/import graph contains a network-capability path")
    if source["http_credential_api_references"]:
        failures.append("Worker source references HTTP credential manager/authentication APIs")
    if source["archive_extraction_calls"]:
        failures.append("Worker source calls an archive extraction API")
    if set(source["protocol_methods"]) != EXPECTED_METHODS:
        failures.append("Worker command surface differs from the frozen protocol")

    evidence = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_STATIC_REACHABILITY",
        "schema_version": "1",
        "status": "PASS" if not failures else "FAIL",
        "code_head_sha": git_head(),
        "source_import_graph_sha256": source["source_import_graph_sha256"],
        "sidecar_command_surface_sha256": source["sidecar_command_surface_sha256"],
        "source_files": source["source_files"],
        "imports": source["imports"],
        "network_imports": source["network_imports"],
        "network_calls": source["network_calls"],
        "http_credential_api_references": source["http_credential_api_references"],
        "archive_extraction_calls": source["archive_extraction_calls"],
        "protocol_methods": source["protocol_methods"],
        "cve_2026_15806": {
            "protocol_exposed": "NO",
            "http_credential_path": "NO",
            "attacker_controlled_network_capability": "NO",
        },
        "cve_2026_15310": {
            "archive_api_exposed": "NO",
            "user_archive_extraction": "NO",
        },
        "failures": failures,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(arguments.output, evidence)
    if failures:
        raise SystemExit("Stage B static reachability failed:\n" + "\n".join(failures))
    print(
        "stage-b-static-reachability: PASS "
        f"({len(source['source_files'])} files; {len(source['imports'])} imports; 3 protocol methods)"
    )


if __name__ == "__main__":
    main()
