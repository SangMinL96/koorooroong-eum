// PM2 배포 설정. 서버에서 `pm2 start ecosystem.config.js` (또는 reload) 로 사용.
// 핵심: TZ=Asia/Seoul 로 Node/NestJS Logger 타임스탬프를 한국시간으로 고정.
module.exports = {
  apps: [
    {
      name: 'eum',
      // package.json 의 start 스크립트와 동일: node dist/main
      script: 'dist/main.js',
      cwd: __dirname,
      // PM2 로그 줄 앞에 타임스탬프 prefix 추가 (daemon TZ 기준).
      time: true,
      env: {
        NODE_ENV: 'production',
        // Node 의 new Date() · NestJS Logger 출력 시각을 한국시간으로.
        TZ: 'Asia/Seoul',
        PORT: 4011,
      },
    },
  ],
};
