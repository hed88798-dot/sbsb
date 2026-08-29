from __future__ import annotations

import json
import os
import re
import subprocess
from collections import deque
from pathlib import Path, PurePosixPath

from canonical_evidence import canonical_sha256, sha256_bytes, write_canonical_json
from hermetic_pyinstaller import normalized_realpath, path_is_within, sha256_file


SCHEMA_VERSION = "code-c-msvc-runtime-dependency-request-v1"
PARSER_VERSION = "code-c-pe-import-closure-v1"
MSVC_RUNTIME_PATTERN = re.compile(
    r"^(?:msvcp140(?:_[a-z0-9]+)*|vcruntime140(?:_[a-z0-9]+)*|concrt140|"
    r"vcomp140|vcamp140|vccorlib140|atl140|mfcm?140[a-z]*)\.dll$",
    re.IGNORECASE,
)
PE_MACHINE_NAMES = {
    0x014C: "x86",
    0x8664: "x86_64",
    0xAA64: "arm64",
}


class MsvcRuntimeEvidenceError(RuntimeError):
    pass


def validate_msvc_evidence_pointers(
    manifest: dict[str, object], manifest_path: Path
) -> tuple[dict[str, object], Path]:
    try:
        pyinstaller = manifest["pyinstaller"]
        toolchain = manifest["toolchain_artifact_identities"]["pyinstaller_wheel"]
        build_context_path = Path(pyinstaller["build_context"]).resolve(strict=True)
        build_context = json.loads(build_context_path.read_text(encoding="utf-8"))
        binding = build_context["inputs"]["build_environment_manifest"]
        context_pyinstaller = build_context["inputs"]["pyinstaller_artifact"]
        build_settings = build_context["inputs"]["build_settings"]
        target = build_context["inputs"]["target"]
        specification = build_context["inputs"]["specification"]
    except (KeyError, TypeError, OSError, json.JSONDecodeError) as error:
        raise MsvcRuntimeEvidenceError(
            "required production PyInstaller evidence pointer is missing or unreadable"
        ) from error

    if (
        binding.get("sha256") != sha256_file(manifest_path)
        or binding.get("build_environment_manifest_id")
        != manifest.get("build_environment_manifest_id")
    ):
        raise MsvcRuntimeEvidenceError("PyInstaller pointer Build Context binding failed")
    if (
        context_pyinstaller.get("filename") != toolchain.get("filename")
        or context_pyinstaller.get("sha256") != toolchain.get("sha256")
        or context_pyinstaller.get("version") != toolchain.get("version")
        or pyinstaller.get("version") != toolchain.get("version")
    ):
        raise MsvcRuntimeEvidenceError("PyInstaller artifact reference binding failed")
    if (
        target.get("os") != "windows"
        or target.get("architecture") != "x86_64"
        or build_settings.get("onefile") is not True
        or specification.get("sha256") != pyinstaller.get("spec_sha256")
    ):
        raise MsvcRuntimeEvidenceError("PyInstaller artifact usage binding is not this Worker build")
    try:
        if (
            normalized_realpath(build_settings["workpath"])
            != normalized_realpath(pyinstaller["workpath"])
            or normalized_realpath(build_settings["distpath"])
            != normalized_realpath(pyinstaller["distpath"])
        ):
            raise MsvcRuntimeEvidenceError(
                "PyInstaller artifact usage binding is not this Worker build"
            )
    except (KeyError, OSError) as error:
        raise MsvcRuntimeEvidenceError("PyInstaller build-path usage binding failed") from error
    for pointer in (
        "selected_evidence",
        "msvc_runtime_evidence",
        "msvc_runtime_approval_request",
    ):
        value = pyinstaller.get(pointer)
        if not isinstance(value, str) or not value:
            raise MsvcRuntimeEvidenceError(f"required PyInstaller evidence pointer is missing: {pointer}")
    return build_context, build_context_path


def normalize_runtime_name(value: str) -> str | None:
    name = PurePosixPath(value.replace("\\", "/")).name.lower()
    return name if MSVC_RUNTIME_PATTERN.fullmatch(name) else None


