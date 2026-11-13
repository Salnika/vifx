#!/usr/bin/env node
// Broadcasts one packager message (default: "reload") to the apps connected to
// a dev server's /message socket — Metro's, Expo CLI's or vifx's; they share
// the protocol. Usage:
//   vp node scripts/dev/send-message.mjs <http://host:port> [method]
const [baseUrl, method = "reload"] = process.argv.slice(2);
if (!baseUrl) {
  console.error("usage: send-message.mjs <http://host:port> [method]");
  process.exit(1);
}

const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}/message`);
socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ method, version: 2 }));
  // Give the frame time to leave before closing.
  setTimeout(() => {
    socket.close();
    console.log(`sent "${method}" to ${baseUrl}/message`);
  }, 200);
});
socket.addEventListener("error", () => {
  console.error(`could not reach ${baseUrl}/message`);
  process.exit(1);
});
