"""Simple test runner to execute test functions without pytest.
This imports test modules from the `tests` package and runs functions starting
with `test_`. It exits non-zero on first failure.
"""
import importlib.util
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS_DIR = ROOT / "tests"

sys.path.insert(0, str(ROOT))

failures = 0

for p in sorted(TESTS_DIR.glob('test_*.py')):
    name = p.stem
    print(f"Running {name}...")
    spec = importlib.util.spec_from_file_location(name, str(p))
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)  # type: ignore
    except Exception:
        print(f"ERROR importing {name}:")
        traceback.print_exc()
        failures += 1
        continue
    # run functions named test_*
    for attr in dir(mod):
        if not attr.startswith('test_'):
            continue
        fn = getattr(mod, attr)
        if callable(fn):
            try:
                print(f" - {attr}()", end='')
                fn()
                print(" OK")
            except AssertionError:
                print(" FAIL")
                traceback.print_exc()
                failures += 1
            except Exception:
                print(" ERROR")
                traceback.print_exc()
                failures += 1

if failures:
    print(f"\n{failures} test(s) failed")
    sys.exit(1)
print("\nAll tests passed")
