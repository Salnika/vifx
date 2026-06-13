import { deleteDatabaseSync, openDatabaseAsync, openDatabaseSync } from "expo-sqlite";

export function setup() {
  return { openDatabaseSync, openDatabaseAsync, deleteDatabaseSync };
}

console.log("VIFX_LIB_CONSUMER_EXPO_SQLITE", setup);
