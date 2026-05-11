# 꾸루룽음 MVP 구현 계획

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 녹음 파일 업로드 → STT → 임베딩 → 핸드폰 로컬 JSON 저장 → 자연어 RAG 검색까지의 흐름을 새 모노레포(`~/Documents/koorooroong-eum`)에 구현한다.

**Architecture:** NestJS 경량 백엔드(STT/embed/ask 3개 엔드포인트) + Expo 모바일 앱(expo-router, Zustand, useSWR). 모든 녹음 데이터(텍스트+임베딩)는 디바이스 documentDirectory 안 JSON으로 저장.

**Tech Stack:** NestJS 10, Whisper Python(이식), `@google/genai`(text-embedding-004 + gemini-2.5-flash), Expo SDK ~50, expo-router, expo-file-system, expo-document-picker, Zustand, SWR, yarn workspaces.

**Repo:** `/Users/encr23n10077/Documents/koorooroong-eum`
**Spec:** `docs/specs/2026-05-11-voice-search-design.md`
**Reference:** `~/Documents/encar-meet` (Whisper/Gemini/청크 로직 — 카피 후 정리)

---

## Task 0: 모노레포 골격

**Files:** `package.json` (workspaces), `.gitignore`, `README.md`, `.nvmrc`

- Yarn classic workspaces: `apps/*`, `packages/*`
- `.gitignore`: node_modules, dist, .env, Expo 산출물(.expo, web-build), IDE
- `.nvmrc`: 20
- `README.md`: 한 페이지 시작 가이드 (apps/server dev, apps/mobile dev)

**Verify:** `yarn -v`, `git status -s`, `cat package.json | jq .workspaces`. 첫 commit.

---

## Task 1: shared-types 패키지

**Files:** `packages/shared-types/{package.json,tsconfig.json,src/index.ts}`

- `name: "@koorooroong-eum/shared-types"`, `private: true`, build: `tsc`
- Exports: `SttResponse, EmbedBody, EmbedResponse, AskBody, AskResponse, AskContext, ApiResponse, ApiOk, ApiErr` (정확한 형태는 spec §6)

**Verify:** `cd packages/shared-types && yarn install && yarn build`. dist/index.d.ts에 모든 타입 노출. Commit.

---

## Task 2: server NestJS 골격

**Files:** `apps/server/{package.json,tsconfig.json,tsconfig.build.json,nest-cli.json,src/main.ts,src/app.module.ts,.env.example}`

- 의존성: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `@google/genai`, `reflect-metadata`, `rxjs`, `multer`, dev: `@nestjs/cli`, `typescript`, `ts-node`, `@types/express`, `@types/multer`, `@types/node`
- main.ts: NestFactory, `app.setGlobalPrefix('api')` (encar-meet은 `api/v1`이었지만 새 프로젝트는 단순화), CORS enabled, body limits 1mb (multer로 큰 업로드 따로 처리), port from `process.env.PORT ?? 4100`
- app.module.ts: `ConfigModule.forRoot({ isGlobal: true })` + 나중에 stt/embed/ask 모듈 import (이 task에서는 빈 imports)
- .env.example: `PORT=4100`, `GEMINI_API_KEY=`

**Verify:** `cd apps/server && yarn build && yarn start` (3초 후 SIGINT). 콘솔에 "running on http://localhost:4100" 출력. Commit.

---

## Task 3: Whisper 자산 이식

**Files:**
- `apps/server/scripts/whisper.py` ← copy from `~/Documents/encar-meet/apps/server/scripts/whisper.py`
- `apps/server/scripts/setup-venv-whisper-arm64.sh` ← copy from encar-meet
- `apps/server/scripts/requirements-whisper.txt` (or .python-version) — encar-meet에 있으면 copy
- `apps/server/src/stt/python-venv-child-env.ts` ← copy from encar-meet
- `apps/server/src/stt/whisper-paths.ts` ← copy + 경로 상수만 새 레포 기준으로 수정

**Verify:** 파일들이 실행권한 유지(`chmod +x` 필요할 수 있음). `python3 apps/server/scripts/whisper.py --help` 또는 venv 없이도 import 동작은 다음 task에서 검증. Commit.

---

## Task 4: server _common (LLM + chunk + logger)

**Files:**
- `apps/server/src/_common/llm/llm.service.ts` — Gemini client. `embedTexts(texts: string[]): Promise<number[][]>` (text-embedding-004) + `generateAnswer(systemPrompt, userPrompt): Promise<string>` (gemini-2.5-flash). encar-meet의 LlmService 카피 후 모델만 flash로 변경.
- `apps/server/src/_common/llm/llm.module.ts`
- `apps/server/src/_common/logger/logger.service.ts` — Nest Logger 래핑(encar-meet에서 가져와도 되고 minimal)
- `apps/server/src/_common/logger/logger.module.ts`
- `apps/server/src/_common/chunk.ts` — `splitIntoChunks(text: string): string[]` + `cosineSimilarity(a, b)` — encar-meet에서 가져옴

**Verify:** `yarn build` 통과. Commit.

---

## Task 5: STT 모듈 (POST /stt)

