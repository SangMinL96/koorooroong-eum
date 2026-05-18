import { create } from 'zustand';
import { enqueuePersistJobs, loadPersistedJobs } from './jobPersistence';

export type UploadStage = 'idle' | 'stt' | 'embed' | 'saving';

export interface UploadJobAsset {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
}

export interface UploadJob {
  /** UI 표시용 임시 이름 (사용자가 입력한 녹음 이름) */
  name: string;
  /** 현재 단계 */
  stage: Exclude<UploadStage, 'idle'>;
  /** 시작 시각 ms */
  startedAt: number;
  /** 이어 녹음이면 대상 녹음 id */
  appendTo?: string;
  /** 재시도/persist 를 위해 원본 파일 정보 보관. 텍스트 업로드 모드에서는 null. */
  asset: UploadJobAsset | null;
  /** 텍스트 업로드 모드에서 원본 텍스트(재시도용). 오디오 모드에서는 undefined. */
  textSource?: string;
}

export interface FailedJob extends UploadJob {
  /** 사용자에게 보여줄 실패 사유 */
  reason: string;
  failedAt: number;
}

interface RecordingsState {
  /** 단일 화면 위주의 즉시 진행률 표시용 (구버전 호환) */
  uploadStage: UploadStage;
  setUploadStage: (s: UploadStage) => void;

  /** 백그라운드로 진행 중인 업로드 작업. 화면 이동/재진입 후에도 상태 유지. */
  activeJob: UploadJob | null;
  /** 직전 업로드가 실패/중단됐을 때 홈에 노출할 정보. */
  failedJob: FailedJob | null;

  startJob: (job: Omit<UploadJob, 'stage' | 'startedAt'> & { stage?: UploadJob['stage'] }) => void;
  updateJobStage: (stage: UploadJob['stage']) => void;
  clearJob: () => void;
  markJobFailed: (reason: string) => void;
  clearFailedJob: () => void;
  /** 콜드런치 시 호출. 메모리에 activeJob 이 없는데 디스크에 남아 있으면 = JS 가 죽었던 것 → failedJob 으로 승급. */
  hydrate: () => Promise<void>;
}

export const useRecordingsStore = create<RecordingsState>((set, get) => {
  const persist = () => {
    const s = get();
    enqueuePersistJobs({ activeJob: s.activeJob, failedJob: s.failedJob });
  };

  return {
    uploadStage: 'idle',
    setUploadStage: (s) => set({ uploadStage: s }),

    activeJob: null,
    failedJob: null,

    startJob: (job) => {
      set({
        activeJob: {
          name: job.name,
          stage: job.stage ?? 'stt',
          startedAt: Date.now(),
          appendTo: job.appendTo,
          asset: job.asset,
          textSource: job.textSource,
        },
        failedJob: null,
      });
      persist();
    },
    updateJobStage: (stage) => {
      set((state) => (state.activeJob ? { activeJob: { ...state.activeJob, stage } } : state));
      persist();
    },
    clearJob: () => {
      set({ activeJob: null });
      persist();
    },
    markJobFailed: (reason) => {
      const cur = get().activeJob;
      if (!cur) {
        persist();
        return;
      }
      set({
        activeJob: null,
        failedJob: { ...cur, reason, failedAt: Date.now() },
      });
      persist();
    },
    clearFailedJob: () => {
      set({ failedJob: null });
      persist();
    },
    hydrate: async () => {
      // 이미 메모리 상태가 있으면 (백그라운드 → 포그라운드 복귀 등) 건드리지 않음.
      if (get().activeJob !== null || get().failedJob !== null) return;
      const p = await loadPersistedJobs();
      if (p.activeJob) {
        // 디스크엔 있는데 메모리엔 없다 = JS context 가 죽었다 = 업로드 중단.
        set({
          activeJob: null,
          failedJob: {
            ...p.activeJob,
            reason: '앱이 종료돼 업로드가 중단됐어요.',
            failedAt: Date.now(),
          },
        });
        persist();
      } else if (p.failedJob) {
        set({ failedJob: p.failedJob });
      }
    },
  };
});
