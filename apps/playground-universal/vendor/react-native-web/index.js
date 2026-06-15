const registeredApps = new Map();

export const AppRegistry = {
  getAppKeys() {
    return [...registeredApps.keys()];
  },
  getApplication(appKey) {
    return registeredApps.get(appKey) ?? null;
  },
  registerComponent(appKey, componentProvider) {
    registeredApps.set(appKey, { componentProvider });
    return appKey;
  },
  registerConfig(config) {
    for (const entry of config ?? []) {
      if (entry?.appKey) {
        registeredApps.set(entry.appKey, entry);
      }
    }

    return config;
  },
  registerRunnable(appKey, run) {
    registeredApps.set(appKey, { run });
    return appKey;
  },
  runApplication(appKey, appParameters) {
    return { appKey, appParameters };
  },
  setComponentProviderInstrumentationHook() {},
  setWrapperComponentProvider() {},
  unmountApplicationComponentAtRootTag() {},
};

export class NativeEventEmitter {}

export const NativeModules = {};
export const Platform = {
  OS: "web",
  select(value) {
    return value?.web ?? value?.default ?? null;
  },
};

export default {
  AppRegistry,
  NativeEventEmitter,
  NativeModules,
  Platform,
};
