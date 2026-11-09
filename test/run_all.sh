#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash test/build_host.sh
python3 test/test_configuration.py
python3 test/test_catalog_build.py
python3 test/test_refresh_benchmark.py
python3 test/test_native_worker.py
python3 test/test_deployment_guard.py
python3 test/test_integration.py
