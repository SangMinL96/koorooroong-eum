# 꾸루룽음 (koorooroong-eum)

녹음 파일을 업로드하면 핸드폰 로컬 JSON에 임베딩과 함께 저장되고, 자연어 질의로 RAG 검색할 수 있는 모바일 앱.

## 구조

- `apps/server` — NestJS 경량 백엔드 (Whisper STT + Gemini 임베딩 + Gemini LLM)
- `apps/mobile` — Expo (React Native) 앱
- `packages/shared-types` — HTTP 컨트랙트 타입 공유

## 사전 준비

1. Node 20 (`.nvmrc` 사용 권장)
2. Yarn classic (`yarn -v` → 1.x)
3. Python 3.11+ (Whisper용 — 백엔드 의존)
4. Gemini API key

## 처음 실행

```bash
# 모든 워크스페이스 의존성 설치
yarn install

# 백엔드 .env 셋업
cp apps/server/.env.example apps/server/.env
# .env에서 GEMINI_API_KEY 입력

# (Apple Silicon Mac) Whisper venv 셋업
bash apps/server/scripts/setup-venv-whisper-arm64.sh

# 백엔드 띄우기 (port 4100)
yarn server:dev

# 별도 터미널에서 모바일 띄우기
yarn mobile:start
```

자세한 설계: `docs/specs/2026-05-11-voice-search-design.md`
자세한 계획: `docs/plans/2026-05-11-voice-search.md`

## Status

MVP 구현 완료 (2026-05-11). 사용자 수동 검증 필요:

1. `cp apps/server/.env.example apps/server/.env` 후 `GEMINI_API_KEY` 입력
2. Apple Silicon: `bash apps/server/scripts/setup-venv-whisper-arm64.sh`
3. `yarn server:dev` (port 4100)
4. `cd apps/mobile && yarn start` → Expo Go로 띄우기
5. 업로드 → 검색 흐름 E2E 확인

엔드포인트:
- `POST /api/stt` — multipart audio, returns `{transcript, chunks}`
- `POST /api/embed` — `{texts: string[]}` → `{vectors: number[][]}` (768-dim, text-embedding-004)
- `POST /api/ask` — `{question, contexts}` → `{answer, sources}` (gemini-2.5-flash)
