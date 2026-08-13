// PM2 production process manager
// วิธีใช้ (จากโฟลเดอร์ infra/):
//   npm i -g pm2
//   pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'sovereign-core-api',
      cwd: '../core-api',
      script: 'dist/server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      // บันทึก log ไปโฟลเดอร์ infra/logs (สร้างเอง)
      out_file: './logs/core-api.out.log',
      error_file: './logs/core-api.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
