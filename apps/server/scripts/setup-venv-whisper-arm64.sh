#!/usr/bin/env bash
# Apple Silicon: arm64 인터프리터 + arm64 네이티브 휠(ctranslate2, av 등)로 .venv-whisper 를 만든다.
# Rosetta(x86_64) 터미널에서 실행해도 arch -arm64 로 venv·pip 를 돌린다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# apps/server/scripts -> ../../.. = 모노레포 루트
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REQ="${REPO_ROOT}/apps/server/scripts/requirements-whisper.txt"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "이 스크립트는 macOS 전용입니다. 다른 OS 에서는 python3 -m venv .venv-whisper 후 pip install -r ... 를 사용하세요." >&2
  exit 1
fi

if [[ ! -f "${REQ}" ]]; then
  echo "requirements 없음: ${REQ}" >&2
  exit 1
fi

ARCH_ARM64=(/usr/bin/arch -arm64)
# Xcode CLT / 시스템 파이썬 (유니버설2) — arm64 슬라이스로 venv 생성
BOOTSTRAP_PY="${BOOTSTRAP_PY:-/usr/bin/python3}"

if [[ "${FORCE_WHISPER_VENV_REBUILD:-0}" == "1" ]]; then
  echo "FORCE_WHISPER_VENV_REBUILD=1 → ${REPO_ROOT}/.venv-whisper 삭제 후 재생성"
  rm -rf "${REPO_ROOT}/.venv-whisper"
fi

cd "${REPO_ROOT}"
if [[ ! -d .venv-whisper ]]; then
  echo "venv 생성: ${ARCH_ARM64[*]} ${BOOTSTRAP_PY} -m venv .venv-whisper"
  "${ARCH_ARM64[@]}" "${BOOTSTRAP_PY}" -m venv .venv-whisper
fi

VENV_PY="${REPO_ROOT}/.venv-whisper/bin/python"
VENV_PIP="${REPO_ROOT}/.venv-whisper/bin/pip"

echo "pip 업그레이드 및 faster-whisper 설치 (arm64)…"
"${ARCH_ARM64[@]}" "${VENV_PY}" -m pip install -U pip
"${ARCH_ARM64[@]}" "${VENV_PIP}" install -r "${REQ}"

echo "검증: arm64 로 faster_whisper import"
"${ARCH_ARM64[@]}" "${VENV_PY}" -c "import faster_whisper; print('faster_whisper OK')"

echo "완료: ${VENV_PY}"
