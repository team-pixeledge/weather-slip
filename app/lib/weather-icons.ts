// Small inline-SVG weather icons for printed slips. Chosen from the
// condition label rather than a provider code, so OpenWeather ("light
// rain", "few clouds") and Open-Meteo/WMO labels map the same way. Inline
// SVG (not <img>) so the print page's CSP needs no extra source and the
// icons print without a network fetch. Pure — also used by the preview.

export type WeatherKind = "clear" | "partly" | "cloudy" | "rain" | "storm" | "snow" | "fog";

export function weatherKind(label: string): WeatherKind {
  const l = label.toLowerCase();
  if (/thunder|storm/.test(l)) return "storm";
  if (/snow|sleet|ice|hail|flurr/.test(l)) return "snow";
  if (/rain|drizzle|shower/.test(l)) return "rain";
  if (/fog|mist|haze|smoke|dust|sand|ash/.test(l)) return "fog";
  if (/overcast|broken|cloudy|clouds?$/.test(l) && !/few|scattered|partly|mostly clear/.test(l)) {
    return "cloudy";
  }
  if (/few|scattered|partly|mostly clear|clouds/.test(l)) return "partly";
  return "clear";
}

const SUN = "#F5A623";
const CLOUD = "#9AA5B1";
const RAIN = "#2F80ED";
const BOLT = "#F2C94C";

const cloud = (fill: string, dx = 0, dy = 0) =>
  `<path transform="translate(${dx} ${dy})" d="M7 19h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 10.1 4.5 4.5 0 0 0 7 19z" fill="${fill}"/>`;

const sun = (cx: number, cy: number, r: number) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 1.6);
    const y1 = cy + Math.sin(a) * (r + 1.6);
    const x2 = cx + Math.cos(a) * (r + 3.4);
    const y2 = cy + Math.sin(a) * (r + 3.4);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }).join("");
  return `<g stroke="${SUN}" stroke-width="1.6" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>`;
};

const SHAPES: Record<WeatherKind, string> = {
  clear: sun(12, 12, 4.6),
  partly: `${sun(8.5, 8.5, 3.4)}${cloud("#B8C2CC", 2, 1)}`,
  cloudy: `${cloud("#C7D0D9", -2, -3)}${cloud(CLOUD, 1, 0)}`,
  rain: `${cloud(CLOUD, 0, -4)}<g stroke="${RAIN}" stroke-width="1.8" stroke-linecap="round"><line x1="8" y1="18" x2="7" y2="21"/><line x1="12" y1="18" x2="11" y2="21"/><line x1="16" y1="18" x2="15" y2="21"/></g>`,
  storm: `${cloud("#7B8794", 0, -4)}<path d="M12.5 15.5 9.5 20h2.6l-1.1 3.5 4-5.2h-2.7l1.2-2.8z" fill="${BOLT}"/>`,
  snow: `${cloud(CLOUD, 0, -4)}<g fill="#7FB3E8"><circle cx="8" cy="19.5" r="1.2"/><circle cx="12" cy="21" r="1.2"/><circle cx="16" cy="19.5" r="1.2"/></g>`,
  fog: `<g stroke="${CLOUD}" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="6" y1="13" x2="18" y2="13"/><line x1="4" y1="17" x2="20" y2="17"/></g>`,
};

/** Inline SVG for a condition label; decorative (the label text stays). */
export function weatherIcon(label: string, size = 28): string {
  const kind = weatherKind(label);
  return `<svg class="wx wx-${kind}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SHAPES[kind]}</svg>`;
}
