# 꾸루룽음 — 모바일 음성 검색 앱 설계

작성일: 2026-05-11
상태: MVP

## 1. 한 줄 요약

녹음 파일(m4a/mp3/wav/webm)을 업로드하면 텍스트로 전사하고 임베딩 벡터를 함께 **핸드폰 로컬 JSON**에 저장한다. 자연어 질의로 모든 저장 녹음을 검색해 RAG 기반 답변 + 출처를 받는다. DB 없음, 사용자별 격리 없음(개인 디바이스).

## 2. 비범위 (MVP 밖)

- 인앱 실시간 녹음 (다음 이터레이션)
- 사용자 인증 / 멀티 디바이스 동기화
- 백그라운드 인덱싱 / 사전 필터
- 오프라인 STT/임베딩 (둘 다 클라우드 API 경유)

## 3. 아키텍처

```
[Expo 모바일 앱]                             [경량 NestJS 백엔드]
  ┌─────────────────┐                       ┌─────────────────┐
  │ 업로드 화면      │  multipart m4a  ───►  │ POST /stt       │
  │                 │  ◄── transcript +     │   Whisper(py)   │
  │                 │      chunks[]         │                 │
  │                 │                       │                 │
  │                 │  chunks[] (text) ───► │ POST /embed     │
  │                 │  ◄── vectors[][]      │   Gemini emb    │
  │                 │                       │                 │
  │ expo-file-      │                       │                 │
  │ system: write   │                       │                 │
  │ recordings/{id} │                       │                 │
  │ .json           │                       │                 │
  ├─────────────────┤                       │                 │
  │ 검색 화면        │  query text ──────►   │ POST /embed     │
  │                 │  ◄── query vector     │                 │
  │                 │                       │                 │
  │ 로컬 코사인 유사도 │                       │                 │
  │ Top-K 추출      │                       │                 │
  │                 │  {question, ctx} ──►  │ POST /ask       │
  │                 │  ◄── answer + src     │   Gemini LLM    │
  └─────────────────┘                       └─────────────────┘
```

## 4. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 모바일 | Expo + expo-router (RN) | iOS/Android 동시 |
| 모바일 상태 | Zustand | 가벼운 전역 상태 |
| 모바일 fetch | useSWR (swr) | 캐시/리밸리데이션 |
| 모바일 파일 | expo-file-system + expo-document-picker | document directory에 JSON |
| 백엔드 | NestJS 10 + @nestjs/platform-express | encar-meet 패턴 이식 |
| STT | Whisper (Python venv, child_process) | encar-meet 스크립트 그대로 이식 |
| 임베딩 | Gemini `text-embedding-004` (768차원) | `@google/genai` |
| LLM | Gemini `gemini-2.5-flash` | free tier 친화. Pro는 쿼터 0 |
| 패키지매니저 | yarn classic | 사용자 지정 |
| 타입 공유 | `packages/shared-types` | 워크스페이스 패키지 |

## 5. 디렉토리 구조

```
~/Documents/koorooroong-eum/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── _common/
│   │   │   │   ├── llm/llm.service.ts        # Gemini client (embed + chat)
│   │   │   │   ├── logger/logger.service.ts
│   │   │   │   └── chunk.ts                  # split + cosineSimilarity
│   │   │   ├── stt/
│   │   │   │   ├── stt.controller.ts          # POST /stt
│   │   │   │   ├── stt.service.ts             # Whisper 호출 + chunk
│   │   │   │   ├── stt.module.ts
│   │   │   │   ├── whisper.service.ts
│   │   │   │   └── python-venv-child-env.ts
│   │   │   ├── embed/
│   │   │   │   ├── embed.controller.ts        # POST /embed
│   │   │   │   ├── embed.service.ts
│   │   │   │   └── embed.module.ts
│   │   │   ├── ask/
│   │   │   │   ├── ask.controller.ts          # POST /ask
│   │   │   │   ├── ask.service.ts
│   │   │   │   └── ask.module.ts
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── scripts/
│   │   │   ├── whisper.py                     # encar-meet에서 그대로 이식
│   │   │   └── setup-venv-whisper-arm64.sh    # 동일
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   ├── nest-cli.json
│   │   └── .env.example                       # GEMINI_API_KEY, PORT
│   └── mobile/
│       ├── app/
│       │   ├── _layout.tsx                    # expo-router 루트
│       │   ├── index.tsx                      # 녹음 목록 (홈)
│       │   ├── upload.tsx                     # 업로드 화면
│       │   ├── search.tsx                     # 검색 화면
│       │   └── recordings/[id].tsx            # 녹음 상세
│       ├── domain/
│       │   ├── recording/
│       │   │   ├── api/uploadAudio.ts         # /stt + /embed 결합
│       │   │   ├── store/fileStore.ts         # FS IO
│       │   │   ├── store/useRecordingsStore.ts # zustand
│       │   │   ├── hooks/useRecordings.ts     # swr 래핑
│       │   │   └── types.ts                   # local types (RecordingFile)
│       │   └── search/
│       │       ├── api/embedQuery.ts
│       │       ├── api/askWithContexts.ts
│       │       └── search.ts                  # cosine + topK
│       ├── lib/
│       │   ├── api.ts                         # fetch wrapper
│       │   └── env.ts                         # EXPO_PUBLIC_API_HOST
│       ├── app.json
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared-types/
│       ├── src/index.ts                       # SttResponse, EmbedBody, AskBody, AskResponse, RecordingFile (?)
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   ├── specs/2026-05-11-voice-search-design.md
│   └── plans/2026-05-11-voice-search.md
├── package.json                               # 루트 workspaces
├── .gitignore
├── .nvmrc                                     # node 20
└── README.md
```

