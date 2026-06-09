"""Pytest config dùng chung — đưa các thư mục src/* vào sys.path để import module trực tiếp.

Các module trong project import kiểu phẳng (vd `from build_features import ...`), không phải package,
nên test cần thêm đúng thư mục chứa file vào path.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

for sub in ("src/generator", "src/ingest", "src/ml", "src/dashboard"):
    p = ROOT / sub
    if p.is_dir() and str(p) not in sys.path:
        sys.path.insert(0, str(p))
