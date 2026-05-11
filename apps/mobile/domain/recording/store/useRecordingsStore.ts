import { create } from 'zustand';

interface RecordingsState {
  /** 'idle' | 'stt' | 'embed' | 'saving' — used by upload screen to show progress */
  uploadStage: 'idle' | 'stt' | 'embed' | 'saving';
  setUploadStage: (s: RecordingsState['uploadStage']) => void;
}

export const useRecordingsStore = create<RecordingsState>((set) => ({
  uploadStage: 'idle',
  setUploadStage: (s) => set({ uploadStage: s }),
}));