def _decode(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _version_resources(pe: object) -> dict[str, str | None]:
    values: dict[str, str] = {}
    for group in getattr(pe, "FileInfo", []) or []:
        entries = group if isinstance(group, list) else [group]
        for entry in entries:
            if _decode(getattr(entry, "Key", "")) != "StringFileInfo":
                continue
            for table in getattr(entry, "StringTable", []) or []:
                for key, value in getattr(table, "entries", {}).items():
                    values[_decode(key)] = _decode(value)
    return {
        "company_name": values.get("CompanyName"),
        "file_description": values.get("FileDescription"),
        "file_version": values.get("FileVersion"),
        "product_name": values.get("ProductName"),
        "product_version": values.get("ProductVersion"),
    }


def read_pe_facts(path: Path) -> dict[str, object]:
    try:
        import pefile
    except ImportError as error:
        raise MsvcRuntimeEvidenceError("locked Windows PE parser dependency is unavailable") from error

    try:
        pe = pefile.PE(str(path), fast_load=False)
    except Exception as error:
        raise MsvcRuntimeEvidenceError(f"cannot parse selected native as PE: {path}") from error
    try:
        imports = set()
        for entry in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []) or []:
            imports.add(_decode(entry.dll))
        for entry in getattr(pe, "DIRECTORY_ENTRY_DELAY_IMPORT", []) or []:
            imports.add(_decode(entry.dll))
        machine_code = int(pe.FILE_HEADER.Machine)
        machine = PE_MACHINE_NAMES.get(machine_code, f"UNKNOWN_0x{machine_code:04x}")
        return {
            "machine": machine,
            "machine_code": f"0x{machine_code:04x}",
            "imports": sorted(imports, key=str.lower),
            "version_resource": _version_resources(pe),
            "authenticode_directory_present": bool(
                pe.OPTIONAL_HEADER.DATA_DIRECTORY[
                    pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]
                ].Size
            ),
        }
    except Exception as error:
        raise MsvcRuntimeEvidenceError(f"cannot inspect selected PE metadata: {path}") from error
    finally:
        pe.close()


