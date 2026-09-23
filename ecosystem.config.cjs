// PM2 process manager config for a production deployment on the shop/server
// machine. Usage:
//   npm install -g pm2
//   npm run build            # builds the web app into apps/web/dist
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup  # so it survives a reboot
//
// This runs the API server, which also serves the built web app when
// apps/web/dist exists (see the static-serving block in
// apps/server/src/index.js), so in production you only need ONE process
// (plus the print agent on each shop PC, run separately via the installer).
module.exports = {
  apps: [
    {
      name: "autoprint-server",
      cwd: "./apps/server",
      script: "src/index.js",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
    },
  ],
};
