import { cssInterop, styled, verifyInstallation } from "nativewind";
// NativeWind apps import the Tailwind CSS entry so the Metro transform can
// compile utility classes. A plain native bundler build must still tolerate the
// CSS import even though it does not run the NativeWind/Tailwind pipeline.
import "./global.css";

export function setup() {
  verifyInstallation();
  return { cssInterop, styled };
}

console.log("VIFX_LIB_CONSUMER_NATIVEWIND", setup);
