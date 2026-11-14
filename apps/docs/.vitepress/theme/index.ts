import { inBrowser, onContentUpdated, type Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { applyStoredPackageManager, syncPackageManagerTabs } from "./package-manager";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp() {
    if (inBrowser) {
      syncPackageManagerTabs();
    }
  },
  setup() {
    onContentUpdated(applyStoredPackageManager);
  },
} satisfies Theme;
