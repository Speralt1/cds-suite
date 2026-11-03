"use strict";

/**
 * Reloj de «Ve por los tuyos» con anulación SOLO para el emulador local.
 * Si `FUNCTIONS_EMULATOR === "true"` y `OUTREACH_DEV_NOW` es un LocalDateTime
 * válido (`YYYY-MM-DDTHH:mm`, hora de Santiago), el reloj parte de ese instante
 * y avanza con el reloj real. En cualquier otro caso (producción incluida)
 * devuelve el reloj real: la variable se ignora.
 */

const { localNow, SANTIAGO_TIME_ZONE } = require("../shared/dates");

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** LocalDateTime de Santiago → instante (ms), o null si no es válido. */
function localToInstant(value) {
  const m = LOCAL_DATE_TIME.exec(typeof value === "string" ? value.trim() : "");
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(asUtc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return null;
  let guess = asUtc;
  for (let i = 0; i < 3; i++) {
    const s = LOCAL_DATE_TIME.exec(localNow(guess, SANTIAGO_TIME_ZONE));
    const shownUtc = Date.UTC(Number(s[1]), Number(s[2]) - 1, Number(s[3]), Number(s[4]), Number(s[5]));
    guess += asUtc - shownUtc;
  }
  return guess;
}

function createOutreachClock(realClock, env = process.env) {
  if (env.FUNCTIONS_EMULATOR !== "true") return realClock;
  const target = localToInstant(env.OUTREACH_DEV_NOW);
  if (target === null) return realClock;
  const offset = target - realClock.now();
  return { now: () => realClock.now() + offset };
}

module.exports = { createOutreachClock, localToInstant };
