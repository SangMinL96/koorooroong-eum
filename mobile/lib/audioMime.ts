/** 파일명 확장자 → 보편적인 audio MIME. picker/share-intent 에서 mimeType 이 비었을 때 사용. */
export function inferAudioMime(name?: string | null): string {
  if (!name) return 'audio/m4a';
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  switch (ext) {
    case 'm4a':
    case 'mp4':
      return 'audio/m4a';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
    case 'wave':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'opus':
      return 'audio/opus';
    case 'flac':
      return 'audio/flac';
    case 'aiff':
    case 'aif':
      return 'audio/aiff';
    case '3gp':
    case '3gpp':
      return 'audio/3gpp';
    case 'amr':
      return 'audio/amr';
    default:
      return 'audio/m4a';
  }
}