**Files:**
- `apps/server/src/stt/whisper.service.ts` — encar-meet의 `RoomWhisperService.transcribe(base64, mimeType)` 카피 + 새 경로 사용
- `apps/server/src/stt/stt.service.ts` — `transcribeAndChunk(buffer, mimeType): Promise<{ transcript: string; chunks: string[] }>`
- `apps/server/src/stt/stt.controller.ts` — `@Post('/stt')`, `FileInterceptor('file')`, MIME 화이트리스트(audio/m4a, audio/mp4, audio/x-m4a, audio/mpeg, audio/mp3, audio/wav, audio/x-wav, audio/webm), 50MB 제한. 빈 transcript → 422.
- `apps/server/src/stt/stt.module.ts`
- `apps/server/src/app.module.ts` 업데이트: SttModule import

**Verify:** `yarn build` 통과. (curl 통합 테스트는 venv가 셋업되어야 가능 — 사용자 수동 검증으로 미룸.) Commit.

---

## Task 6: Embed 모듈 (POST /embed)

**Files:**
- `apps/server/src/embed/embed.service.ts` — `embedTexts(texts: string[]): Promise<number[][]>` (LlmService 위임)
- `apps/server/src/embed/embed.controller.ts` — `@Post('/embed')`, body `{texts}` 검증(빈 배열 400, length>200 400)
- `apps/server/src/embed/embed.module.ts`
- app.module.ts 업데이트

**Verify:** `yarn build` 통과. Commit.

---

## Task 7: Ask 모듈 (POST /ask)

**Files:**
- `apps/server/src/ask/ask.service.ts` — `ask({question, contexts}): Promise<{answer, sources}>`. contexts는 클라이언트가 이미 Top-K 추려서 보낸다. systemPrompt: "회의록 컨텍스트 기반 한국어 답변, 컨텍스트에 없으면 모른다고 답하고, 답변에 사용한 출처를 명시." 답변 텍스트와 sources(=contexts.map(c=>c.source))를 함께 반환.
- `apps/server/src/ask/ask.controller.ts` — `@Post('/ask')`, body 검증
- `apps/server/src/ask/ask.module.ts`
- app.module.ts 업데이트

**Verify:** `yarn build` + 가벼운 단위 호출 가능시 mock curl. Commit.

---

## Task 8: Expo 모바일 골격

**Files:** `apps/mobile/{package.json,app.json,tsconfig.json,babel.config.js,metro.config.js?,app/_layout.tsx,app/index.tsx (placeholder)}`

- 의존성: `expo`, `expo-router`, `expo-file-system`, `expo-document-picker`, `react`, `react-native`, `zustand`, `swr`, `react-native-safe-area-context`, `react-native-screens`, `expo-status-bar`, dev: `@babel/core`, `typescript`, `@types/react`
- expo-router 셋업: app/_layout.tsx에 `<Stack/>`
- index.tsx: 단순 placeholder "꾸루룽음" 표시
- .env.example: `EXPO_PUBLIC_API_HOST=http://localhost:4100`
- `app.json` 기본 설정 (slug, scheme, ios/android bundle ID)

**Verify:** `cd apps/mobile && yarn install`. `yarn tsc --noEmit` 통과. (`yarn start` 실제 디바이스 띄우는 건 사용자 수동.) Commit.

---

## Task 9: mobile lib/api.ts + env.ts

**Files:** `apps/mobile/lib/{api.ts,env.ts}`

- env.ts: `API_HOST = process.env.EXPO_PUBLIC_API_HOST!`
- api.ts: 최소 fetch wrapper. multipart 업로드 + JSON 두 경우 다 지원. 응답이 `{ok,data} | {ok:false,error}` 봉투 형식 — 에러면 throw.
  ```ts
  export async function apiPost<T>(path: string, body: unknown, init?: RequestInit & {multipart?: boolean}): Promise<T>
  ```

**Verify:** tsc 통과. Commit.

---

## Task 10: 파일 스토어 (recording IO)

**Files:** `apps/mobile/domain/recording/{store/fileStore.ts,types.ts}`

- types.ts: `RecordingFile`, `RecordingChunk`, `RecordingIndex`, `RecordingMeta`
- fileStore.ts:
  - `readIndex(): Promise<RecordingIndex>` — 없으면 `{version:1, recordings:[]}` 반환
  - `writeIndex(i)`
  - `readRecording(id): Promise<RecordingFile>` 
  - `writeRecording(rec)`
  - `deleteRecording(id)`
  - `listRecordings(): Promise<RecordingMeta[]>` — index 기반
- 모두 expo-file-system 사용. JSON 직렬화.

**Verify:** tsc 통과. Commit.

---

## Task 11: zustand + swr 훅

**Files:** `apps/mobile/domain/recording/{store/useRecordingsStore.ts,hooks/useRecordings.ts}`

- `useRecordingsStore` — zustand. 단순 상태(`refreshKey: number`)로 SWR revalidation 트리거용. 또는 일시적 업로드 진행 상태 보관.
- `useRecordings()` — swr key `'recordings'` + fetcher `listRecordings()`. 업로드/삭제 후 `mutate('recordings')` 호출.

