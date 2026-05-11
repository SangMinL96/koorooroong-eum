/** 표준 응답 봉투 */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** POST /stt — multipart/form-data 업로드 (field: file) */
export interface SttResponse {
  /** 전체 전사 텍스트 (줄바꿈 포함) */
  transcript: string;
  /** 서버에서 청크 분할된 텍스트. 임베딩할 단위와 1:1 대응. */
  chunks: string[];
}

/** POST /embed */
export interface EmbedBody {
  texts: string[];
}

export interface EmbedResponse {
  /** 768차원 벡터 배열 (text-embedding-004). texts와 동일 순서. */
  vectors: number[][];
}

/** POST /ask — 클라이언트가 로컬 검색한 Top-K 컨텍스트를 함께 전달한다. */
export interface AskSource {
  recordingId: string;
  recordingName: string;
  chunkIndex: number;
  /** 클라이언트 측 코사인 유사도 점수 (0~1) */
  score: number;
}

export interface AskContext {
  text: string;
  source: AskSource;
}

export interface AskBody {
  question: string;
  contexts: AskContext[];
}

export interface AskResponse {
  answer: string;
  /** 답변에 사용된 출처들 (요청 contexts의 부분집합) */
  sources: AskSource[];
}
