#!/usr/bin/env bash
# Linux (Ubuntu/Debian 계열) 환경에서 .venv-whisper 를 만든다.
# 모노레포 루트의 .venv-whisper 경로에 격리된 Python 환경을 구축하고,
# faster-whisper 및 의존성을 설치한다.
#
# 사용법:
#   bash apps/server/scripts/setup-venv-whisper-linux.sh
#
# 환경변수:
#   BOOTSTRAP_PY                   venv 부트스트랩에 쓸 시스템 python (기본: python3)
#   FORCE_WHISPER_VENV_REBUILD=1   기존 .venv-whisper 삭제 후 재생성

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# apps/server/scripts -> ../../.. = 모노레포 루트
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
REQ="${REPO_ROOT}/apps/server/scripts/requirements-whisper.txt"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "이 스크립트는 Linux 전용입니다. macOS 는 setup-venv-whisper-arm64.sh 를 사용하세요." >&2
  exit 1
fi

if [[ ! -f "${REQ}" ]]; then
  echo "requirements 없음: ${REQ}" >&2
  exit 1
fi

BOOTSTRAP_PY="${BOOTSTRAP_PY:-python3}"

# 시스템 의존성 사전 점검 — 자동 sudo 설치는 하지 않고, 안내만 출력한다.
missing=()
if ! command -v "${BOOTSTRAP_PY}" >/dev/null 2>&1; then
  missing+=("python3")
fi
if ! "${BOOTSTRAP_PY}" -c "import venv" 2>/dev/null; then
  missing+=("python3-venv")
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  missing+=("ffmpeg")
fi
if ! ldconfig -p 2>/dev/null | grep -q "libsndfile"; then
  missing+=("libsndfile1")
fi

if (( ${#missing[@]} > 0 )); then
  echo "시스템 의존성이 없습니다: ${missing[*]}" >&2
  echo "다음 명령으로 설치 후 다시 실행하세요:" >&2
  echo "  sudo apt-get update && sudo apt-get install -y ${missing[*]}" >&2
  exit 1
fi

if [[ "${FORCE_WHISPER_VENV_REBUILD:-0}" == "1" ]]; then
  echo "FORCE_WHISPER_VENV_REBUILD=1 → ${REPO_ROOT}/.venv-whisper 삭제 후 재생성"
  rm -rf "${REPO_ROOT}/.venv-whisper"
fi

cd "${REPO_ROOT}"
if [[ ! -d .venv-whisper ]]; then
  echo "venv 생성: ${BOOTSTRAP_PY} -m venv .venv-whisper"
  "${BOOTSTRAP_PY}" -m venv .venv-whisper
fi

VENV_PY="${REPO_ROOT}/.venv-whisper/bin/python"
VENV_PIP="${REPO_ROOT}/.venv-whisper/bin/pip"

echo "pip 업그레이드 및 faster-whisper 설치…"
"${VENV_PY}" -m pip install -U pip
"${VENV_PIP}" install -r "${REQ}"

echo "검증: faster_whisper import"
"${VENV_PY}" -c "import faster_whisper; print('faster_whisper:', faster_whisper.__version__)"

ARCH="$(uname -m)"
echo
echo "완료: ${VENV_PY} (arch=${ARCH})"
echo
echo "다음 단계 — 서버가 이 venv 를 사용하도록 환경변수 설정:"
echo "  export ROOM_WHISPER_PYTHON='${VENV_PY}'"
echo "또는 apps/server/.env 에 추가:"
echo "  ROOM_WHISPER_PYTHON=${VENV_PY}"
