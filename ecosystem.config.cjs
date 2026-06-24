// PM2 process config for the production Nuxt server.
// Loads runtime secrets from .env via Node's native --env-file (Node >= 20.6).
// Binds to 127.0.0.1 only — public traffic is terminated by nginx (TLS) and
// reverse-proxied to this port.
module.exports = {
  apps: [
    {
      name: "careers",
      cwd: "/root/wp/reqcore",
      script: ".output/server/index.mjs",
      node_args: "--env-file=/root/wp/reqcore/.env",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3000",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: "3000",
      },
    },
  ],
};
