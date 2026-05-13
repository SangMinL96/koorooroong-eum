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
  ROOM_WHISPER_BEAM_SIZE      기본 1     (1=greedy, 5=정확도↑/속도↓. 회의 한국어는 1로도 충분)
  ROOM_WHISPER_VAD_FILTER     기본 true  (false 면 무음 필터 끔. true 인데 전부 무음으로 걸러지면 자동 폴백)
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

    beam_raw = os.environ.get("ROOM_WHISPER_BEAM_SIZE", "1").strip() or "1"
    try:
        beam_size = max(1, int(beam_raw))
    except ValueError:
        beam_size = 1

    vad_raw = os.environ.get("ROOM_WHISPER_VAD_FILTER", "true").strip().lower()
    vad_filter_default = vad_raw not in ("0", "false", "no", "off")

    print(
        json.dumps(
            {
                "stage": "load_model",
                "model": model_name,
                "device": device,
                "compute_type": compute_type,
                "beam_size": beam_size,
                "vad_filter": vad_filter_default,
            },
            ensure_ascii=False,
        ),
        file=sys.stderr,
        flush=True,
    )

    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    def _do_transcribe(use_vad: bool):
        return model.transcribe(
            audio_path,
            language=language,
            beam_size=beam_size,
            vad_filter=use_vad,
            # 무음 0.5s 이상만 잘라낸다. 짧은 무음은 유지 — 한국어 띄어말하기에서 의미 손실 방지.
            vad_parameters=dict(min_silence_duration_ms=500) if use_vad else None,
        )

    segments, _info = _do_transcribe(vad_filter_default)
    parts: list[str] = []
    for seg in segments:
        t = seg.text.strip()
        if t:
            parts.append(t)

    # VAD 가 켜진 채로 전부 무음으로 걸러져 빈 전사가 됐으면, VAD 끄고 한 번 더 시도 (짧은 클립 보호).
    if vad_filter_default and not parts:
        print(
            json.dumps({"stage": "retry_no_vad", "reason": "empty_with_vad"}, ensure_ascii=False),
            file=sys.stderr,
            flush=True,
        )
        segments, _info = _do_transcribe(False)
        for seg in segments:
            t = seg.text.strip()
            if t:
                parts.append(t)

    text = " ".join(parts).strip()
    _emit_result({"text": text})


if __name__ == "__main__":
    main()
