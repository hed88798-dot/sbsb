from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
from collections import deque
from pathlib import Path, PurePosixPath

from canonical_evidence import canonical_sha256, sha256_bytes, write_canonical_json
from evidence_paths import (
    EvidencePathError,
    resolve_evidence_path,
    runtime_repository_root,
    same_filesystem_identity,
)
from hermetic_pyinstaller import normalized_realpath, path_is_within, sha256_file


SCHEMA_VERSION = "code-c-msvc-runtime-dependency-request-v2"
PARSER_VERSION = "code-c-pe-import-closure-v2"
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
WINDOWS_OS_DLL_NAMES = {
    "advapi32.dll",
    "bcrypt.dll",
    "crypt32.dll",
    "gdi32.dll",
    "kernel32.dll",
    "ntdll.dll",
    "ole32.dll",
    "oleaut32.dll",
    "rpcrt4.dll",
    "shell32.dll",
    "ucrtbase.dll",
    "user32.dll",
    "version.dll",
    "ws2_32.dll",
}
DYNAMIC_PE_APIS = {
    "loadlibrarya",
    "loadlibraryw",
    "loadlibraryexa",
    "loadlibraryexw",
    "getprocaddress",
}
DYNAMIC_PYTHON_CALLS = {
    "CDLL",
    "WinDLL",
    "ctypes.windll",
    "ctypes.WinDLL",
    "ctypes.CDLL",
    "cffi.FFI.dlopen",
}


class MsvcRuntimeEvidenceError(RuntimeError):
    pass


