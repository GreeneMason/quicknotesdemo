// PM2 ecosystem config for QuickNotes
// Usage: pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'quicknotes-api',
      script: './apps/backend/server.js',

      // Run from repo root so relative paths resolve correctly
      cwd: '/home/ec2-user/app',

      // Number of instances — 'max' uses all CPU cores; set to 1 for t3.micro
      instances: 1,
      exec_mode: 'fork',

      // Restart policy
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      restart_delay: 3000,

      env: {
        NODE_ENV: 'development',
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        // All other env vars (DB_*, JWT_SECRET, etc.) must be in the .env file
        // or set via: pm2 set quicknotes-api:DB_PASSWORD <value>
      },

      // Log configuration
      out_file: '/home/ec2-user/logs/quicknotes-out.log',
      error_file: '/home/ec2-user/logs/quicknotes-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
