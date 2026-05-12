import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSWRConfig } from 'swr';
import { uploadAudio } from '@/domain/recording/api/uploadAudio';
import { recordingsKeys } from '@/domain/recording/hooks/useRecordings';
import { useRecordingsStore } from '@/domain/recording/store/useRecordingsStore';
import { colors, radius, spacing, typography } from '@/lib/theme';

const STAGE_LABEL: Record<'idle' | 'stt' | 'embed' | 'saving', string> = {
  idle: '',
  stt: '음성을 텍스트로 변환 중...',
  embed: '임베딩 생성 중...',
  saving: '저장 중...',
};

export default function UploadScreen() {
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [name, setName] = useState('');
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const stage = useRecordingsStore((s) => s.uploadStage);
  const setStage = useRecordingsStore((s) => s.setUploadStage);
  const isWorking = stage !== 'idle';

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      // m4a 전용. iOS는 UTI, Android는 MIME 매칭이라 둘 다 지정해야 picker가 다른 포맷을 회색 처리한다.
      type: [
        'audio/m4a',
        'audio/x-m4a',
        'audio/mp4',
        'public.mpeg-4-audio',
        'com.apple.m4a-audio',
      ],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const picked = res.assets?.[0];
    if (picked) {
      setAsset(picked);
      if (!name.trim() && picked.name) {
        setName(picked.name.replace(/\.[^.]+$/, ''));
      }
    }
  };

  const submit = async () => {
    if (!asset) {
      Alert.alert('파일을 선택해주세요.');
      return;
    }
    try {
      setStage('stt');
      await uploadAudio(
        { name: name.trim() || asset.name || 'untitled', asset: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType } },
        (s) => setStage(s),
      );
      globalMutate(recordingsKeys.list);
      router.replace('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('업로드 실패', msg);
    } finally {
      setStage('idle');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.body}>
        <Text style={styles.label}>녹음 이름</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          editable={!isWorking}
          placeholder="예: 회의 - 컨셉 리뷰"
          style={styles.input}
        />

        <Text style={styles.label}>음성 파일 (.m4a)</Text>
        <Pressable onPress={pick} disabled={isWorking} style={styles.pickerBtn}>
          <Text style={styles.pickerBtnText}>{asset ? asset.name ?? '선택됨' : '파일 선택'}</Text>
        </Pressable>
        {asset?.size ? <Text style={styles.meta}>{(asset.size / (1024 * 1024)).toFixed(1)} MB</Text> : null}

        {isWorking ? (
          <View style={styles.progressBlock}>
            <ActivityIndicator />
            <Text style={styles.progressText}>{STAGE_LABEL[stage]}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable onPress={submit} disabled={!asset || isWorking} style={[styles.submit, (!asset || isWorking) && styles.submitDisabled]}>
          <Text style={styles.submitText}>{isWorking ? '업로드 중...' : '업로드'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { ...typography.label, color: colors.text, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.bodyLg,
    color: colors.text,
  },
  pickerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  pickerBtnText: { ...typography.body, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
  progressBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  progressText: { ...typography.bodySm, color: colors.textSecondary },
  footer: { padding: spacing.lg },
  submit: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: colors.onBrand, ...typography.button },
});
