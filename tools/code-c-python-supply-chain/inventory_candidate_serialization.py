from __future__ import annotations

import copy
import re


PURL_PATTERN = re.compile(r"^pkg:pypi/[a-z0-9._-]+@[^?/#]+$")
PSEUDO_PURL_PREFIXES = (
    "REVIEW_REQUIRED:",
    "NOT_APPLICABLE:",
    "UNKNOWN:",
    "UNRESOLVED:",
)
SUPPORTED_DISPOSITIONS = {"INCLUDED", "NOT_APPLICABLE"}


class CandidateSerializationError(ValueError):
    pass


def normalize_python_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def python_purl(name: str, version: str) -> str:
    return f"pkg:pypi/{normalize_python_name(name)}@{version}"


def _resolution_packages(
    resolution: dict[str, object],
) -> tuple[dict[str, dict[str, object]], dict[str, str]]:
    packages: dict[str, dict[str, object]] = {}
    purls: dict[str, str] = {}
    for raw_package in resolution.get("packages", []):
        package = dict(raw_package)
        normalized = normalize_python_name(str(package["name"]))
        if normalized in packages:
            raise CandidateSerializationError(f"duplicate resolver package: {normalized}")
        packages[normalized] = package
        purls[normalized] = python_purl(str(package["name"]), str(package["version"]))
    if not packages:
        raise CandidateSerializationError("resolver produced no packages")
    return packages, purls


def serialize_candidate_from_resolution(
    candidate: dict[str, object], resolution: dict[str, object]
) -> dict[str, object]:
    """Map resolver truth into an Inventory v2 candidate without reclassifying it."""

    serialized = copy.deepcopy(candidate)
    resolved_packages, purls = _resolution_packages(resolution)
    candidate_packages = {
        normalize_python_name(str(package["package_name"])): package
        for package in serialized.get("packages", [])
    }
    if len(candidate_packages) != len(serialized.get("packages", [])):
        raise CandidateSerializationError("candidate contains duplicate normalized package identities")
    if set(candidate_packages) != set(resolved_packages):
        raise CandidateSerializationError("candidate package set differs from resolver package set")

    for normalized, package in candidate_packages.items():
        resolved = resolved_packages[normalized]
        if str(package.get("version")) != str(resolved["version"]):
            raise CandidateSerializationError(f"candidate version differs from resolver: {normalized}")
        resolver_provenance = resolved.get("provenance")
        if resolver_provenance:
            for key in ("filename", "sha256", "download_url", "source", "source_index"):
                if not resolver_provenance.get(key):
                    raise CandidateSerializationError(
                        f"resolver provenance is incomplete for {normalized}: {key}"
                    )
            if package.get("filename") != resolver_provenance["filename"]:
                raise CandidateSerializationError(
                    f"candidate filename differs from resolver: {normalized}"
                )
            if package.get("sha256") != resolver_provenance["sha256"]:
                raise CandidateSerializationError(
                    f"candidate artifact hash differs from resolver: {normalized}"
                )
            package["source"] = resolver_provenance["source"]
            package["source_index"] = resolver_provenance["source_index"]
            package["provenance"]["download_url"] = resolver_provenance["download_url"]
        package["dependencies"] = [purls[dependency] for dependency in resolved["dependencies"]]
        declarations: list[dict[str, object]] = []
        for raw_declaration in resolved["dependency_declarations"]:
            declaration = dict(raw_declaration)
            disposition = str(declaration.get("disposition"))
            if disposition not in SUPPORTED_DISPOSITIONS:
                raise CandidateSerializationError(
                    f"unsupported resolver disposition for {normalized}: {disposition}"
                )
            dependency = declaration.get("dependency")
            if disposition == "INCLUDED":
                if not isinstance(dependency, str) or dependency not in purls:
                    raise CandidateSerializationError(
                        f"included resolver dependency has no exact identity: {normalized}"
                    )
                purl: str | None = purls[dependency]
                reason = ""
            else:
                if dependency is not None:
                    raise CandidateSerializationError(
                        f"not-applicable resolver dependency has an identity: {normalized}"
                    )
                purl = None
                reason = str(declaration.get("reason", ""))
                if not reason.strip():
                    raise CandidateSerializationError(
                        f"not-applicable resolver dependency lacks evidence: {normalized}"
                    )
            declarations.append(
                {
                    "requirement": str(declaration["requirement"]),
                    "package_name": str(declaration["package_name"]),
                    "disposition": disposition,
                    "purl": purl,
                    "reason": reason,
                }
            )
        package["dependency_declarations"] = declarations

    validate_resolution_serialization(serialized, resolution)
    return serialized


