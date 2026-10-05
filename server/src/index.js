import { createJamServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const jam = createJamServer(config);

jam.server.listen(config.port, () => {
  console.log(`[jam] listening on http://localhost:${config.port} (origins: ${config.allowedOrigins.join(", ")})`);
});

const shutdown = () => { console.log("[jam] shutting down"); void jam.close().then(() => process.exit(0)); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
