import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <Stack>
        <Stack.Screen name="index" options={{ title: '꾸루룽음' }} />
        <Stack.Screen name="upload" options={{ title: '업로드' }} />
        <Stack.Screen name="search" options={{ title: '녹음 찾기' }} />
        <Stack.Screen name="recordings/[id]" options={{ title: '녹음' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
