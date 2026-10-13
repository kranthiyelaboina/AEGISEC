declare global {
  const AEGISEC_VERSION: string
  const AEGISEC_CHANNEL: string
}

export const InstallationVersion = typeof AEGISEC_VERSION === "string" ? AEGISEC_VERSION : "local"
export const InstallationChannel = typeof AEGISEC_CHANNEL === "string" ? AEGISEC_CHANNEL : "local"
export const InstallationLocal = InstallationVersion === "local"