def read_authenticode_metadata(path: Path, system_root: Path) -> dict[str, object]:
    powershell = system_root / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if not powershell.is_file():
        raise MsvcRuntimeEvidenceError(f"Windows Authenticode probe is unavailable: {powershell}")
    environment = dict(os.environ)
    environment["CODE_C_SIGNATURE_TARGET"] = str(path)
    command = (
        "$s=Get-AuthenticodeSignature -LiteralPath $env:CODE_C_SIGNATURE_TARGET;"
        "$c=$s.SignerCertificate;"
        "[pscustomobject]@{status=[string]$s.Status;status_message=$s.StatusMessage;"
        "signer_subject=$(if($c){$c.Subject}else{$null});"
        "signer_issuer=$(if($c){$c.Issuer}else{$null});"
        "signer_thumbprint=$(if($c){$c.Thumbprint}else{$null})}|ConvertTo-Json -Compress"
    )
    result = subprocess.run(
        [str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        env=environment,
        shell=False,
        check=False,
        capture_output=True,
    )
    if result.returncode:
        raise MsvcRuntimeEvidenceError(
            f"Authenticode probe failed for {path}: "
            + result.stderr.decode("utf-8", errors="replace").strip()
        )
    try:
        document = json.loads(result.stdout.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MsvcRuntimeEvidenceError(f"Authenticode probe emitted invalid JSON: {path}") from error
    if not isinstance(document, dict):
        raise MsvcRuntimeEvidenceError(f"Authenticode probe emitted a non-object result: {path}")
    return {
        **document,
        "probe": {
            "kind": "WINDOWS_POWERSHELL_GET_AUTHENTICODE_SIGNATURE",
            "executable": str(powershell),
            "executable_sha256": sha256_file(powershell),
            "shell": False,
        },
    }


def _selected_node_key(entry: dict[str, object]) -> str:
    return str(entry["internal_path"]).lower()


def build_import_closure(entries: list[dict[str, object]]) -> dict[str, object]:
    nodes = {_selected_node_key(entry): entry for entry in entries}
    if len(nodes) != len(entries):
        raise MsvcRuntimeEvidenceError("selected native graph contains duplicate internal paths")

    by_basename: dict[str, list[str]] = {}
    for key, entry in nodes.items():
        basename = PurePosixPath(str(entry["internal_path"])).name.lower()
        by_basename.setdefault(basename, []).append(key)

    graph: dict[str, set[str]] = {key: set() for key in nodes}
    ambiguous = []
    direct = []
    required_runtime_names = set()
    for key, entry in nodes.items():
        for imported in entry["pe"]["imports"]:
            imported_name = PurePosixPath(str(imported).replace("\\", "/")).name.lower()
            runtime_name = normalize_runtime_name(imported_name)
            if runtime_name:
                required_runtime_names.add(runtime_name)
                direct.append(
                    {
                        "importer_internal_path": entry["internal_path"],
                        "importer_selected_source_path": entry["selected_source_path"],
                        "importer_sha256": entry["sha256"],
                        "importer_owner": entry["owner"],
                        "imported_dll_name": runtime_name,
                        "relationship": "DIRECT",
                        "dependency_depth": 1,
                        "pe_architecture": entry["pe"]["machine"],
                        "import_chain": [entry["internal_path"], runtime_name],
                    }
                )
                continue
            candidates = by_basename.get(imported_name, [])
            if len(candidates) == 1:
                graph[key].add(candidates[0])
            elif len(candidates) > 1:
                ambiguous.append(
                    {
                        "importer_internal_path": entry["internal_path"],
                        "imported_dll_name": imported_name,
                        "candidate_internal_paths": sorted(
                            str(nodes[candidate]["internal_path"]) for candidate in candidates
                        ),
                    }
                )

    direct.sort(key=lambda item: (str(item["imported_dll_name"]), str(item["importer_internal_path"])))
    direct_by_node: dict[str, list[dict[str, object]]] = {}
    for relationship in direct:
        direct_by_node.setdefault(str(relationship["importer_internal_path"]).lower(), []).append(
            relationship
        )

    transitive_by_identity: dict[tuple[str, str], dict[str, object]] = {}
    for start_key, start in nodes.items():
        queue: deque[tuple[str, list[str]]] = deque([(start_key, [str(start["internal_path"])])])
        visited = {start_key}
        while queue:
            current_key, chain = queue.popleft()
            if current_key != start_key:
                for relationship in direct_by_node.get(current_key, []):
                    runtime_name = str(relationship["imported_dll_name"])
                    identity = (start_key, runtime_name)
                    candidate = {
                        "importer_internal_path": start["internal_path"],
                        "importer_selected_source_path": start["selected_source_path"],
                        "importer_sha256": start["sha256"],
                        "importer_owner": start["owner"],
                        "imported_dll_name": runtime_name,
                        "relationship": "TRANSITIVE",
                        "dependency_depth": len(chain),
                        "pe_architecture": start["pe"]["machine"],
                        "import_chain": [*chain, runtime_name],
                    }
                    previous = transitive_by_identity.get(identity)
                    if previous is None or int(candidate["dependency_depth"]) < int(
                        previous["dependency_depth"]
                    ):
                        transitive_by_identity[identity] = candidate
            for next_key in sorted(graph[current_key]):
                if next_key not in visited:
                    visited.add(next_key)
                    queue.append((next_key, [*chain, str(nodes[next_key]["internal_path"])]))

    transitive = sorted(
        transitive_by_identity.values(),
        key=lambda item: (str(item["imported_dll_name"]), str(item["importer_internal_path"])),
    )
    selected_runtime = sorted(
        {
            runtime
            for entry in entries
            for runtime in [normalize_runtime_name(str(entry["internal_path"]))]
            if runtime
        }
    )
    return {
        "status": "PASS" if not ambiguous else "FAIL",
        "selected_native_count": len(entries),
        "direct_importer_count": len({str(item["importer_internal_path"]) for item in direct}),
        "transitive_importer_count": len(
            {str(item["importer_internal_path"]) for item in transitive}
        ),
        "pyinstaller_selected_msvc_dll_family": selected_runtime,
        "pe_import_closure_required_msvc_dll_family": sorted(required_runtime_names),
        "selected_but_not_import_closure_required": sorted(
            set(selected_runtime) - required_runtime_names
        ),
        "required_but_not_pyinstaller_selected": sorted(
            required_runtime_names - set(selected_runtime)
        ),
        "direct_dependencies": direct,
        "transitive_dependencies": transitive,
        "ambiguous_selected_dependency_resolutions": ambiguous,
    }


def _approved_owner(path: Path, manifest: dict[str, object]) -> dict[str, object]:
    key = normalized_realpath(path)
    matches = [
        entry
        for entry in manifest["approved_source_file_manifest"]
        if entry["resolved_path_key"] == key
    ]
    if len(matches) == 1:
        return {
            "source_kind": matches[0]["source_kind"],
            "source_artifact_identity": matches[0]["source_artifact_identity"],
        }
    return {
        "source_kind": "UNAPPROVED_SYSTEM_COPY",
        "source_artifact_identity": None,
    }


def _render_markdown(document: dict[str, object]) -> str:
    closure = document["pe_import_closure"]
    copies = document["current_system32_copies"]
    lines = [
        "# Dependency Approval Request: Microsoft Visual C++ v14 x64 Runtime",
        "",
        f"Evidence ID: `{document['evidence_id']}`  ",
        f"Build Context: `{document['build_context']['build_context_id']}`  ",
        f"Status: `{document['status']}`",
        "",
        "## Request",
        "",
        "Approve an exact Microsoft Visual C++ v14 x64 Redistributable artifact, its redistribution/license basis, and a shared External Prerequisite Contract. The recommended deployment is installer-level prerequisite installation and detection. App-local embedding is not approved by this request.",
        "",
        "## Import closure",
        "",
        f"Direct importers: `{closure['direct_importer_count']}`  ",
        f"Transitive importers: `{closure['transitive_importer_count']}`",
        "",
        "Required DLL family:",
        "",
    ]
    lines.extend(f"- `{name}`" for name in closure["pe_import_closure_required_msvc_dll_family"])
    lines.extend(["", "PyInstaller-selected DLL family:", ""])
    lines.extend(f"- `{name}`" for name in closure["pyinstaller_selected_msvc_dll_family"])
    lines.extend(["", "### Direct importer graph", ""])
    for dependency in closure["direct_dependencies"]:
        lines.append(
            f"- `{' -> '.join(dependency['import_chain'])}` "
            f"(importer SHA-256 `{dependency['importer_sha256']}`; "
            f"PE `{dependency['pe_architecture']}`)"
        )
    lines.extend(["", "### Transitive importer graph", ""])
    if closure["transitive_dependencies"]:
        for dependency in closure["transitive_dependencies"]:
            lines.append(
                f"- `{' -> '.join(dependency['import_chain'])}` "
                f"(root importer SHA-256 `{dependency['importer_sha256']}`; "
                f"PE `{dependency['pe_architecture']}`)"
            )
    else:
        lines.append("- None")
    lines.extend(["", "## Current System32 copies (rejected)", ""])
    for copy in copies:
        version = copy["pe"]["version_resource"]
        signature = copy["signature"]
        lines.extend(
            [
                f"- `{copy['absolute_source_path']}`",
                f"  - SHA-256: `{copy['sha256']}`",
                f"  - PE machine: `{copy['pe']['machine']}`",
                f"  - File version: `{version.get('file_version') or 'NOT_EMITTED'}`",
                f"  - Product version: `{version.get('product_version') or 'NOT_EMITTED'}`",
                f"  - Company: `{version.get('company_name') or 'NOT_EMITTED'}`",
                f"  - Authenticode status: `{signature.get('status')}`",
                f"  - Signer: `{signature.get('signer_subject') or 'NOT_EMITTED'}`",
                "  - Provenance: `UNAPPROVED_SYSTEM_COPY`",
            ]
        )
    lines.extend(
        [
            "",
            "## Contract capability",
            "",
            "`CONTRACT_EXTENSION_REQUIRED` — Packaging Selection Evidence v1 requires authoritative raw native entries and selected native entries to be identical, while Native Reconciliation v3 requires each selected entry to materialize. Neither contract can bind an approved external prerequisite while excluding its bytes from the internal CArchive.",
            "",
            "## Safety disposition",
            "",
            "The observed System32 copies remain rejected. They cannot be approved by basename, signature metadata, version resources, or byte equality with another artifact. Removing them from PyInstaller by basename before prerequisite approval is also prohibited because it could create a non-runnable Worker. The Worker build remains blocked pending Code F dependency, license, contract, and release approval plus installer-owner implementation.",
            "",
        ]
    )
    return "\n".join(lines)


def capture_msvc_runtime_dependency_request(
    binaries: object,
    manifest: dict[str, object],
    manifest_path: Path,
    output_json: Path,
    output_markdown: Path,
) -> dict[str, object]:
    build_context, build_context_path = validate_msvc_evidence_pointers(
        manifest, manifest_path
    )

    selected = []
    parse_failures = []
    for index, item in enumerate(binaries):
        if not isinstance(item, (tuple, list)) or len(item) != 3:
            parse_failures.append(f"Analysis.binaries[{index}] is not a three-field entry")
            continue
        destination, source, category = item
        if category not in {"BINARY", "EXTENSION"}:
            continue
        source_path = Path(source)
        try:
            selected.append(
                {
                    "internal_path": str(destination).replace("\\", "/"),
                    "selected_source_path": str(source_path),
                    "sha256": sha256_file(source_path),
                    "owner": _approved_owner(source_path, manifest),
                    "pe": read_pe_facts(source_path),
                }
            )
        except (OSError, MsvcRuntimeEvidenceError) as error:
            parse_failures.append(f"{destination}: {error}")
    closure = build_import_closure(selected)

    system_root = Path(os.environ.get("SystemRoot") or os.environ.get("WINDIR") or "")
    system32 = system_root / "System32"
    copies = []
    for entry in selected:
        runtime_name = normalize_runtime_name(str(entry["internal_path"]))
        source = Path(str(entry["selected_source_path"]))
        if runtime_name and source.is_file() and path_is_within(source, system32):
            copies.append(
                {
                    "dll_name": runtime_name,
                    "absolute_source_path": str(source),
                    "sha256": entry["sha256"],
                    "actual_selected_source": True,
                    "source_provenance": "UNAPPROVED_SYSTEM_COPY",
                    "pe": entry["pe"],
                    "signature": read_authenticode_metadata(source, system_root),
                }
            )
    copies.sort(key=lambda item: str(item["dll_name"]))

    unapproved_selected_runtime = [
        entry
        for entry in selected
        if normalize_runtime_name(str(entry["internal_path"]))
        and entry["owner"]["source_kind"] == "UNAPPROVED_SYSTEM_COPY"
    ]

    unexpected_architectures = [
        {
            "internal_path": entry["internal_path"],
            "selected_source_path": entry["selected_source_path"],
            "pe_architecture": entry["pe"]["machine"],
        }
        for entry in selected
        if entry["pe"]["machine"] != "x86_64"
    ]
    status = "READY"
    if parse_failures or closure["status"] != "PASS" or not closure[
        "pe_import_closure_required_msvc_dll_family"
    ] or unexpected_architectures or len(copies) != len(unapproved_selected_runtime):
        status = "INCOMPLETE"
    identity = {
        "schema_version": SCHEMA_VERSION,
        "parser": {"name": PARSER_VERSION, "pefile_version": _pefile_version()},
        "build_context": {
            "build_context_id": build_context["build_context_id"],
            "code_c_commit": build_context["inputs"]["code_c_commit"],
            "sha256": sha256_file(build_context_path),
        },
        "build_environment": {
            "build_environment_manifest_id": manifest["build_environment_manifest_id"],
            "sha256": sha256_file(manifest_path),
        },
        "dependency_type": "EXTERNAL_WINDOWS_RUNTIME_PREREQUISITE",
        "runtime_family": "Microsoft Visual C++ v14 x64 Runtime",
        "ambient_toolchain_contamination": "RESOLVED",
        "msvc_runtime_dependency": "PROVISIONALLY_CONFIRMED_PENDING_CODE_F_APPROVAL",
        "current_system32_copy_status": "REJECTED",
        "recommended_deployment": "INSTALLER_LEVEL_PREREQUISITE",
        "app_local_embedding": "NOT_APPROVED",
        "current_worker_packaging": "BLOCKED",
        "pyinstaller_selected_msvc_dlls": [
            {
                "internal_path": entry["internal_path"],
                "selected_source_path": entry["selected_source_path"],
                "sha256": entry["sha256"],
                "owner": entry["owner"],
                "pe_architecture": entry["pe"]["machine"],
            }
            for entry in selected
            if normalize_runtime_name(str(entry["internal_path"]))
        ],
        "selected_pe_import_graph": selected,
        "pe_import_closure": closure,
        "current_system32_copies": copies,
        "unapproved_selected_runtime_count": len(unapproved_selected_runtime),
        "captured_system32_runtime_count": len(copies),
        "parse_failures": parse_failures,
        "unexpected_pe_architectures": unexpected_architectures,
        "external_prerequisite_contract_capability": {
            "status": "CONTRACT_EXTENSION_REQUIRED",
            "packaging_selection_evidence_v1": (
                "authoritative_native_entries must equal selected_native_entries"
            ),
            "native_reconciliation_v3": (
                "every selected native must map to a materialized native entry"
            ),
            "missing_relationship": (
                "RAW_SELECTED_TO_APPROVED_EXTERNAL_PREREQUISITE_TO_INTERNAL_EXCLUSION"
            ),
        },
        "qicr_required": "YES",
        "owner_of_next_fix": "CODE_F_DEPENDENCY_AND_RELEASE_APPROVAL",
    }
    evidence_id = f"code-c-msvc-runtime-{canonical_sha256(identity)[:32]}"
    document = {**identity, "evidence_id": evidence_id, "status": status}
    write_canonical_json(output_json, document)
    markdown = _render_markdown(document).encode("utf-8")
    output_markdown.parent.mkdir(parents=True, exist_ok=True)
    output_markdown.write_bytes(markdown)
    if sha256_file(output_markdown) != sha256_bytes(markdown):
        raise MsvcRuntimeEvidenceError("MSVC dependency request Markdown byte verification failed")
    return document


def _pefile_version() -> str:
    import pefile

    return str(pefile.__version__)
