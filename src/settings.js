// Catalog of the controller's settings, mapped from the page layouts (*.XSL) of
// its web UI. Each entry says which page holds the value and how to change it:
//   up/down: names of the arrow buttons. The controller changes the value by its
//            own step when an arrow is set to 1, then clears the arrow again.
//   toggle:  the value itself is a switch and is written as 1/0.
// Entries without up/down/toggle are read-only.

export const PAGES = {
  main: 'UVOD.XML',
  hotWater: 'PAGE187.XML',
  heating: 'TOPENI.XML',
  curve: 'EKVITERM.XML',
  general: 'TZB_NAST.XML',
  saving: 'PAGE186.XML',
  usage: 'PAGE188.XML',
};

const B = (reg) => `__R${reg}_BOOL_i`;
const REAL1 = (reg) => `__R${reg}_REAL_.1f`;
const REAL0 = (reg) => `__R${reg}_REAL_.0f`;
const TIME = (reg) => `__R${reg}_TIME_Thh:mm`;

export const ITEMS = {};

function add(id, page, name, extra = {}) {
  ITEMS[id] = { page, name, ...extra };
}

// Three switch times per day group. At each time the controller switches to
// Comfort (switch on) or Eco (switch off).
function schedule(prefix, page, { times, up, down, on }) {
  for (const [g, group] of [[0, 'wd'], [1, 'we']]) {
    for (let n = 0; n < 3; n++) {
      add(`${prefix}.${group}${n}.time`, page, TIME(times[g][n]), { up: B(`${up[g]}.${n}`), down: B(`${down[g]}.${n}`) });
      add(`${prefix}.${group}${n}.comfort`, page, B(`${on[g]}.${n}`), { toggle: true });
    }
  }
}

// ---- Main page (UVOD.XML) and its popups ----
add('main.heatingMode', PAGES.main, B('2435.0'), { toggle: true, confirm: true }); // 1 = heating, 0 = cooling
add('main.backupStage1', PAGES.main, B('85225.3'));                                // electric backup heater stage 1 running
add('main.serviceDue', PAGES.main, B('100450.3'));
add('main.curveCorrection', PAGES.main, REAL1(2717), { up: B('45998.1'), down: B('45998.2') });
add('main.night.active', PAGES.main, B('91670.0'));
add('main.night.enabled', PAGES.main, B('23909.0'), { toggle: true });
add('main.night.start', PAGES.main, TIME(23910), { up: B('91670.1'), down: B('91670.2') });
add('main.night.end', PAGES.main, TIME(23914), { up: B('91670.3'), down: B('91670.4') });

// ---- Hot water (PAGE187.XML) ----
add('tuv.comfortMode', PAGES.hotWater, B('2001.0'));   // 1 = Comfort now, 0 = Eco
add('tuv.heating', PAGES.hotWater, B('57383.1'));      // tank is being heated
add('tuv.comfort', PAGES.hotWater, REAL1(2872), { up: B('100107.3'), down: B('100107.2') });
add('tuv.eco', PAGES.hotWater, REAL1(2876), { up: B('100107.5'), down: B('100107.4') });
schedule('tuv', PAGES.hotWater, {
  times: [[2002, 2014, 2026], [2006, 2018, 2030]],
  up: [45735, 45737], down: [45736, 45738], on: [2170, 2171],
});

// ---- Heating, zone 1 (TOPENI.XML). Zones 2 and 3 are not installed. ----
add('heat.comfortMode', PAGES.heating, B('1830.0'));
add('heat.roomTemp', PAGES.heating, REAL1(2904));
add('heat.heating', PAGES.heating, B('47867.0'));
add('heat.zoneOn', PAGES.heating, B('2933.0'), { toggle: true, confirm: true });
add('heat.comfort', PAGES.heating, REAL1(1815), { up: B('91462.0'), down: B('91463.0') });
add('heat.eco', PAGES.heating, REAL1(1803), { up: B('37140.0'), down: B('37141.0') });
schedule('heat', PAGES.heating, {
  times: [[1831, 1843, 1855], [1835, 1847, 1859]],
  up: [45731, 45733], down: [45732, 45734], on: [1999, 2000],
});