def validate_msvc_evidence_pointers(
    manifest: dict[str, object],
    manifest_path: Path,
    *,
    repository_root: Path,
) -> tuple[dict[str, object], Path]:
    try:
        frozen_repository_root = runtime_repository_root(
            manifest, explicit_repository_root=repository_root
        )
        pyinstaller = manifest["pyinstaller"]
        toolchain = manifest["toolchain_artifact_identities"]["pyinstaller_wheel"]
        build_context_path = resolve_evidence_path(
            pyinstaller["build_context"],
            field="build_environment.pyinstaller.build_context",
            trusted_runtime_anchors={},
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        build_context = json.loads(build_context_path.read_text(encoding="utf-8"))
        binding = build_context["inputs"]["build_environment_manifest"]
        context_pyinstaller = build_context["inputs"]["pyinstaller_artifact"]
        build_settings = build_context["inputs"]["build_settings"]
        target = build_context["inputs"]["target"]
        specification = build_context["inputs"]["specification"]
    except (EvidencePathError, KeyError, TypeError, OSError, json.JSONDecodeError) as error:
        raise MsvcRuntimeEvidenceError(
            "required production PyInstaller evidence pointer is missing or unreadable"
        ) from error

    if (
        binding.get("sha256") != sha256_file(manifest_path)
        or binding.get("build_environment_manifest_id")
        != manifest.get("build_environment_manifest_id")
    ):
        raise MsvcRuntimeEvidenceError("PyInstaller pointer Build Context binding failed")
    try:
        bound_manifest_path = resolve_evidence_path(
            binding.get("path"),
            field="build_context.inputs.build_environment_manifest.path",
            trusted_runtime_anchors={"repository_root": frozen_repository_root},
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        if not same_filesystem_identity(bound_manifest_path, manifest_path):
            raise MsvcRuntimeEvidenceError("PyInstaller pointer Build Context path binding failed")
    except EvidencePathError as error:
        raise MsvcRuntimeEvidenceError("PyInstaller pointer Build Context path binding failed") from error
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
        trusted_anchors = {"repository_root": frozen_repository_root}
        context_workpath = resolve_evidence_path(
            build_settings["workpath"],
            field="build_context.inputs.build_settings.workpath",
            trusted_runtime_anchors=trusted_anchors,
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        context_distpath = resolve_evidence_path(
            build_settings["distpath"],
            field="build_context.inputs.build_settings.distpath",
            trusted_runtime_anchors=trusted_anchors,
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        environment_workpath = resolve_evidence_path(
            pyinstaller["workpath"],
            field="build_environment.pyinstaller.workpath",
            trusted_runtime_anchors={},
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        environment_distpath = resolve_evidence_path(
            pyinstaller["distpath"],
            field="build_environment.pyinstaller.distpath",
            trusted_runtime_anchors={},
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        context_spec = resolve_evidence_path(
            specification["path"],
            field="build_context.inputs.specification.path",
            trusted_runtime_anchors=trusted_anchors,
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        environment_spec = resolve_evidence_path(
            pyinstaller["spec"],
            field="build_environment.pyinstaller.spec",
            trusted_runtime_anchors={},
            expected_scope=frozen_repository_root,
            filesystem_identity=True,
        )
        if not all(
            (
                same_filesystem_identity(context_workpath, environment_workpath),
                same_filesystem_identity(context_distpath, environment_distpath),
                same_filesystem_identity(context_spec, environment_spec),
            )
        ):
            raise MsvcRuntimeEvidenceError(
                "PyInstaller artifact usage binding is not this Worker build"
            )
    except (EvidencePathError, KeyError, OSError) as error:
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
        "internal_name": values.get("InternalName"),
        "original_filename": values.get("OriginalFilename"),
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
        def import_directory(entries: object) -> list[dict[str, object]]:
            result = []
            for entry in entries or []:
                result.append(
                    {
                        "dll": _decode(entry.dll),
                        "symbols": sorted(
                            {
                                _decode(symbol.name)
                                for symbol in getattr(entry, "imports", []) or []
                                if getattr(symbol, "name", None)
                            },
                            key=str.lower,
                        ),
                    }
                )
            return sorted(result, key=lambda item: str(item["dll"]).lower())

        static_imports = import_directory(getattr(pe, "DIRECTORY_ENTRY_IMPORT", []) or [])
        delay_imports = import_directory(
            getattr(pe, "DIRECTORY_ENTRY_DELAY_IMPORT", []) or []
        )
        machine_code = int(pe.FILE_HEADER.Machine)
        machine = PE_MACHINE_NAMES.get(machine_code, f"UNKNOWN_0x{machine_code:04x}")
        return {
            "machine": machine,
            "machine_code": f"0x{machine_code:04x}",
            "static_imports": static_imports,
            "delay_imports": delay_imports,
            "delay_import_directory_parsed": True,
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


def _import_records(pe: dict[str, object], edge_type: str) -> list[dict[str, object]]:
    key = "static_imports" if edge_type == "STATIC" else "delay_imports"
    records = pe.get(key)
    if isinstance(records, list):
        return records
    # Backward-compatible input for the synthetic regression fixture only.
    if edge_type == "STATIC" and isinstance(pe.get("imports"), list):
        return [{"dll": value, "symbols": []} for value in pe["imports"]]
    return []


def _owner_is_approved(owner: dict[str, object]) -> bool:
    return owner.get("source_artifact_identity") is not None and owner.get(
        "source_kind"
    ) != "UNAPPROVED_SYSTEM_COPY"


def _product_owner_identity_complete(owner: dict[str, object]) -> bool:
    identity = owner.get("source_artifact_identity")
    if not isinstance(identity, dict):
        return False
    return bool(
        identity.get("filename")
        and re.fullmatch(r"[0-9a-f]{64}", str(identity.get("artifact_sha256", "")))
        and (identity.get("member_relative_path") or identity.get("installed_relative_path"))
    )


def _runtime_edge(
    entry: dict[str, object], runtime_name: str, edge_type: str, chain: list[str]
) -> dict[str, object]:
    return {
        "importer_internal_path": entry["internal_path"],
        "importer_selected_source_path": entry["selected_source_path"],
        "importer_sha256": entry["sha256"],
        "importer_owner": entry["owner"],
        "imported_dll_name": runtime_name,
        "edge_type": edge_type,
        "relationship": "DIRECT" if len(chain) == 1 else "TRANSITIVE",
        "dependency_depth": len(chain),
        "pe_architecture": entry["pe"]["machine"],
        "import_chain": [*chain, runtime_name],
    }


def build_import_closure(entries: list[dict[str, object]]) -> dict[str, object]:
    """Build application requirements from approved non-runtime product roots.

    Runtime endpoints remain observable graph nodes, but their own import tables
    cannot independently promote a new application prerequisite.
    """
    nodes = {_selected_node_key(entry): entry for entry in entries}
    if len(nodes) != len(entries):
        raise MsvcRuntimeEvidenceError("selected native graph contains duplicate internal paths")

    by_basename: dict[str, list[str]] = {}
    for key, entry in nodes.items():
        basename = PurePosixPath(str(entry["internal_path"])).name.lower()
        by_basename.setdefault(basename, []).append(key)

    graphs = {edge_type: {key: set() for key in nodes} for edge_type in ("STATIC", "DELAY")}
    runtime_edges = {"STATIC": [], "DELAY": []}
    all_dependency_names: set[str] = set()
    ambiguous = []
    for edge_type in ("STATIC", "DELAY"):
        for key, entry in nodes.items():
            for imported in _import_records(entry["pe"], edge_type):
                imported_name = PurePosixPath(
                    str(imported["dll"]).replace("\\", "/")
                ).name.lower()
                all_dependency_names.add(imported_name)
                runtime_name = normalize_runtime_name(imported_name)
                if runtime_name:
                    runtime_edges[edge_type].append(
                        _runtime_edge(entry, runtime_name, edge_type, [str(entry["internal_path"])])
                    )
                    continue
                candidates = by_basename.get(imported_name, [])
                if len(candidates) == 1:
                    graphs[edge_type][key].add(candidates[0])
                elif len(candidates) > 1:
                    ambiguous.append(
                        {
                            "edge_type": edge_type,
                            "importer_internal_path": entry["internal_path"],
                            "imported_dll_name": imported_name,
                            "candidate_internal_paths": sorted(
                                str(nodes[candidate]["internal_path"])
                                for candidate in candidates
                            ),
                        }
                    )

    product_roots = {
        key
        for key, entry in nodes.items()
        if _owner_is_approved(entry["owner"])
        and _product_owner_identity_complete(entry["owner"])
        and normalize_runtime_name(str(entry["internal_path"])) is None
    }
    approved_required: dict[tuple[str, str, str], dict[str, object]] = {}
    observed_endpoint_edges = []
    graph_all = {
        key: set(graphs["STATIC"][key]) | set(graphs["DELAY"][key]) for key in nodes
    }
    direct_by_key: dict[str, list[dict[str, object]]] = {}
    for edge_type in ("STATIC", "DELAY"):
        for relationship in runtime_edges[edge_type]:
            importer_key = str(relationship["importer_internal_path"]).lower()
            direct_by_key.setdefault(importer_key, []).append(relationship)
            importer = nodes[importer_key]
            if normalize_runtime_name(str(importer["internal_path"])):
                endpoint_role = (
                    "APPROVED_ARTIFACT_RUNTIME_ENDPOINT_INTERNAL_EDGE_OBSERVED"
                    if _owner_is_approved(importer["owner"])
                    else "UNAPPROVED_ENDPOINT_INTERNAL_EDGE_OBSERVED"
                )
                observed_endpoint_edges.append(
                    {**relationship, "evidence_role": endpoint_role}
                )

    for root_key in sorted(product_roots):
        root = nodes[root_key]
        queue: deque[tuple[str, list[str]]] = deque(
            [(root_key, [str(root["internal_path"])])]
        )
        visited = {root_key}
        while queue:
            current_key, chain = queue.popleft()
            for relationship in direct_by_key.get(current_key, []):
                runtime_name = str(relationship["imported_dll_name"])
                edge_type = str(relationship["edge_type"])
                identity = (root_key, runtime_name, edge_type)
                candidate = _runtime_edge(root, runtime_name, edge_type, chain)
                candidate["evidence_role"] = "APPROVED_PRODUCT_ROOT_REQUIREMENT"
                previous = approved_required.get(identity)
                if previous is None or int(candidate["dependency_depth"]) < int(
                    previous["dependency_depth"]
                ):
                    approved_required[identity] = candidate
            for next_key in sorted(graph_all[current_key]):
                next_entry = nodes[next_key]
                if normalize_runtime_name(str(next_entry["internal_path"])):
                    continue
                if next_key not in visited:
                    visited.add(next_key)
                    queue.append((next_key, [*chain, str(next_entry["internal_path"])]))

    approved_dependencies = sorted(
        approved_required.values(),
        key=lambda item: (
            str(item["imported_dll_name"]),
            str(item["importer_internal_path"]),
            str(item["edge_type"]),
        ),
    )
    selected_runtime = sorted(
        {
            runtime
            for entry in entries
            for runtime in [normalize_runtime_name(str(entry["internal_path"]))]
            if runtime
        }
    )
    required_runtime = sorted(
        {str(item["imported_dll_name"]) for item in approved_dependencies}
    )
    static_edges = [item for item in approved_dependencies if item["edge_type"] == "STATIC"]
    delay_edges = [item for item in approved_dependencies if item["edge_type"] == "DELAY"]
    windows_api_set = sorted(
        name for name in all_dependency_names if name.startswith(("api-ms-win-", "ext-ms-"))
    )
    windows_os = sorted(
        name
        for name in all_dependency_names
        if name in WINDOWS_OS_DLL_NAMES and name not in windows_api_set
    )
    selected_basenames = {
        PurePosixPath(str(entry["internal_path"])).name.lower() for entry in entries
    }
    product_packaged = sorted(
        name
        for name in all_dependency_names
        if name in selected_basenames and normalize_runtime_name(name) is None
    )
    unknown = sorted(
        all_dependency_names
        - set(windows_api_set)
        - set(windows_os)
        - set(required_runtime)
        - set(product_packaged)
    )
    return {
        "status": "PASS" if not ambiguous else "FAIL",
        "semantics": "APPLICATION_SIDE_DEPENDENCY_NECESSITY_ONLY",
        "selected_native_count": len(entries),
        "approved_product_root_count": len(product_roots),
        "direct_importer_count": len(
            {
                str(item["importer_internal_path"])
                for item in approved_dependencies
                if item["relationship"] == "DIRECT"
            }
        ),
        "transitive_importer_count": len(
            {
                str(item["importer_internal_path"])
                for item in approved_dependencies
                if item["relationship"] == "TRANSITIVE"
            }
        ),
        "static_import_audit": "PASS",
        "static_import_edge_count": sum(
            len(_import_records(entry["pe"], "STATIC")) for entry in entries
        ),
        "static_msvc_importer_count": len(
            {str(item["importer_internal_path"]) for item in static_edges}
        ),
        "delay_import_audit": "PASS",
        "delay_import_directory_audit": "PASS",
        "delay_import_parse_failure_count": 0,
        "delay_import_edge_count": sum(
            len(_import_records(entry["pe"], "DELAY")) for entry in entries
        ),
        "msvc_runtime_delay_importer_count": len(
            {str(item["importer_internal_path"]) for item in delay_edges}
        ),
        "pyinstaller_selected_msvc_dll_family": selected_runtime,
        "application_required_msvc_dll_family": required_runtime,
        "pe_import_closure_required_msvc_dll_family": required_runtime,
        "approved_product_root_required_dlls": required_runtime,
        "observed_runtime_endpoint_transitive_dlls": sorted(
            {str(item["imported_dll_name"]) for item in observed_endpoint_edges}
        ),
        "selected_and_required": sorted(set(selected_runtime) & set(required_runtime)),
        "selected_but_not_required": sorted(set(selected_runtime) - set(required_runtime)),
        "required_but_not_selected": sorted(set(required_runtime) - set(selected_runtime)),
        "selected_but_not_import_closure_required": sorted(
            set(selected_runtime) - set(required_runtime)
        ),
        "required_but_not_pyinstaller_selected": sorted(
            set(required_runtime) - set(selected_runtime)
        ),
        "direct_dependencies": [
            item for item in approved_dependencies if item["relationship"] == "DIRECT"
        ],
        "transitive_dependencies": [
            item for item in approved_dependencies if item["relationship"] == "TRANSITIVE"
        ],
        "approved_product_dependencies": approved_dependencies,
        "observed_runtime_endpoint_internal_edges": observed_endpoint_edges,
        "windows_os_provided_dll_family": windows_os,
        "windows_api_set_dll_family": windows_api_set,
        "msvc_external_runtime_candidate_dll_family": required_runtime,
        "product_packaged_dll_family": product_packaged,
        "unknown_dll_family": unknown,
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


def _preserve_analysis_toc(
    manifest: dict[str, object],
    build_context: dict[str, object],
    build_context_path: Path,
    manifest_path: Path,
    selected_manifest_path: Path,
    output_json: Path,
) -> dict[str, object]:
    workpath = Path(str(manifest["pyinstaller"]["workpath"]))
    candidates = sorted(workpath.rglob("Analysis-*.toc"))
    if len(candidates) != 1:
        raise MsvcRuntimeEvidenceError(
            f"expected exactly one current-build Analysis TOC, found {len(candidates)}"
        )
    source = candidates[0]
    raw_root = output_json.parent.parent / "raw" / "diagnostic-pre-gate"
    raw_root.mkdir(parents=True, exist_ok=True)
    preserved = raw_root / source.name
    shutil.copyfile(source, preserved)
    if sha256_file(source) != sha256_file(preserved):
        raise MsvcRuntimeEvidenceError("preserved Analysis TOC bytes changed during capture")
    binding = {
        "evidence_status": "DIAGNOSTIC_PRE_GATE",
        "captured_at_gate": "PRE_PACKAGE_PROVENANCE",
        "build_context_id": build_context["build_context_id"],
        "build_context_sha256": sha256_file(build_context_path),
        "spec_sha256": build_context["inputs"]["specification"]["sha256"],
        "pyinstaller_artifact_identity": build_context["inputs"]["pyinstaller_artifact"],
        "pyinstaller_analysis_toc_path": str(preserved),
        "pyinstaller_analysis_toc_sha256": sha256_file(preserved),
        "selected_native_manifest_path": str(selected_manifest_path),
        "selected_native_manifest_sha256": sha256_file(selected_manifest_path),
        "build_environment_manifest_sha256": sha256_file(manifest_path),
        "code_c_head_sha": build_context["inputs"]["code_c_commit"],
        "hook_configuration": manifest["pyinstaller"].get("hook_configuration"),
        "hook_configuration_affects_selection": "NO",
        "hook_configuration_binding": "NOT_REQUIRED",
    }
    binding_path = output_json.parent / "analysis-toc-pre-gate-binding.v1.json"
    write_canonical_json(binding_path, binding)
    return {**binding, "binding_path": str(binding_path), "binding_sha256": sha256_file(binding_path)}


def _dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return None


def _project_dynamic_load_surfaces(repository_root: Path) -> tuple[list[dict[str, object]], list[str]]:
    worker_root = repository_root / "sidecars" / "media-worker"
    sources = [worker_root / "packaging_entry.py", *sorted((worker_root / "src").rglob("*.py"))]
    surfaces = []
    failures = []
    for path in sources:
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(path))
        except (OSError, SyntaxError, UnicodeError) as error:
            failures.append(f"{path}: {error}")
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            call = _dotted_name(node.func)
            if call not in DYNAMIC_PYTHON_CALLS and not (
                call
                and call.endswith(
                    (".dlopen", ".LoadLibrary", ".WinDLL", ".CDLL")
                )
            ):
                continue
            target = None
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(
                node.args[0].value, str
            ):
                target = node.args[0].value
            runtime_target = normalize_runtime_name(target or "")
            surfaces.append(
                {
                    "surface": call,
                    "callsite": f"{path.relative_to(repository_root).as_posix()}:{node.lineno}",
                    "owning_artifact": "CODE_C_WORKER_SOURCE",
                    "target_naming_rule": target or "RUNTIME_VALUE",
                    "search_root": "NOT_STATICALLY_PROVEN",
                    "user_controlled_input": target is None,
                    "environment_controlled": target is None,
                    "approved_directory_constrained": False,
                    "classification": (
                        "CONTROLLED_DYNAMIC_LOAD" if target else "UNBOUNDED_DYNAMIC_LOAD"
                    ),
                    "affects_msvc_runtime_requirement": bool(runtime_target) or target is None,
                }
            )
    return surfaces, failures


def audit_dynamic_load_surfaces(
    entries: list[dict[str, object]], repository_root: Path
) -> dict[str, object]:
    surfaces, failures = _project_dynamic_load_surfaces(repository_root)
    for entry in entries:
        for edge_type in ("STATIC", "DELAY"):
            for imported in _import_records(entry["pe"], edge_type):
                runtime_name = normalize_runtime_name(str(imported["dll"]))
                if runtime_name:
                    surfaces.append(
                        {
                            "surface": f"PE_{edge_type}_IMPORT_DIRECTORY",
                            "callsite": entry["internal_path"],
                            "owning_artifact": entry["owner"],
                            "target_naming_rule": runtime_name,
                            "search_root": "WINDOWS_STATIC_LOADER_RESOLUTION",
                            "user_controlled_input": False,
                            "environment_controlled": False,
                            "approved_directory_constrained": "NOT_APPLICABLE_TO_REQUIREMENT_NAME",
                            "classification": "STATICALLY_RESOLVED",
                            "affects_msvc_runtime_requirement": True,
                        }
                    )
        api_names = sorted(
            {
                str(symbol)
                for edge_type in ("STATIC", "DELAY")
                for imported in _import_records(entry["pe"], edge_type)
                for symbol in imported.get("symbols", [])
                if str(symbol).lower() in DYNAMIC_PE_APIS
            },
            key=str.lower,
        )
        if not api_names:
            continue
        path = Path(str(entry["selected_source_path"]))
        try:
            raw = path.read_bytes().lower()
        except OSError as error:
            failures.append(f"{path}: {error}")
            continue
        statically_imported = {
            runtime
            for edge_type in ("STATIC", "DELAY")
            for imported in _import_records(entry["pe"], edge_type)
            for runtime in [normalize_runtime_name(str(imported["dll"]))]
            if runtime
        }
        embedded_runtime_names = {
            match.decode("ascii")
            for match in re.findall(
                rb"(?:msvcp140(?:_[a-z0-9]+)*|vcruntime140(?:_[a-z0-9]+)*|concrt140)\.dll",
                raw,
            )
        }
        version_resource = entry["pe"].get("version_resource", {})
        version_identity_runtime_names = {
            runtime
            for field in ("internal_name", "original_filename")
            for runtime in [normalize_runtime_name(str(version_resource.get(field) or ""))]
            if runtime
        }
        unresolved_runtime_names = sorted(
            embedded_runtime_names - statically_imported - version_identity_runtime_names
        )
        surfaces.append(
            {
                "surface": api_names,
                "callsite": "PE_IMPORT_TABLE_CALLSITE_NOT_SYMBOLICALLY_RESOLVED",
                "owning_artifact": entry["owner"],
                "importer_internal_path": entry["internal_path"],
                "importer_sha256": entry["sha256"],
                "target_naming_rule": "NO_ADDITIONAL_MSVC_DLL_LITERAL_OBSERVED"
                if not unresolved_runtime_names
                else unresolved_runtime_names,
                "excluded_pe_version_identity_metadata": sorted(
                    embedded_runtime_names & version_identity_runtime_names
                ),
                "search_root": "NOT_RESOLVED_BY_STATIC_PE_EVIDENCE",
                "user_controlled_input": "UNKNOWN",
                "environment_controlled": "UNKNOWN",
                "approved_directory_constrained": "UNKNOWN",
                "classification": "UNRESOLVED_DYNAMIC_LOAD",
                "affects_msvc_runtime_requirement": bool(unresolved_runtime_names),
            }
        )

    provider_entries = [
        entry
        for entry in entries
        if "onnxruntime_providers_" in str(entry["internal_path"]).lower()
    ]
    provider_contract_sources = [
        repository_root / "sidecars" / "media-worker" / "packaging_entry.py",
        repository_root / "sidecars" / "media-worker" / "src" / "media_worker" / "embedding.py",
    ]
    if provider_entries and all(
        "CPUExecutionProvider" in path.read_text(encoding="utf-8")
        for path in provider_contract_sources
    ):
        surfaces.append(
            {
                "surface": "ONNXRUNTIME_PROVIDER_LOADING",
                "callsite": [str(path.relative_to(repository_root)) for path in provider_contract_sources],
                "owning_artifact": [entry["owner"] for entry in provider_entries],
                "target_naming_rule": "onnxruntime_providers_*; CPUExecutionProvider fixed by Worker",
                "search_root": "APPROVED_ONNXRUNTIME_WHEEL_DIRECTORY",
                "user_controlled_input": False,
                "environment_controlled": False,
                "approved_directory_constrained": True,
                "classification": "CONTROLLED_DYNAMIC_LOAD",
                "affects_msvc_runtime_requirement": False,
            }
        )

    classifications = [str(item["classification"]) for item in surfaces]
    unbounded = [item for item in surfaces if item["classification"] == "UNBOUNDED_DYNAMIC_LOAD"]
    msvc_unresolved = [
        item
        for item in surfaces
        if item["classification"] == "UNRESOLVED_DYNAMIC_LOAD"
        and item["affects_msvc_runtime_requirement"] is True
    ]
    status = "PASS"
    if failures:
        status = "INCOMPLETE"
    elif unbounded or msvc_unresolved:
        status = "INCOMPLETE"
    return {
        "status": status,
        "scope": "BOUNDED_CURRENT_WORKER_MSVC_RUNTIME_LOADING_SURFACE",
        "statically_resolved_count": classifications.count("STATICALLY_RESOLVED"),
        "controlled_dynamic_load_count": classifications.count("CONTROLLED_DYNAMIC_LOAD"),
        "unbounded_dynamic_load_count": classifications.count("UNBOUNDED_DYNAMIC_LOAD"),
        "unresolved_dynamic_load_count": classifications.count("UNRESOLVED_DYNAMIC_LOAD"),
        "msvc_related_unresolved_dynamic_load_count": len(msvc_unresolved),
        "project_source_parse_failures": failures,
        "surfaces": surfaces,
        "pyinstaller_runtime_dll_loading": {
            "classification": "NOT_IN_PREPACKAGE_APPLICATION_PRODUCT_GRAPH",
            "reason": "PyInstaller bootloader packaging has not begun at this fail-closed gate",
            "affects_application_requirement_closure": False,
        },
    }


def _render_markdown(document: dict[str, object]) -> str:
    closure = document["pe_import_closure"]
    dynamic = document["dynamic_load_surface_audit"]
    toc = document["analysis_toc_binding"]
    lines = [
        "# Dependency Approval Request: Microsoft Visual C++ v14 x64 Runtime",
        "",
        f"Evidence ID: `{document['evidence_id']}`  ",
        f"Build Context: `{document['build_context']['build_context_id']}`  ",
        f"Status: `{document['status']}`",
        "",
        "## Evidence scope",
        "",
        "This bundle proves application-side dependency necessity only. It does not approve any runtime provider, distribution role, System32 copy, external-prerequisite disposition, installer change, or packaging exclusion.",
        "",
        f"- Application runtime requirement closure: `{document['application_runtime_requirement_closure']}`",
        f"- Runtime provider closure: `{document['runtime_provider_closure']}`",
        f"- Distribution approval: `{document['distribution_approval']}`",
        f"- Current System32 source: `{document['current_system32_copy_status']}`",
        "",
        "## Exact build binding",
        "",
        f"- Analysis TOC SHA-256: `{toc['pyinstaller_analysis_toc_sha256']}`",
        f"- Analysis evidence status: `{toc['evidence_status']}`",
        f"- Build Context SHA-256: `{toc['build_context_sha256']}`",
        f"- Selected Native Manifest SHA-256: `{toc['selected_native_manifest_sha256']}`",
        f"- Build Environment Manifest SHA-256: `{toc['build_environment_manifest_sha256']}`",
        f"- Spec SHA-256: `{toc['spec_sha256']}`",
        f"- Code C HEAD: `{toc['code_c_head_sha']}`",
        f"- Hook configuration affects selection: `{toc['hook_configuration_affects_selection']}`",
        f"- Hook configuration binding: `{toc['hook_configuration_binding']}`",
        "",
        "## Application import closure",
        "",
        f"Direct importers: `{closure['direct_importer_count']}`  ",
        f"Transitive importers: `{closure['transitive_importer_count']}`",
        "",
        "Application-required DLL family:",
        "",
    ]
    lines.extend(f"- `{name}`" for name in closure["application_required_msvc_dll_family"])
    lines.extend(["", "PyInstaller-selected DLL family:", ""])
    lines.extend(f"- `{name}`" for name in closure["pyinstaller_selected_msvc_dll_family"])
    for label, key in (
        ("Selected and required", "selected_and_required"),
        ("Selected but not required", "selected_but_not_required"),
        ("Required but not selected", "required_but_not_selected"),
        ("Observed runtime-endpoint internal edges", "observed_runtime_endpoint_transitive_dlls"),
        ("Windows OS-provided DLL family", "windows_os_provided_dll_family"),
        ("Windows API-set DLL family", "windows_api_set_dll_family"),
    ):
        lines.extend(["", f"{label}:", ""])
        values = closure[key]
        lines.extend(f"- `{value}`" for value in values) if values else lines.append("- None")
    lines.extend(
        [
            "",
            "## Static, delay, and dynamic loading",
            "",
            f"- Static import audit: `{closure['static_import_audit']}`",
            f"- Static import edges: `{closure['static_import_edge_count']}`",
            f"- Static MSVC importers: `{closure['static_msvc_importer_count']}`",
            f"- Delay import audit: `{closure['delay_import_audit']}`",
            f"- Delay import edges: `{closure['delay_import_edge_count']}`",
            f"- MSVC delay importers: `{closure['msvc_runtime_delay_importer_count']}`",
            f"- Dynamic load surface audit: `{dynamic['status']}`",
            f"- Controlled dynamic loads: `{dynamic['controlled_dynamic_load_count']}`",
            f"- Unbounded dynamic loads: `{dynamic['unbounded_dynamic_load_count']}`",
            f"- Unresolved dynamic loads: `{dynamic['unresolved_dynamic_load_count']}`",
            "",
            "## Runtime endpoints",
            "",
        ]
    )
    for endpoint in document["runtime_endpoints"]:
        lines.extend(
            [
                f"- `{endpoint['dll']}`",
                f"  - Observed source: `{endpoint['observed_source']}`",
                f"  - Observed SHA-256: `{endpoint['observed_sha256']}`",
                f"  - Source provenance: `{endpoint['source_provenance']}`",
                f"  - Packaging source: `{endpoint['packaging_source']}`",
                f"  - Distribution role approval: `{endpoint['distribution_role_approval']}`",
            ]
        )
    lines.extend(
        [
            "",
            "## Governance disposition",
            "",
            f"- Current shared contract capability: `{document['current_shared_contract_can_express_external_prerequisite']}`",
            f"- External prerequisite contract gap: `{document['external_prerequisite_contract_gap']}`",
            f"- QICR candidate: `{document['qicr_candidate']}`",
            f"- QICR required: `{document['qicr_required']}`",
            f"- Target disposition: `{document['target_disposition']}`",
            "",
            "## Safety disposition",
            "",
            "Observed System32 copies remain rejected as packaging and distribution sources. No runtime DLL is excluded from PyInstaller, no allowlist is expanded, and no external prerequisite or installer behavior is implemented by this evidence producer.",
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
    repository_root: Path,
    *,
    selected_manifest_path: Path,
) -> dict[str, object]:
    build_context, build_context_path = validate_msvc_evidence_pointers(
        manifest, manifest_path, repository_root=repository_root
    )

    try:
        selected_manifest = json.loads(selected_manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MsvcRuntimeEvidenceError("Selected Native Manifest is unreadable") from error

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
    selected_manifest_index = {
        (
            str(entry.get("internal_path", "")).lower(),
            normalized_realpath(str(entry.get("selected_source_path", ""))),
            str(entry.get("selected_source_sha256", "")),
        ): entry
        for entry in selected_manifest.get("entries", [])
    }
    selected_graph_index = {
        (
            str(entry["internal_path"]).lower(),
            normalized_realpath(str(entry["selected_source_path"])),
            str(entry["sha256"]),
        )
        for entry in selected
    }
    if set(selected_manifest_index) != selected_graph_index:
        parse_failures.append("Selected Native Manifest does not exactly bind Analysis.binaries")

    analysis_toc = _preserve_analysis_toc(
        manifest,
        build_context,
        build_context_path,
        manifest_path,
        selected_manifest_path,
        output_json,
    )
    dynamic_audit = audit_dynamic_load_surfaces(selected, repository_root)
    controlled_dynamic_runtime = sorted(
        {
            runtime
            for surface in dynamic_audit["surfaces"]
            if surface["classification"] == "CONTROLLED_DYNAMIC_LOAD"
            and isinstance(surface.get("target_naming_rule"), str)
            for runtime in [normalize_runtime_name(str(surface["target_naming_rule"]))]
            if runtime
        }
    )
    selected_runtime_set = set(closure["pyinstaller_selected_msvc_dll_family"])
    application_required_set = set(closure["approved_product_root_required_dlls"]) | set(
        controlled_dynamic_runtime
    )
    closure["controlled_dynamic_required_msvc_dll_family"] = controlled_dynamic_runtime
    closure["application_required_msvc_dll_family"] = sorted(application_required_set)
    closure["pe_import_closure_required_msvc_dll_family"] = sorted(
        application_required_set
    )
    closure["msvc_external_runtime_candidate_dll_family"] = sorted(
        application_required_set
    )
    closure["selected_and_required"] = sorted(
        selected_runtime_set & application_required_set
    )
    closure["selected_but_not_required"] = sorted(
        selected_runtime_set - application_required_set
    )
    closure["required_but_not_selected"] = sorted(
        application_required_set - selected_runtime_set
    )
    closure["selected_but_not_import_closure_required"] = closure[
        "selected_but_not_required"
    ]
    closure["required_but_not_pyinstaller_selected"] = closure[
        "required_but_not_selected"
    ]

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
                    "selected_entry": entry["internal_path"],
                    "selection_origin": "PYINSTALLER_ANALYSIS_BINARIES",
                    "source_provenance": "UNAPPROVED_SYSTEM_COPY",
                    "packaging_source": "REJECTED",
                    "distribution_approval": "NONE",
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

    runtime_endpoints = []
    for entry in selected:
        runtime_name = normalize_runtime_name(str(entry["internal_path"]))
        if not runtime_name:
            continue
        owner = entry["owner"]
        source_provenance = str(owner["source_kind"])
        if source_provenance == "UNAPPROVED_SYSTEM_COPY":
            packaging_source = "REJECTED"
        else:
            packaging_source = "ARTIFACT_IDENTITY_APPROVED_ROLE_NOT_APPROVED"
        runtime_endpoints.append(
            {
                "dll": runtime_name,
                "selected_entry": entry["internal_path"],
                "selection_origin": "PYINSTALLER_ANALYSIS_BINARIES",
                "observed_source": entry["selected_source_path"],
                "observed_sha256": entry["sha256"],
                "pe_architecture": entry["pe"]["machine"],
                "source_provenance": source_provenance,
                "source_artifact_identity": owner["source_artifact_identity"],
                "packaging_source": packaging_source,
                "distribution_role_approval": "NONE",
            }
        )
    runtime_endpoints.sort(key=lambda item: str(item["dll"]))

    product_importers = [
        entry
        for entry in selected
        if normalize_runtime_name(str(entry["internal_path"])) is None
    ]
    unapproved_product_importers = [
        entry
        for entry in product_importers
        if not _owner_is_approved(entry["owner"])
        or not _product_owner_identity_complete(entry["owner"])
    ]
    product_importer_provenance = []
    for entry in product_importers:
        key = (
            str(entry["internal_path"]).lower(),
            normalized_realpath(str(entry["selected_source_path"])),
            str(entry["sha256"]),
        )
        product_importer_provenance.append(
            {
                "internal_path": entry["internal_path"],
                "selected_source_path": entry["selected_source_path"],
                "selected_source_sha256": entry["sha256"],
                "owner": entry["owner"],
                "build_context_id": build_context["build_context_id"],
                "selected_manifest_entry": selected_manifest_index.get(key),
                "status": "PASS"
                if _owner_is_approved(entry["owner"])
                and _product_owner_identity_complete(entry["owner"])
                and key in selected_manifest_index
                else "FAIL",
            }
        )

    unexpected_architectures = [
        {
            "internal_path": entry["internal_path"],
            "selected_source_path": entry["selected_source_path"],
            "pe_architecture": entry["pe"]["machine"],
        }
        for entry in selected
        if entry["pe"]["machine"] != "x86_64"
    ]
    application_status = "PASS"
    if (
        parse_failures
        or closure["status"] != "PASS"
        or not closure["application_required_msvc_dll_family"]
        or closure["required_but_not_selected"]
        or unexpected_architectures
        or unapproved_product_importers
        or dynamic_audit["status"] != "PASS"
        or len(copies) != len(unapproved_selected_runtime)
        or len(runtime_endpoints)
        != len(closure["pyinstaller_selected_msvc_dll_family"])
    ):
        application_status = "INCOMPLETE"
    status = "READY" if application_status == "PASS" else "INCOMPLETE"
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
        "dependency_type": "EXTERNAL_WINDOWS_RUNTIME_PREREQUISITE_CANDIDATE",
        "runtime_family": "Microsoft Visual C++ v14 x64 Runtime",
        "ambient_toolchain_contamination": "RESOLVED",
        "application_runtime_requirement_closure": application_status,
        "msvc_runtime_import_closure": application_status,
        "msvc_runtime_import_closure_semantics": (
            "APPLICATION_SIDE_DEPENDENCY_NECESSITY_ONLY"
        ),
        "runtime_provider_closure": "PENDING_CODE_F_ARTIFACT_REVIEW",
        "msvc_runtime_artifact_approval": "NOT_PERFORMED",
        "distribution_approval": "NOT_PERFORMED",
        "current_system32_copy_status": "REJECTED_AS_PACKAGING_SOURCE",
        "recommended_deployment": "INSTALLER_LEVEL_PREREQUISITE",
        "app_local_embedding": "NOT_APPROVED",
        "current_worker_packaging": "BLOCKED",
        "analysis_toc_binding": {**analysis_toc, "status": "PASS"},
        "selected_native_manifest": {
            "path": str(selected_manifest_path),
            "sha256": sha256_file(selected_manifest_path),
            "status": selected_manifest.get("status"),
        },
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
        "dynamic_load_surface_audit": dynamic_audit,
        "product_importer_provenance": {
            "status": "PASS" if not unapproved_product_importers else "FAIL",
            "unapproved_product_importer_count": len(unapproved_product_importers),
            "entries": product_importer_provenance,
        },
        "runtime_endpoints": runtime_endpoints,
        "current_system32_copies": copies,
        "unapproved_selected_runtime_count": len(unapproved_selected_runtime),
        "captured_system32_runtime_count": len(copies),
        "parse_failures": parse_failures,
        "unexpected_pe_architectures": unexpected_architectures,
        "external_prerequisite_contract_capability": {
            "status": "UNKNOWN" if status != "READY" else "CONTRACT_EXTENSION_REQUIRED",
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
        "current_shared_contract_can_express_external_prerequisite": (
            "UNKNOWN" if status != "READY" else "NO"
        ),
        "external_prerequisite_contract_gap": (
            "UNKNOWN" if status != "READY" else "CONFIRMED"
        ),
        "qicr_candidate": "YES" if status == "READY" else "NO",
        "qicr_required": "PENDING",
        "target_disposition": "UNDECIDED",
        "owner_of_next_fix": (
            "CODE_F_DEPENDENCY_AND_QICR_REVIEW"
            if status == "READY"
            else "CODE_C"
        ),
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
