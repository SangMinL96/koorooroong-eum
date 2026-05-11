#!/usr/bin/env python3
"""
NestJS 등에서 subprocess 로 호출하는 faster-whisper 전사 CLI.

입력
  argv[1] : 디스크에 저장된 오디오 파일 절대/상대 경로 (m4a, wav, mp3 등)

출력
  표준출력 마지막에 **한 줄** JSON 만 낸다 (UTF-8).
  성공: {"text": "<전사 결과>"}
  실패: {"error": "<짧은 코드>", "message": "<사람이 읽을 설명>"}
  진행 로그는 표준에러만 사용한다.

환경 변수 (선택)
  ROOM_WHISPER_MODEL          기본 small
  ROOM_WHISPER_DEVICE         기본 cpu   (GPU 시 cuda)
  ROOM_WHISPER_COMPUTE_TYPE   기본 int8  (cuda 예: float16)
  ROOM_WHISPER_LANGUAGE       기본 ko    (비우면 자동 감지)
  ROOM_WHISPER_SITE_PACKAGES  site-packages 절대경로 (venv 밖에서 실행할 때)
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def _emit_result(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def _prepend_site_packages() -> None:
    sp = os.environ.get("ROOM_WHISPER_SITE_PACKAGES", "").strip()
    if sp and os.path.isdir(sp):
        sys.path.insert(0, sp)
        return
    venv = os.environ.get("VIRTUAL_ENV", "").strip()
    if not venv or not os.path.isdir(venv):
        return
    lib = os.path.join(venv, "lib")
    if not os.path.isdir(lib):
        return
    for name in os.listdir(lib):
        if not name.startswith("python"):
            continue
        cand = os.path.join(lib, name, "site-packages")
        if os.path.isdir(cand):
            sys.path.insert(0, cand)
            return
    win = os.path.join(venv, "Lib", "site-packages")
    if os.path.isdir(win):
        sys.path.insert(0, win)


def main() -> None:
    _prepend_site_packages()

    parser = argparse.ArgumentParser(description="Transcribe one audio file with faster-whisper (stdout JSON).")
    parser.add_argument("audio_path", help="Path to one audio file")
    args = parser.parse_args()
    audio_path = args.audio_path

    if not os.path.isfile(audio_path):
        _emit_result({"error": "file_not_found", "message": audio_path})
        sys.exit(2)

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        _emit_result({"error": "import_failed", "message": str(e)})
        sys.exit(3)

    model_name = os.environ.get("ROOM_WHISPER_MODEL", "small").strip() or "small"
    device = os.environ.get("ROOM_WHISPER_DEVICE", "cpu").strip() or "cpu"
    compute_type = os.environ.get("ROOM_WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"
    lang_raw = os.environ.get("ROOM_WHISPER_LANGUAGE", "ko").strip()
    language = lang_raw if lang_raw else None

    print(
        json.dumps(
            {"stage": "load_model", "model": model_name, "device": device, "compute_type": compute_type},
            ensure_ascii=False,
        ),
        file=sys.stderr,
        flush=True,
    )

    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    # 짧은 클립은 기본 VAD 가 전부 무음으로 걸러 빈 전사가 되는 경우가 있어 끈다.
    segments, _info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        vad_filter=False,
    )

    parts: list[str] = []
    for seg in segments:
        t = seg.text.strip()
        if t:
            parts.append(t)

    text = " ".join(parts).strip()
    _emit_result({"text": text})


if __name__ == "__main__":
    main()
