export const PLAYER_STRING_CATALOG_SCHEMA_VERSION = 1;

const CATALOGS = Object.freeze({
  en: Object.freeze({
    resetView: "Reset view", settings: "Settings", fullscreen: "Fullscreen", continue: "Continue",
    upgrade: "Upgrade", sell: "Sell", startWave: "Start wave", pause: "Pause", resume: "Resume",
    saveReady: "Game saved", saveFailed: "Could not save the session", noSave: "No compatible saved session",
    sessionRestored: "Session restored", confirmResetSession: "Delete the current saved session?"
  }),
  ru: Object.freeze({
    resetView: "Сбросить вид", settings: "Настройки", fullscreen: "Полный экран", continue: "Продолжить",
    upgrade: "Улучшить", sell: "Продать", startWave: "Начать волну", pause: "Пауза", resume: "Продолжить",
    saveReady: "Игра сохранена", saveFailed: "Не удалось сохранить сессию", noSave: "Совместимое сохранение не найдено",
    sessionRestored: "Сессия восстановлена", confirmResetSession: "Удалить текущее сохранение?"
  })
});

function normalizeLocale(value) {
  if (typeof value !== "string" || !value) return "en";
  return value.toLowerCase().replace("_", "-").split("-")[0];
}

export function createPlayerStrings(options = {}) {
  const requested = normalizeLocale(options.locale === "auto" ? options.navigatorLanguage : options.locale);
  const primary = CATALOGS[requested] ?? CATALOGS.en;
  return Object.freeze({
    schemaVersion: PLAYER_STRING_CATALOG_SCHEMA_VERSION,
    locale: CATALOGS[requested] ? requested : "en",
    text(id) {
      if (typeof id !== "string" || !id) return "";
      return primary[id] ?? CATALOGS.en[id] ?? id;
    }
  });
}
