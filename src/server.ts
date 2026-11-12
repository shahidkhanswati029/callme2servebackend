import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { attachSocket } from "./realtime/socket";

const app = createApp();
const server = http.createServer(app);
const io = attachSocket(server);
app.set("io", io);

server.listen(env.PORT, () => {
  console.log(`CallMe2Serve API listening on http://localhost:${env.PORT}`);
  console.log(`Health: http://localhost:${env.PORT}/api/health`);
  console.log(`Socket.io attached on same process`);
});
