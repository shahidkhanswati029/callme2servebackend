import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { attachSocket } from "./realtime/socket";

const app = createApp();
const server = http.createServer(app);
const io = attachSocket(server);
app.set("io", io);

const host = "0.0.0.0";
server.listen(env.PORT, host, () => {
  console.log(`CallMe2Serve API listening on http://${host}:${env.PORT}`);
  console.log(`Health: http://${host}:${env.PORT}/api/health`);
  console.log(`Socket.io attached on same process`);
});
