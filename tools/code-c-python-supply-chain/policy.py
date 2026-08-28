from __future__ import annotations

import hashlib
import os
from pathlib import Path
from urllib.parse import urlparse


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PIP_CONFIG_PATH = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "pip-hermetic.conf"
)
DISALLOWED_PIP_ENVIRONMENT = (
    "PIP_INDEX_URL",
    "PIP_EXTRA_INDEX_URL",
    "PIP_FIND_LINKS",
    "PIP_TRUSTED_HOST",
    "PIP_NO_INDEX",
    "PIP_REQUIRE_VIRTUALENV",
    "PIP_TARGET",
    "PIP_PREFIX",
    "PIP_CACHE_DIR",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_approved_pip_environment(environment: dict[str, str] | None = None) -> None:
    values = os.environ if environment is None else environment
    failures = [name for name in DISALLOWED_PIP_ENVIRONMENT if values.get(name, "").strip()]
    configured = values.get("PIP_CONFIG_FILE", "").strip()
    if configured and Path(configured).resolve() != PIP_CONFIG_PATH.resolve():
        failures.append("PIP_CONFIG_FILE")
    if failures:
        raise ValueError(f"unapproved pip environment is set: {', '.join(sorted(failures))}")


def hermetic_environment(environment: dict[str, str] | None = None) -> dict[str, str]:
    assert_approved_pip_environment(environment)
    result = dict(os.environ if environment is None else environment)
    for name in DISALLOWED_PIP_ENVIRONMENT:
        result.pop(name, None)
    result["PIP_CONFIG_FILE"] = str(PIP_CONFIG_PATH)
    result["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    result["PIP_NO_CACHE_DIR"] = "1"
    result["PYTHONNOUSERSITE"] = "1"
    return result


def assert_exact_wheel_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "files.pythonhosted.org":
        raise ValueError(f"unapproved Python artifact source: {url}")
    if not parsed.path.endswith(".whl"):
        raise ValueError(f"binary-only policy rejected non-wheel artifact: {url}")
    lowered = url.lower()
    if "latest" in lowered or "git+" in lowered or "/refs/heads/" in lowered:
        raise ValueError(f"floating/VCS Python artifact is rejected: {url}")


def assert_intake_reference(reference: str) -> None:
    lowered = reference.strip().lower()
    if lowered.startswith(("git+", "hg+", "svn+", "bzr+")):
        raise ValueError("VCS Python artifact is rejected")
    if lowered.startswith(("file:", "/", "./", "../")):
        raise ValueError("arbitrary local Python artifact is rejected")
    assert_exact_wheel_url(reference)
