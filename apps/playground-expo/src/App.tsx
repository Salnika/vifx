// @ts-ignore -- playground import intentionally exercises asset handling.
import iconUrl from "./assets/icon.svg";
// @ts-ignore -- playground import intentionally exercises platform file resolution.
import { message } from "./message";

type PlaygroundImportMeta = ImportMeta & {
  env: {
    EXPO_PUBLIC_VIFX_PLAYGROUND?: string;
  };
};

const playgroundEnv = (import.meta as PlaygroundImportMeta).env.EXPO_PUBLIC_VIFX_PLAYGROUND;

console.log(message, iconUrl, playgroundEnv);

export default function App() {
  return null;
}
