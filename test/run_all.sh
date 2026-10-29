#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash test/build_host.sh
python3 test/test_configuration.py
python3 test/test_deployment_guard.py
python3 test/test_integration.py
