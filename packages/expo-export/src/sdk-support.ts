import type { VifxExpoSdkSupportEntry, VifxExpoSdkSupportStatus } from "@vifx/types";

/**
 * Expo SDK support table.
 *
 * Tier semantics are deliberately honest:
 * - "validated": fixture-backed AND device-validated against Expo Go.
 * - "experimental": static-analysis tier only (fixtures, audits, doctor
 *   detection). Dev-server protocols and runtime behavior are NOT
 *   device-validated.
 */
export const EXPO_SDK_SUPPORT: Record<string, VifxExpoSdkSupportEntry> = {
  "54": {
    notes: [
      "React Native 0.81.",
      "Validated tier: fixture-backed and device-validated against Expo Go. This is the current gate.",
    ],
    tier: "validated",
  },
  "55": {
    notes: [
      "React Native 0.83. New Architecture only.",
      "Experimental tier: static analysis and fixtures only; dev-server protocols are not device-validated.",
    ],
    tier: "experimental",
  },
  "56": {
    notes: [
      "React Native 0.85. Hermes V1 is the default engine.",
      "Experimental tier: static analysis and fixtures only; not device-validated.",
    ],
    tier: "experimental",
  },
  "57": {
    notes: [
      "React Native 0.86.",
      "Experimental tier: static analysis and fixtures only; not device-validated.",
    ],
    tier: "experimental",
  },
  "58": {
    notes: [
      "React Native 0.88, React 19.3. Current Expo SDK.",
      "Experimental tier: static analysis and fixtures only; not device-validated.",
    ],
    tier: "experimental",
  },
};

export const SUPPORTED_EXPO_SDK_VERSIONS = Object.keys(EXPO_SDK_SUPPORT);

export const VALIDATED_EXPO_SDK_VERSIONS = SUPPORTED_EXPO_SDK_VERSIONS.filter(
  (sdk) => EXPO_SDK_SUPPORT[sdk]?.tier === "validated",
);

export function formatSupportedExpoSdkList() {
  return SUPPORTED_EXPO_SDK_VERSIONS.join(", ");
}

export function formatValidatedExpoSdkList() {
  return VALIDATED_EXPO_SDK_VERSIONS.join(", ");
}

export function parseExpoSdkMajor(expoVersion: string | null | undefined): string | null {
  if (!expoVersion) {
    return null;
  }

  const match = expoVersion.match(/\d+/u);
  return match ? match[0] : null;
}

export function getSdkSupportTier(
  expoVersion: string | null | undefined,
): VifxExpoSdkSupportStatus {
  const sdk = parseExpoSdkMajor(expoVersion);

  if (sdk === null) {
    return {
      notes: ["No Expo SDK version was detected, so a support tier cannot be determined."],
      sdk: null,
      tier: "unknown",
    };
  }

  const entry = EXPO_SDK_SUPPORT[sdk];
  if (!entry) {
    return {
      notes: [
        `Expo SDK ${sdk} is outside the Vifx support table (${formatSupportedExpoSdkList()}).`,
      ],
      sdk,
      tier: "unsupported",
    };
  }

  return {
    notes: [...entry.notes],
    sdk,
    tier: entry.tier,
  };
}
