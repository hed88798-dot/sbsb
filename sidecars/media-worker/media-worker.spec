# PyInstaller 6.22.2 build recipe. Invoke from this directory on the target OS.
from pathlib import Path

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
