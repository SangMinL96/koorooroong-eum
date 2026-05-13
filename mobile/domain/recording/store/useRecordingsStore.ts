import { create } from 'zustand';

export type UploadStage = 'idle' | 'stt' | 'embed' | 'saving';

export interface UploadJob {
  /** UI 표시용 임시 이름 (사용자가 입력한 녹음 이름) */
  name: string;
  /** 현재 단계 */
  stage: Exclude<UploadStage, 'idle'>;
  /** 시작 시각 ms */
  startedAt: number;
  /** 이어 녹음이면 대상 녹음 id */
  appendTo?: string;
}

interface RecordingsState {
  /** 단일 화면 위주의 즉시 진행률 표시용 (구버전 호환) */
  uploadStage: UploadStage;
  setUploadStage: (s: UploadStage) => void;

  /** 백그라운드로 진행 중인 업로드 작업. 화면 이동/재진입 후에도 상태 유지. */
  activeJob: UploadJob | null;
  startJob: (job: Omit<UploadJob, 'stage' | 'startedAt'> & { stage?: UploadJob['stage'] }) => void;
  updateJobStage: (stage: UploadJob['stage']) => void;
  clearJob: () => void;
}

export const useRecordingsStore = create<RecordingsState>((set) => ({
  uploadStage: 'idle',
  setUploadStage: (s) => set({ uploadStage: s }),

  activeJob: null,
  startJob: (job) =>
    set({
      activeJob: {
        name: job.name,
        stage: job.stage ?? 'stt',
        startedAt: Date.now(),
        appendTo: job.appendTo,
      },
    }),
  updateJobStage: (stage) =>
    set((state) => (state.activeJob ? { activeJob: { ...state.activeJob, stage } } : state)),
  clearJob: () => set({ activeJob: null }),
}));
