#!/usr/bin/env python3
"""
NestJS 가 자식 프로세스로 띄워두고 **장기 실행**으로 재사용하는 faster-whisper 워커.

기존 호출당 1회 spawn 방식은 small 모델 로드만 5~15초가 매 요청마다 드는 게 문제였다.
이 워커는 부팅 시 모델을 1회 로드해두고 stdin 으로 라인 단위 JSON 요청을 받아
stdout 으로 라인 단위 JSON 응답을 돌려준다. 모델 로드 비용은 워커 생애 동안 1회만 발생.

프로토콜 (한 줄에 JSON 객체 하나, UTF-8)
  부모 → 자식 (stdin):
    {"type":"transcribe","id":"<반환할 id>","audioPath":"/tmp/...m4a","mimeType":"audio/m4a"}
  자식 → 부모 (stdout):
    워커 준비 완료: {"type":"ready","model":"small","device":"cpu","compute_type":"int8",...}
    성공:        {"type":"result","id":"...","text":"전사 결과"}
    실패:        {"type":"result","id":"...","error":"empty_audio","message":"..."}
  진행 로그: stderr 만 사용 (기존 패턴 유지) — 부모는 "stage" 키를 보고 로깅.

종료
  - stdin EOF → 정상 종료 (부모가 close stdin)
  - SIGTERM/SIGKILL → 부모가 강제 종료 (행/타임아웃 시)
  - 치명적 import 실패 시 fatal 응답 후 exit 3

환경 변수 (선택)
  ROOM_WHISPER_MODEL          기본 small
  ROOM_WHISPER_DEVICE         기본 cpu   (GPU 시 cuda)
  ROOM_WHISPER_COMPUTE_TYPE   기본 int8  (cuda 예: float16)
  ROOM_WHISPER_LANGUAGE       기본 ko    (비우면 자동 감지)
  ROOM_WHISPER_SITE_PACKAGES  site-packages 절대경로 (venv 밖에서 실행할 때)
  ROOM_WHISPER_BEAM_SIZE      기본 1     (1=greedy, 5=정확도↑/속도↓)
  ROOM_WHISPER_VAD_FILTER     기본 true  (false 면 무음 필터 끔. true 인데 전부 무음으로 걸러지면 자동 폴백)
"""
from __future__ import annotations

import json
import os
import sys
import traceback


def _emit_stdout(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _emit_stderr(obj: dict) -> None:
    sys.stderr.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def _prepend_site_packages() -> None:
    sp = os.environ.get("ROOM_WHISPER_SITE_PACKAGES", "").strip()
    if sp and os.path.isdir(sp):
        sys.path.insert(0, sp)
        return
    venv = os.environ.get("VIRTUAL_ENV", "").strip()
    if not venv or not os.path.isdir(venv):
        return
    lib = os.path.join(venv, "lib")
    if os.path.isdir(lib):
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


def _load_settings() -> dict:
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
    return {
        "model": model_name,
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "beam_size": beam_size,
        "vad_filter": vad_filter_default,
    }


def _transcribe_once(model, audio_path: str, settings: dict, use_vad: bool):
    return model.transcribe(
        audio_path,
        language=settings["language"],
        beam_size=settings["beam_size"],
        vad_filter=use_vad,
        # 무음 0.5s 이상만 잘라낸다. 짧은 무음은 유지 — 한국어 띄어말하기에서 의미 손실 방지.
        vad_parameters=dict(min_silence_duration_ms=500) if use_vad else None,
    )


def _do_transcribe(model, audio_path: str, settings: dict) -> str:
    segments, _info = _transcribe_once(model, audio_path, settings, settings["vad_filter"])
    parts: list[str] = []
    for seg in segments:
        t = seg.text.strip()
        if t:
            parts.append(t)
    if settings["vad_filter"] and not parts:
        _emit_stderr({"stage": "retry_no_vad", "reason": "empty_with_vad"})
        segments, _info = _transcribe_once(model, audio_path, settings, False)
        for seg in segments:
            t = seg.text.strip()
            if t:
                parts.append(t)
    return " ".join(parts).strip()


def _handle_request(model, settings: dict, req: dict) -> dict:
    req_id = req.get("id")
    audio_path = req.get("audioPath")
    if not isinstance(req_id, str) or not req_id:
        return {"type": "result", "id": "", "error": "bad_request", "message": "missing id"}
    if not isinstance(audio_path, str) or not audio_path:
        return {"type": "result", "id": req_id, "error": "bad_request", "message": "missing audioPath"}
    if not os.path.isfile(audio_path):
        return {"type": "result", "id": req_id, "error": "file_not_found", "message": audio_path}
    try:
        _emit_stderr({"stage": "transcribe_start", "id": req_id, "audioPath": audio_path})
        text = _do_transcribe(model, audio_path, settings)
        _emit_stderr({"stage": "transcribe_done", "id": req_id, "textLen": len(text)})
        return {"type": "result", "id": req_id, "text": text}
    except Exception as e:
        _emit_stderr({"stage": "transcribe_error", "id": req_id, "error": str(e), "trace": traceback.format_exc()[-1200:]})
        return {"type": "result", "id": req_id, "error": "transcribe_failed", "message": str(e)}


def main() -> None:
    _prepend_site_packages()

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        _emit_stdout({"type": "fatal", "error": "import_failed", "message": str(e)})
        sys.exit(3)

    settings = _load_settings()
    _emit_stderr(
        {
            "stage": "load_model",
            "model": settings["model"],
            "device": settings["device"],
            "compute_type": settings["compute_type"],
            "beam_size": settings["beam_size"],
            "vad_filter": settings["vad_filter"],
        }
    )

    try:
        model = WhisperModel(settings["model"], device=settings["device"], compute_type=settings["compute_type"])
    except Exception as e:
        _emit_stdout({"type": "fatal", "error": "model_load_failed", "message": str(e)})
        _emit_stderr({"stage": "model_load_failed", "error": str(e), "trace": traceback.format_exc()[-1200:]})
        sys.exit(4)

    _emit_stdout(
        {
            "type": "ready",
            "model": settings["model"],
            "device": settings["device"],
            "compute_type": settings["compute_type"],
            "beam_size": settings["beam_size"],
            "vad_filter": settings["vad_filter"],
        }
    )

    # `for line in sys.stdin` 은 파이프 모드에서 read-ahead 버퍼링이 일어나 한 요청이 즉시 도착하지 않을 수 있다.
    # 명시적 readline() 루프로 라인 단위 즉시 처리.
    while True:
        raw = sys.stdin.readline()
        if not raw:  # EOF
            break
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            _emit_stdout({"type": "result", "id": "", "error": "bad_json", "message": str(e)})
            continue
        if not isinstance(req, dict):
            _emit_stdout({"type": "result", "id": "", "error": "bad_request", "message": "request must be object"})
            continue
        if req.get("type") != "transcribe":
            _emit_stdout({"type": "result", "id": req.get("id", ""), "error": "bad_request", "message": "unknown type"})
            continue
        response = _handle_request(model, settings, req)
        _emit_stdout(response)


if __name__ == "__main__":
    main()
