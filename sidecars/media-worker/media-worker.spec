# PyInstaller 6.22.2 build recipe. Invoke from this directory on the target OS.
import importlib.util
import json
import os
from pathlib import Path
import sys

root = Path(SPECPATH).resolve()

analysis = Analysis(
    [str(root / "packaging_entry.py")],
    pathex=[str(root / "src")],
    binaries=[],
    datas=[],
    hiddenimports=["numpy", "onnxruntime", "cv2", "PIL", "scenedetect", "sentencepiece"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["sqlite3", "flask", "fastapi", "torch", "transformers"],
    noarchive=False,
    optimize=1,
)

gate_path = (
    root.parents[1]
    / "tools"
    / "code-c-python-supply-chain"
    / "prepackage_selected_source_gate.py"
)
gate_spec = importlib.util.spec_from_file_location("code_c_prepackage_selected_source_gate", gate_path)
if gate_spec is None or gate_spec.loader is None:
    raise SystemExit(f"cannot load pre-package selected-source gate: {gate_path}")
gate = importlib.util.module_from_spec(gate_spec)
sys.path.insert(0, str(gate_path.parent))
try:
    gate_spec.loader.exec_module(gate)
finally:
    sys.path.pop(0)
gate.validate_analysis_binaries(analysis.binaries)

# Preserve the raw Analysis selection in the pre-package evidence, then
# exclude only the entries that the current build's approved external-runtime
# partition explicitly marks as installer-provided.  This is intentionally
# evidence-driven (destination + current import closure), never a basename
# ignore list or an implicit System32 allowlist.
selected_evidence_value = os.environ.get("CODE_C_PREPACKAGE_SELECTED_EVIDENCE")
if selected_evidence_value:
    selected_evidence_path = Path(selected_evidence_value).resolve(strict=True)
    selected_evidence = json.loads(selected_evidence_path.read_text(encoding="utf-8"))
    external_paths = {
        str(entry["internal_path"]).replace("\\", "/")
        for entry in selected_evidence.get("entries", [])
        if entry.get("source_provenance_status") == "EXTERNAL_PREREQUISITE"
    }
    if external_paths:
        analysis.binaries = [
            entry
            for entry in analysis.binaries
            if str(entry[0]).replace("\\", "/") not in external_paths
        ]

pyz = PYZ(analysis.pure)
executable = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="media-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
