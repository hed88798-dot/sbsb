# PyInstaller 6.22.2 build recipe. Invoke from this directory on the target OS.
import importlib.util
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