// ---- Heating curve (EKVITERM.XML) ----
add('curve.waterAtCold', PAGES.curve, REAL0(2580), { up: B('45952.2'), down: B('45952.3') });
add('curve.waterAtWarm', PAGES.curve, REAL0(2584), { up: B('45952.4'), down: B('45952.5') });
add('curve.outdoorCold', PAGES.curve, REAL0(2588), { up: B('45952.6'), down: B('45952.7') });
add('curve.outdoorWarm', PAGES.curve, REAL0(2592), { up: B('45953.0'), down: B('45953.1') });
add('curve.target', PAGES.curve, REAL0(47772));
add('curve.coolingTarget', PAGES.curve, REAL0(2576), { up: B('45952.0'), down: B('45952.1') });

// ---- General settings (TZB_NAST.XML) ----
add('gen.date', PAGES.general, '__R96878_DT_TYYYY-MM-DD');
add('gen.summerThreshold', PAGES.general, REAL0(2342), { up: B('47674.0'), down: B('47674.1') });
add('gen.outdoorAvg48h', PAGES.general, REAL1(95889));
add('circ.wd.from', PAGES.general, TIME(3864), { up: B('37142.0'), down: B('37143.0') });
add('circ.wd.to', PAGES.general, TIME(3868), { up: B('37142.1'), down: B('37143.1') });
add('circ.we.from', PAGES.general, TIME(3872), { up: B('37142.2'), down: B('37143.2') });
add('circ.we.to', PAGES.general, TIME(3876), { up: B('37142.3'), down: B('37143.3') });
add('circ.wd.on', PAGES.general, B('32731.0'), { toggle: true });
add('circ.we.on', PAGES.general, B('32731.1'), { toggle: true });

// ---- Weather-based saving (PAGE186.XML) ----
add('save.sunriseOffset', PAGES.saving, TIME(29885), { up: B('100107.0'), down: B('100107.1') });
add('save.maxRoomDrop', PAGES.saving, REAL1(26782), { up: B('95346.4'), down: B('95346.5') });
add('save.minOutdoorDiff', PAGES.saving, REAL0(29889), { up: B('100128.1'), down: B('100128.2') });

// ---- Heat pump usage today (PAGE188.XML) ----
// 48 half-hour bars. Each value is the height in px of a dark mask drawn over a
// 331px gradient, so the bar itself is (330 - value) px of a `scale` kW axis
// (an empty bar reads 330, which still leaves a 1px border line).
export const USAGE = {
  page: PAGES.usage,
  bars: Array.from({ length: 48 }, (_, i) => REAL0(98442 + i * 4)),
  barPx: 331,
  scale: '__R98662_REAL_.2f',
  totalKwh: '__R98695_REAL_.1f',
  nowKw: '__R98691_REAL_.1f',
};

export function parseValue(name, raw) {
  if (raw === undefined) return null;
  if (name.includes('_BOOL_')) return raw === '1';
  if (name.includes('_REAL_') || name.includes('_INT_')) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

export function parseUsage(raw) {
  const scale = Number(raw?.[USAGE.scale]);
  if (!Number.isFinite(scale)) return null;
  const bars = USAGE.bars.map((name) => {
    const mask = Number(raw[name]);
    if (!Number.isFinite(mask)) return null;
    const kw = (Math.max(0, USAGE.barPx - 1 - mask) / USAGE.barPx) * scale;
    return Math.round(kw * 100) / 100;
  });
  return { bars, scale, totalKwh: parseValue(USAGE.totalKwh, raw[USAGE.totalKwh]), nowKw: parseValue(USAGE.nowKw, raw[USAGE.nowKw]) };
}
