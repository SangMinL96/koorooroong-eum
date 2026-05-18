import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { appendAudio, appendText, uploadAudio, uploadText } from '../api/uploadAudio';
import { useRecordingsStore, type UploadJobAsset } from '../store/useRecordingsStore';
import { recordingsKeys } from './useRecordings';

const KEEP_AWAKE_TAG = 'upload-job';

export type StartUploadInput =
  | { mode: 'new'; name: string; asset: UploadJobAsset }
  | { mode: 'append'; appendTo: string; asset: UploadJobAsset; name?: string }
  | { mode: 'new-text'; name: string; text: string }
  | { mode: 'append-text'; appendTo: string; text: string; name?: string };

/**
 * 업로드를 백그라운드 promise 로 실행. 핵심 동작:
 * - keep-awake 활성화로 잠금화면 → JS suspend 를 지연
 * - 성공: clearJob + SWR 무효화
 * - 실패: markJobFailed (Alert 대신) → 홈 배너로 노출, 재시도 가능
 * - native upload(uploadAudio 내부)가 iOS 백그라운드 URLSession 을 사용하므로 STT 단계는 앱 백그라운드에서도 끊기지 않음.
 */
export function useStartUpload() {
  const { mutate: globalMutate } = useSWRConfig();
  const startJob = useRecordingsStore((s) => s.startJob);
  const updateJobStage = useRecordingsStore((s) => s.updateJobStage);
  const clearJob = useRecordingsStore((s) => s.clearJob);
  const markJobFailed = useRecordingsStore((s) => s.markJobFailed);

  return useCallback(
    (input: StartUploadInput) => {
      const isAppend = input.mode === 'append' || input.mode === 'append-text';
      const isText = input.mode === 'new-text' || input.mode === 'append-text';
      const jobName = isAppend
        ? ((input as { name?: string }).name?.trim() || '이어 녹음')
        : (input as { name: string }).name;

      startJob({
        name: jobName,
        asset: isText ? null : (input as { asset: UploadJobAsset }).asset,
        textSource: isText ? (input as { text: string }).text : undefined,
        appendTo: isAppend ? (input as { appendTo: string }).appendTo : undefined,
        // 텍스트 모드는 STT 단계가 없으므로 embed 부터 시작.
        stage: isText ? 'embed' : 'stt',
      });

      (async () => {
        await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        try {
          if (input.mode === 'append') {
            await appendAudio(input.appendTo, input.asset, (s) => updateJobStage(s));
            globalMutate(recordingsKeys.list);
            globalMutate(recordingsKeys.byId(input.appendTo));
          } else if (input.mode === 'append-text') {
            await appendText(input.appendTo, input.text, (s) => updateJobStage(s));
            globalMutate(recordingsKeys.list);
            globalMutate(recordingsKeys.byId(input.appendTo));
          } else if (input.mode === 'new-text') {
            await uploadText(
              { name: jobName, text: input.text },
              (s) => updateJobStage(s),
            );
            globalMutate(recordingsKeys.list);
          } else {
            await uploadAudio(
              { name: jobName, asset: input.asset },
              (s) => updateJobStage(s),
            );
            globalMutate(recordingsKeys.list);
          }
          clearJob();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          markJobFailed(msg);
        } finally {
          deactivateKeepAwake(KEEP_AWAKE_TAG);
        }
      })();
    },
    [globalMutate, startJob, updateJobStage, clearJob, markJobFailed],
  );
}

/** 홈 배너의 "재시도" 동작용. failedJob 의 asset 으로 동일 흐름 재실행. */
export function useRetryFailedJob() {
  const start = useStartUpload();
  const failedJob = useRecordingsStore((s) => s.failedJob);
  const clearFailedJob = useRecordingsStore((s) => s.clearFailedJob);

  return useCallback(() => {
    if (!failedJob) return;
    const snapshot = failedJob;
    clearFailedJob();
    const isText = typeof snapshot.textSource === 'string' && snapshot.textSource.length > 0;
    if (snapshot.appendTo) {
      if (isText) {
        start({
          mode: 'append-text',
          appendTo: snapshot.appendTo,
          text: snapshot.textSource as string,
          name: snapshot.name,
        });
      } else if (snapshot.asset) {
        start({
          mode: 'append',
          appendTo: snapshot.appendTo,
          asset: snapshot.asset,
          name: snapshot.name,
        });
      }
    } else {
      if (isText) {
        start({ mode: 'new-text', name: snapshot.name, text: snapshot.textSource as string });
      } else if (snapshot.asset) {
        start({ mode: 'new', name: snapshot.name, asset: snapshot.asset });
      }
    }
  }, [failedJob, start, clearFailedJob]);
}
