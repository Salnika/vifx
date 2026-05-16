const icon = require("./assets/icon.png");
const font = require("./assets/display.ttf");

export default function App() {
  return icon ?? font ?? null;
}