**Verify:** tsc 통과. Commit.

---

## Task 12: 업로드 도메인 (recording/api/uploadAudio.ts)

**Files:** `apps/mobile/domain/recording/api/uploadAudio.ts`

- `uploadAudio({name, asset}): Promise<RecordingFile>` 
  1) FormData 만들어 `POST /stt` → `{transcript, chunks}` 
  2) `POST /embed { texts: chunks }` → `{vectors}` 
  3) id 생성(`rec_${ISO}_${nanoid}`) → `RecordingFile` 만들기 
  4) `writeRecording` + index 갱신 
  5) 결과 반환
- 진행상태 콜백(`onProgress?: (stage) => void`) — 단순 stage string ('stt' | 'embed' | 'saving')

**Verify:** tsc 통과. Commit.

---

## Task 13: 검색 도메인

**Files:** `apps/mobile/domain/search/{api/embedQuery.ts,api/askWithContexts.ts,search.ts}`

- `embedQuery(q): Promise<number[]>` — `/embed` 호출, `vectors[0]` 반환
- `askWithContexts({question, contexts})` — `/ask` 호출
- `search.ts`:
  - `cosineSimilarity(a, b)`
  - `searchTopK(query, k=5): Promise<AskContext[]>` — 인덱스 로드 → 모든 청크 코사인 → Top-K

**Verify:** tsc 통과. Commit.

---

## Task 14: 홈 화면 (녹음 목록)

**Files:** `apps/mobile/app/index.tsx`

- 헤더: "꾸루룽음" + 우측 상단 "검색" 버튼(→ /search), FAB 또는 헤더 우측에 "업로드" 버튼(→ /upload)
- 본문: `useRecordings()`로 목록. 카드: name, createdAt, chunkCount. 카드 탭 → `/recordings/[id]`.
- 빈 상태: "녹음을 업로드해 시작하세요" + 업로드 CTA

**Verify:** tsc + Expo Go 또는 simulator에서 lint. Commit.

---

## Task 15: 업로드 화면

**Files:** `apps/mobile/app/upload.tsx`

- 입력: 녹음 이름(TextInput), expo-document-picker로 오디오 파일 선택 (`type: ['audio/*']`)
- 업로드 버튼 → `uploadAudio({name, asset})` 호출. stage 표시 (STT 중 / 임베딩 중 / 저장 중)
- 성공 시 `mutate('recordings')` + `router.replace('/')`
- 실패 시 Alert.

**Verify:** tsc 통과. Commit.

---

## Task 16: 검색 화면

**Files:** `apps/mobile/app/search.tsx`

- 상단: 질문 입력 + 검색 버튼
- 로직: 빈 인덱스면 "녹음이 없습니다" → 검색 안 함. 아니면 `searchTopK` → Top-K 컨텍스트 만들어 `askWithContexts` 호출.
- 결과 영역:
  - 답변 텍스트
  - 출처 목록: 카드별 `recordingName · chunk #i · score`. 탭하면 `/recordings/[id]`로 이동.
- 진행상태 indicator.

**Verify:** tsc 통과. Commit.

---

## Task 17: 녹음 상세 화면

**Files:** `apps/mobile/app/recordings/[id].tsx`

- 헤더: name, createdAt, 우측에 "삭제" 버튼
- 본문: 전체 transcript 표시 (스크롤). 청크 단위 표시도 가능하지만 MVP는 transcript 그대로.
- 삭제 시 확인 Alert → `deleteRecording(id)` + `mutate('recordings')` + `router.back()`

**Verify:** tsc 통과. Commit.

---

## Task 18: 최종 검증

- 루트에서 `yarn install` 시 모노레포 전체 의존성 정상 설치
- `cd apps/server && yarn build` ✅
- `cd apps/mobile && yarn tsc --noEmit` ✅
- `cd packages/shared-types && yarn build` ✅
- README의 시작 가이드 갱신 (실제 명령어 검증)
- 마지막 commit: `chore: README update`

이후 사용자 수동 검증:
1. `apps/server`에 `.env` 생성 + `GEMINI_API_KEY` 입력
2. Python venv 셋업 (`bash apps/server/scripts/setup-venv-whisper-arm64.sh`)
3. `cd apps/server && yarn dev` — 4100 포트 기동
4. `cd apps/mobile && yarn start` — Expo Go로 띄우기
5. 업로드 → 검색 흐름 E2E 확인

---

## 작업 노트

- encar-meet의 `apps/server/src/_common/llm/llm.service.ts`와 `room-whisper.service.ts`를 참고/이식하되, 새 프로젝트에는 ticket/room 같은 도메인 개념 없음 — 단순한 stateless 서비스로 정리.
- 모델 ID: `text-embedding-004` (embed), `gemini-2.5-flash` (ask). Gemini 2.5 Pro는 free tier 쿼터 0이므로 피한다.
- LLM 응답 파서: encar-meet의 generateAnswer 형식 그대로.
- Whisper Python venv 셋업은 사용자가 직접 — 이 plan에서는 스크립트 파일만 이식.
- 모든 task는 `yarn build` / `tsc --noEmit` 통과 + git commit으로 종결.