def validate_resolution_serialization(
    candidate: dict[str, object], resolution: dict[str, object]
) -> dict[str, int | str]:
    resolved_packages, purls = _resolution_packages(resolution)
    candidate_packages = {
        normalize_python_name(str(package["package_name"])): package
        for package in candidate.get("packages", [])
    }
    counters = {
        "resolution_state_conflict_count": 0,
        "resolved_not_applicable_emitted_as_formal_dependency_count": 0,
        "invalid_review_required_dependency_entries": 0,
        "invalid_pseudo_purl_count": 0,
        "missing_required_purl_field_count": 0,
        "invalid_purl_format_count": 0,
        "pseudo_purl_in_formal_dependencies": 0,
    }

    if len(candidate_packages) != len(candidate.get("packages", [])):
        counters["resolution_state_conflict_count"] += 1
    if set(candidate_packages) != set(resolved_packages):
        counters["resolution_state_conflict_count"] += 1

    for normalized, resolved in resolved_packages.items():
        package = candidate_packages.get(normalized)
        if package is None:
            continue
        expected_dependencies = [purls[dependency] for dependency in resolved["dependencies"]]
        actual_dependencies = list(package.get("dependencies", []))
        if actual_dependencies != expected_dependencies:
            counters["resolution_state_conflict_count"] += 1
        for dependency in actual_dependencies:
            if not isinstance(dependency, str) or not PURL_PATTERN.fullmatch(dependency):
                counters["invalid_purl_format_count"] += 1
            if isinstance(dependency, str) and dependency.startswith(PSEUDO_PURL_PREFIXES):
                counters["invalid_pseudo_purl_count"] += 1
                counters["pseudo_purl_in_formal_dependencies"] += 1
                if dependency.startswith("REVIEW_REQUIRED:"):
                    counters["invalid_review_required_dependency_entries"] += 1

        expected_declarations = list(resolved["dependency_declarations"])
        actual_declarations = list(package.get("dependency_declarations", []))
        if len(actual_declarations) != len(expected_declarations):
            counters["resolution_state_conflict_count"] += 1
        for index, expected in enumerate(expected_declarations):
            if index >= len(actual_declarations):
                break
            actual = actual_declarations[index]
            if "purl" not in actual:
                counters["missing_required_purl_field_count"] += 1
                actual_purl = None
            else:
                actual_purl = actual["purl"]
            disposition = str(expected.get("disposition"))
            if disposition not in SUPPORTED_DISPOSITIONS:
                counters["resolution_state_conflict_count"] += 1
                continue
            dependency = expected.get("dependency")
            expected_purl = purls[dependency] if disposition == "INCLUDED" else None
            expected_reason = "" if disposition == "INCLUDED" else str(expected.get("reason", ""))
            for key, value in (
                ("requirement", str(expected["requirement"])),
                ("package_name", str(expected["package_name"])),
                ("disposition", disposition),
                ("purl", expected_purl),
                ("reason", expected_reason),
            ):
                if actual.get(key) != value:
                    counters["resolution_state_conflict_count"] += 1
                    break
            if disposition == "NOT_APPLICABLE" and isinstance(actual_purl, str):
                if actual_purl in actual_dependencies:
                    counters["resolved_not_applicable_emitted_as_formal_dependency_count"] += 1
            if actual_purl is not None and (
                not isinstance(actual_purl, str) or not PURL_PATTERN.fullmatch(actual_purl)
            ):
                counters["invalid_purl_format_count"] += 1
            if isinstance(actual_purl, str) and actual_purl.startswith(PSEUDO_PURL_PREFIXES):
                counters["invalid_pseudo_purl_count"] += 1

    if any(value for value in counters.values()):
        details = ", ".join(f"{key}={value}" for key, value in counters.items() if value)
        raise CandidateSerializationError(f"resolver/serializer consistency failed: {details}")
    return {
        **counters,
        "resolution_serialization_consistency": "PASS",
        "dependency_graph_validation": "PASS",
        "resolution_state_conflict_fail_closed": "PASS",
    }