## 6. HTTP 컨트랙트

```ts
// shared-types

export interface SttResponse {
  /** 전체 전사 텍스트 (줄바꿈 포함) */
  transcript: string;
  /** 청크 분할된 텍스트 (서버에서 split). chunks.length === 임베딩할 청크 수 */
  chunks: string[];
}

export interface EmbedBody {
  texts: string[];
}

export interface EmbedResponse {
  /** 768차원 벡터. texts와 동일 순서 */
  vectors: number[][];
}

export interface AskContext {
  text: string;
  source: {
    recordingId: string;
    recordingName: string;
    chunkIndex: number;
    score: number;
  };
}

export interface AskBody {
  question: string;
  contexts: AskContext[];
}

export interface AskResponse {
  answer: string;
  /** 답변에 인용된 컨텍스트 (입력 contexts의 부분집합 또는 전부) */
  sources: AskContext['source'][];
}

/** 표준 응답 봉투 */
export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: string }
export type ApiResponse<T> = ApiOk<T> | ApiErr;
```

## 7. 로컬 저장 형식 (모바일)

- 디렉토리: `FileSystem.documentDirectory + 'recordings/'`
- 인덱스: `documentDirectory + 'index.json'`
  ```json
  {
    "version": 1,
    "recordings": [
      { "id": "rec_2026-05-11T15-30-00_abc", "name": "회의 - 컨셉 리뷰", "createdAt": "2026-05-11T15:30:00Z", "chunkCount": 12 }
    ]
  }
  ```
- 녹음 파일: `recordings/{id}.json`
  ```json
  {
    "id": "rec_...",
    "name": "...",
    "createdAt": "...",
    "transcript": "...",
    "chunks": [
      { "index": 0, "text": "...", "embedding": [0.123, 0.234, ...] }
    ]
  }
  ```
- 삭제: 파일 unlink + index.json 갱신
- 이름 변경: 본 파일 + index.json 동기 갱신

## 8. 검색 알고리즘 (클라이언트)

```ts
// search.ts
function cosineSimilarity(a: number[], b: number[]): number { ... }

async function searchTopK(query: string, k = 5): Promise<AskContext[]> {
  const queryVec = await embedQuery(query);
  const index = await readIndex();
  const all: { score: number; ctx: AskContext }[] = [];
  for (const meta of index.recordings) {
    const rec = await readRecording(meta.id);
    for (const chunk of rec.chunks) {
      const score = cosineSimilarity(queryVec, chunk.embedding);
      all.push({
        score,
        ctx: {
          text: chunk.text,
          source: { recordingId: rec.id, recordingName: rec.name, chunkIndex: chunk.index, score },
        },
      });
    }
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, k).map((x) => x.ctx);
}
```

녹음 수가 늘면 메모리 압박 가능. MVP 기준 수십 ~ 수백 개까지는 무리 없음.

## 9. 청크 분할

서버 `_common/chunk.ts`:

- 줄 단위(`\n`)로 split → trim → empty filter
- 합산 길이 ~600자(한국어 기준) 또는 sentence boundary로 청크 그룹핑
- 너무 짧은 줄(40자 미만)은 인접 청크에 병합
- 단순 함수, encar-meet의 `splitIntoChunks` 로직 참고

## 10. 에러 / 엣지 케이스

| 상황 | 처리 |
|---|---|
| 빈 m4a / 무음 → 빈 transcript | 서버 422, 앱 toast "음성이 인식되지 않았습니다" |
| Whisper 타임아웃 (>120s) | 서버 504, 앱 toast "전사가 너무 오래 걸립니다" |
| Gemini API 쿼터 초과 | 서버 502 + 원본 메시지, 앱 toast |
| 50MB 초과 업로드 | 서버 413, 앱 사전 검증으로 차단 |
| 지원하지 않는 MIME | 서버 415 |
| 로컬 저장 실패(용량 부족) | 앱 toast, 인덱스 무결성 유지 (저장 실패 시 index 갱신 안 함) |
| 검색 시 저장 녹음 0건 | 앱 빈 상태 안내, 서버 호출 안 함 |

## 11. 환경 변수

**apps/server/.env**
```
PORT=4100
GEMINI_API_KEY=...
WHISPER_PYTHON_BIN=...(optional, scripts에서 자동 탐색)
```

**apps/mobile/.env**
```
EXPO_PUBLIC_API_HOST=http://localhost:4100
```

## 12. 결정 로그

| 항목 | 결정 | 이유 |
|---|---|---|
| 백엔드 프레임워크 | NestJS | encar-meet 패턴 그대로 이식 |
| LLM 모델 | Gemini 2.5 Flash | 2.5 Pro는 free tier 쿼터 0 |
| 임베딩 위치 | 서버 경유 (앱에서 직접 호출 X) | API key 노출 방지 |
| 임베딩 차원 | 768 (text-embedding-004) | 모바일 저장 부담 적음 |
| 검색 위치 | 클라이언트 (코사인 유사도) | 모든 데이터가 로컬, 서버 round-trip 최소 |
| 청크 분할 위치 | 서버 (/stt 응답에 포함) | 단일 책임, 클라이언트는 chunk 그대로 사용 |
| Top-K | 5 | encar-meet과 동일 |
| 상태 관리 | Zustand + useSWR | 사용자 지정 |
| 네비게이션 | expo-router | Expo 기본, file-based routing |
| 인앱 녹음 | 범위 외 | 사용자 지정 |
