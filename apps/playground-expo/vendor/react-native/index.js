export const AppRegistry = {
  registerComponent(name, loader) {
    return { loader, name };
  },
};

export const Platform = {
  OS: "web",
  select(value) {
    return value?.web ?? value?.default ?? null;
  },
};

export default { AppRegistry, Platform };
