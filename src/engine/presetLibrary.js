// Zertake preset library: ORIGINAL looks organised in the same kinds of categories a mobile photo
// editor offers (Portraits, Cinematic, Urban, Travel, Vintage, Film, Black & White, …). None of these
// values are copied from another product; they are our own recipes built from develop() settings.
// Adaptive presets add masks (classical Subject / Sky detection, see masks.js) with local sliders.
// applyPreset() deep-merges only the keys a preset sets, so presets combine with the user's edits;
// mask arrays are replaced.

const g = (hue, sat, lum = 0) => ({ hue, sat, lum });
const grading = (o = {}) => ({ ...(o.sh ? { shadows: g(...o.sh) } : {}), ...(o.mid ? { midtones: g(...o.mid) } : {}), ...(o.hi ? { highlights: g(...o.hi) } : {}), ...(o.global ? { global: g(...o.global) } : {}), ...(o.blending != null ? { blending: o.blending } : {}), ...(o.balance != null ? { balance: o.balance } : {}) });
const curve = rgb => ({ rgb });
const fade = (lift = 24, roll = 236) => curve([[0, lift], [64, 66 + lift / 4], [192, 190], [255, roll]]);
const sCurve = (k = 10) => curve([[0, 0], [64, 64 - k], [192, 192 + k], [255, 255]]);
const mix = (o = {}) => { const m = {}; for (const ch of ['hue', 'sat', 'lum']) if (o[ch]) m[ch] = o[ch]; return m; };

let n = 0;
const ADJ = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0, hue: 0, saturation: 0, texture: 0, clarity: 0, dehaze: 0, defringe: 0, sharpness: 0, noise: 0, color: { hue: 0, saturation: 0 } };
const mask = (type, adjust, opts = {}) => ({ id: 'pm' + (++n), name: opts.name || type[0].toUpperCase() + type.slice(1), enabled: true, invert: false, amount: 100,
  components: [{ id: 'pc' + n, type, op: 'add', invert: false, params: type === 'radial' ? { cx: 0.5, cy: 0.5, rx: 0.42, ry: 0.42, angle: 0, feather: 75, inside: opts.inside ?? true } : { sensitivity: 50 } }],
  adjust: { ...ADJ, ...adjust, color: { ...ADJ.color, ...(adjust.color || {}) } } });

const P = (category, name, settings) => ({ id: 'z-' + category.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, category, builtin: true, settings });

export const PRESET_LIBRARY = [
  // ---- Adaptive: Subject ----
  P('Adaptive: Subject', 'Pop Subject', { masks: [mask('subject', { exposure: 0.25, clarity: 12, saturation: 10, texture: 8 }, { name: 'Subject' })] }),
  P('Adaptive: Subject', 'Glow Subject', { masks: [mask('subject', { exposure: 0.2, highlights: -10, shadows: 20, clarity: -12, temp: 6 }, { name: 'Subject' })] }),
  P('Adaptive: Subject', 'Darken Background', { masks: [mask('background', { exposure: -0.6, saturation: -15, clarity: -8 }, { name: 'Background' })] }),
  P('Adaptive: Subject', 'Blur-Free Focus', { masks: [mask('background', { exposure: -0.25, texture: -40, clarity: -25, sharpness: -30 }, { name: 'Background' }), mask('subject', { texture: 15, sharpness: 20 }, { name: 'Subject' })] }),
  P('Adaptive: Subject', 'Mono Background', { masks: [mask('background', { saturation: -100 }, { name: 'Background' })] }),
  // ---- Adaptive: Sky ----
  P('Adaptive: Sky', 'Deep Blue Sky', { masks: [mask('sky', { exposure: -0.35, highlights: -30, saturation: 25, temp: -12, dehaze: 15 }, { name: 'Sky' })] }),
  P('Adaptive: Sky', 'Dramatic Sky', { masks: [mask('sky', { exposure: -0.5, contrast: 25, highlights: -45, clarity: 25, dehaze: 25 }, { name: 'Sky' })] }),
  P('Adaptive: Sky', 'Golden Sky', { masks: [mask('sky', { temp: 28, tint: 8, saturation: 15, highlights: -20 }, { name: 'Sky' })] }),
  P('Adaptive: Sky', 'Soft Pastel Sky', { masks: [mask('sky', { exposure: 0.15, contrast: -20, saturation: -20, color: { hue: 320, saturation: 18 } }, { name: 'Sky' })] }),
  P('Adaptive: Sky', 'Storm', { masks: [mask('sky', { exposure: -0.7, saturation: -40, clarity: 30, dehaze: 35 }, { name: 'Sky' })], contrast: 10 }),
  // ---- Portraits ----
  P('Portraits', 'Natural Skin', { contrast: -6, highlights: -14, shadows: 10, texture: -12, clarity: -6, vibrance: 8, mixer: mix({ sat: { orange: -8, red: -4 }, lum: { orange: 8 } }) }),
  P('Portraits', 'Warm Portrait', { wb: 'custom', temp: 10, tint: 3, highlights: -18, shadows: 14, texture: -10, vibrance: 10, grading: grading({ hi: [40, 10] }) }),
  P('Portraits', 'Cool Portrait', { wb: 'custom', temp: -8, contrast: 6, texture: -8, saturation: -6, grading: grading({ sh: [215, 12] }) }),
  P('Portraits', 'Soft Glow', { contrast: -14, highlights: -20, clarity: -18, texture: -14, curve: fade(16, 248), vibrance: 6 }),
  P('Portraits', 'Studio Clean', { contrast: 10, whites: 12, blacks: -6, texture: 6, sharpenAmount: 40, sharpenMasking: 40 }),
  P('Portraits', 'Matte Portrait', { contrast: -10, curve: fade(28, 240), saturation: -10, grading: grading({ sh: [30, 8], hi: [45, 6] }) }),
  P('Portraits', 'Mono Portrait', { profile: 'monochrome', contrast: 12, clarity: -6, texture: -10, mixer: { gray: { red: 20, orange: 28, yellow: 10, green: -10, aqua: -10, blue: -16, purple: 0, magenta: 6 } } }),
  // ---- Cinematic ----
  P('Cinematic', 'Teal & Orange', { contrast: 12, highlights: -20, shadows: 10, vibrance: 12, grading: grading({ sh: [195, 24], hi: [35, 20], balance: -10 }), mixer: mix({ hue: { orange: -6, aqua: 8, blue: -8 }, sat: { blue: -10 } }) }),
  P('Cinematic', 'Night Drive', { exposure: -0.2, contrast: 16, blacks: -12, grading: grading({ sh: [220, 30], mid: [200, 10], hi: [40, 12] }), saturation: -8, vignetteAmount: -20 }),
  P('Cinematic', 'Desert Epic', { wb: 'custom', temp: 16, contrast: 18, dehaze: 8, grading: grading({ sh: [25, 14], hi: [42, 22] }), saturation: -6, curve: sCurve(12) }),
  P('Cinematic', 'Faded Feature', { contrast: -8, curve: fade(30, 232), saturation: -14, grading: grading({ sh: [190, 16], hi: [38, 12] }), grainAmount: 14 }),
  P('Cinematic', 'Neo Noir', { profile: 'monochrome', contrast: 30, blacks: -18, clarity: 12, vignetteAmount: -28, grainAmount: 18, grainSize: 30 }),
  P('Cinematic', 'Green Matrix', { contrast: 14, grading: grading({ sh: [140, 22], mid: [110, 10], hi: [70, 10] }), saturation: -12, mixer: mix({ hue: { yellow: 15, blue: -10 } }) }),
  P('Cinematic', 'Blockbuster', { contrast: 22, highlights: -30, shadows: 18, clarity: 14, dehaze: 10, vibrance: 14, grading: grading({ sh: [200, 20], hi: [38, 16] }) }),
  P('Cinematic', 'Moonlight', { wb: 'custom', temp: -24, tint: 6, exposure: -0.25, contrast: 10, saturation: -20, grading: grading({ global: [225, 10] }) }),
  // ---- Futuristic ----
  P('Futuristic', 'Neon Pulse', { contrast: 20, vibrance: 30, saturation: 10, grading: grading({ sh: [270, 26], hi: [190, 18] }), mixer: mix({ hue: { blue: 12, purple: -10 }, sat: { magenta: 20, purple: 20 } }), clarity: 10 }),
  P('Futuristic', 'Cyber Cyan', { wb: 'custom', temp: -18, tint: -6, contrast: 16, grading: grading({ sh: [185, 30], hi: [175, 10] }), saturation: 6 }),
  P('Futuristic', 'Chrome', { saturation: -45, contrast: 24, clarity: 18, texture: 12, whites: 14, grading: grading({ global: [210, 6] }) }),
  P('Futuristic', 'Vapor', { contrast: -10, curve: fade(20, 245), grading: grading({ sh: [255, 26], hi: [320, 18] }), vibrance: 18 }),
  // ---- Vintage ----
  P('Vintage', 'Sepia Memory', { profile: 'monochrome', grading: grading({ global: [35, 26] }), curve: fade(26, 236), grainAmount: 20, vignetteAmount: -18 }),
  P('Vintage', 'Seventies', { wb: 'custom', temp: 14, contrast: -6, saturation: -10, grading: grading({ sh: [30, 18], hi: [50, 16] }), curve: fade(22, 240), grainAmount: 16 }),
  P('Vintage', 'Polaroid', { contrast: -8, highlights: -16, curve: curve([[0, 28], [128, 134], [255, 238]]), grading: grading({ sh: [190, 10], hi: [55, 14] }), vibrance: -6, vignetteAmount: -10 }),
  P('Vintage', 'Old Postcard', { saturation: -30, curve: fade(34, 228), grading: grading({ mid: [40, 14] }), texture: -8, grainAmount: 24, grainSize: 35 }),
  P('Vintage', 'Faded Summer', { exposure: 0.15, contrast: -14, saturation: -8, curve: fade(26, 244), grading: grading({ hi: [48, 18] }) }),
  // ---- Film ----
  P('Film', 'Portra-like Warmth', { contrast: -4, highlights: -18, shadows: 10, saturation: -6, grading: grading({ sh: [30, 8], hi: [40, 10] }), mixer: mix({ hue: { green: 10 }, sat: { green: -16 } }), grainAmount: 12 }),
  P('Film', 'Cool Slide', { contrast: 16, saturation: 10, grading: grading({ sh: [210, 14] }), blacks: -10, grainAmount: 10 }),
  P('Film', 'Expired Stock', { wb: 'custom', tint: 10, contrast: -10, curve: fade(30, 232), grading: grading({ sh: [160, 18], hi: [330, 10] }), grainAmount: 26, grainRoughness: 70 }),
  P('Film', 'Tri-X Style', { profile: 'monochrome', contrast: 24, blacks: -10, clarity: 8, grainAmount: 30, grainSize: 28, grainRoughness: 60 }),
  P('Film', 'Cine Negative', { contrast: -6, highlights: -24, shadows: 16, saturation: -12, grading: grading({ sh: [180, 14], hi: [30, 12] }), curve: fade(18, 246), grainAmount: 14 }),
  // ---- Travel ----
  P('Travel', 'Tropical', { vibrance: 28, saturation: 6, contrast: 10, dehaze: 8, mixer: mix({ hue: { aqua: -6, blue: -4 }, sat: { aqua: 20, blue: 14, green: 10 } }) }),
  P('Travel', 'Mediterranean', { wb: 'custom', temp: 8, contrast: 12, vibrance: 18, mixer: mix({ sat: { blue: 18, aqua: 14 }, lum: { blue: -8 } }), highlights: -12 }),
  P('Travel', 'Nordic', { wb: 'custom', temp: -10, contrast: 8, saturation: -18, clarity: 10, grading: grading({ sh: [210, 10] }) }),
  P('Travel', 'Golden Hour', { wb: 'custom', temp: 22, tint: 6, highlights: -20, shadows: 12, vibrance: 14, grading: grading({ hi: [38, 20], mid: [30, 8] }) }),
  P('Travel', 'Market Colors', { vibrance: 24, saturation: 10, clarity: 14, texture: 10, contrast: 12 }),
  // ---- Urban ----
  P('Urban', 'Concrete', { saturation: -35, contrast: 18, clarity: 22, texture: 16, grading: grading({ global: [210, 8] }) }),
  P('Urban', 'Street Grit', { contrast: 24, clarity: 30, texture: 20, saturation: -20, blacks: -10, vignetteAmount: -16, grainAmount: 12 }),
  P('Urban', 'City Lights', { exposure: -0.15, contrast: 16, highlights: -25, vibrance: 20, grading: grading({ sh: [230, 22], hi: [40, 18] }) }),
  P('Urban', 'Architecture Crisp', { contrast: 14, whites: 10, blacks: -8, clarity: 16, texture: 14, dehaze: 6, sharpenAmount: 50, sharpenMasking: 30 }),
  P('Urban', 'Rooftop Dusk', { wb: 'custom', temp: -6, tint: 8, contrast: 10, grading: grading({ sh: [240, 18], hi: [20, 16] }), vibrance: 12 }),
  // ---- Landscape ----
  P('Landscape', 'Vivid Nature', { vibrance: 26, contrast: 12, dehaze: 10, clarity: 10, mixer: mix({ hue: { green: -8, yellow: -10 }, sat: { green: 12, blue: 14 } }) }),
  P('Landscape', 'Misty Morning', { contrast: -18, dehaze: -18, highlights: 10, saturation: -16, grading: grading({ global: [205, 8] }) }),
  P('Landscape', 'Autumn', { wb: 'custom', temp: 12, mixer: mix({ hue: { green: -30, yellow: -14 }, sat: { orange: 18, yellow: 12, green: -10 } }), vibrance: 12, contrast: 8 }),
  P('Landscape', 'Mountain Air', { wb: 'custom', temp: -8, dehaze: 18, clarity: 14, contrast: 10, highlights: -20, mixer: mix({ sat: { blue: 12 }, lum: { blue: -10 } }) }),
  P('Landscape', 'Seascape', { wb: 'custom', temp: -6, mixer: mix({ hue: { aqua: 6 }, sat: { aqua: 20, blue: 16 }, lum: { aqua: 6 } }), contrast: 10, highlights: -15 }),
  // ---- Food ----
  P('Food', 'Fresh & Bright', { exposure: 0.2, contrast: 8, vibrance: 20, clarity: 6, mixer: mix({ sat: { red: 8, orange: 6, green: 10 } }) }),
  P('Food', 'Rustic Table', { wb: 'custom', temp: 10, contrast: 14, texture: 14, highlights: -12, saturation: -6, vignetteAmount: -14 }),
  P('Food', 'Dark Mood', { exposure: -0.3, contrast: 18, blacks: -14, highlights: -20, vibrance: 8, vignetteAmount: -24 }),
  // ---- Lifestyle ----
  P('Lifestyle', 'Airy', { exposure: 0.35, contrast: -12, highlights: -18, shadows: 22, saturation: -10, curve: fade(14, 250) }),
  P('Lifestyle', 'Cozy', { wb: 'custom', temp: 14, contrast: -6, curve: fade(20, 244), grading: grading({ hi: [42, 12] }), vibrance: 6 }),
  P('Lifestyle', 'Clean Minimal', { exposure: 0.15, saturation: -18, contrast: 6, whites: 10, grading: grading({ global: [200, 4] }) }),
  P('Lifestyle', 'Pastel', { exposure: 0.2, contrast: -16, saturation: -20, vibrance: 10, curve: fade(22, 248), grading: grading({ sh: [330, 10], hi: [190, 8] }) }),
  // ---- Moody ----
  P('Moody', 'Moody Greens', { exposure: -0.2, contrast: 14, mixer: mix({ hue: { green: 25, yellow: 10 }, sat: { green: -30, yellow: -20 }, lum: { green: -20 } }), grading: grading({ sh: [190, 14] }) }),
  P('Moody', 'Dark Blues', { exposure: -0.25, contrast: 12, mixer: mix({ sat: { blue: -20 }, lum: { blue: -18 } }), grading: grading({ sh: [220, 20] }), blacks: -10 }),
  P('Moody', 'Shadow Play', { contrast: 26, blacks: -20, shadows: -10, clarity: 18, saturation: -16, vignetteAmount: -30 }),
  P('Moody', 'Rainy Day', { wb: 'custom', temp: -12, contrast: -6, saturation: -28, dehaze: -8, grading: grading({ global: [205, 10] }) }),
  // ---- Black & White ----
  P('Black & White', 'High Contrast', { profile: 'monochrome', contrast: 40, whites: 14, blacks: -18, clarity: 16 }),
  P('Black & White', 'Soft Gray', { profile: 'monochrome', contrast: -14, curve: fade(20, 240), clarity: -6 }),
  P('Black & White', 'Infrared Look', { profile: 'monochrome', mixer: { gray: { red: 20, orange: 30, yellow: 60, green: 80, aqua: -20, blue: -60, purple: -10, magenta: 10 } }, contrast: 20 }),
  P('Black & White', 'Selenium Tone', { profile: 'monochrome', contrast: 16, grading: grading({ sh: [270, 12], hi: [40, 6] }) }),
  P('Black & White', 'Gritty Mono', { profile: 'monochrome', contrast: 28, clarity: 30, texture: 24, grainAmount: 30, grainSize: 24 }),
  // ---- Creative ----
  P('Creative', 'Cross Process', { contrast: 18, curve: { rgb: [[0, 0], [255, 255]], r: [[0, 10], [128, 140], [255, 255]], g: [[0, 0], [128, 132], [255, 240]], b: [[0, 40], [255, 210]] }, vibrance: 14 }),
  P('Creative', 'Duotone Violet', { profile: 'monochrome', grading: grading({ sh: [265, 40], hi: [30, 30] }), contrast: 10 }),
  P('Creative', 'Bleach Bypass', { saturation: -40, contrast: 30, clarity: 14, whites: 10 }),
  P('Creative', 'Lomo', { contrast: 22, vibrance: 22, vignetteAmount: -45, vignetteMidpoint: 30, grading: grading({ sh: [210, 16], hi: [55, 14] }) }),
  // ---- Quick (single tools) ----
  P('Quick', 'Vignette Soft', { vignetteAmount: -22, vignetteFeather: 70 }),
  P('Quick', 'Vignette Heavy', { vignetteAmount: -50, vignetteMidpoint: 35 }),
  P('Quick', 'Grain Fine', { grainAmount: 18, grainSize: 18, grainRoughness: 40 }),
  P('Quick', 'Grain Heavy', { grainAmount: 45, grainSize: 45, grainRoughness: 70 }),
  P('Quick', 'Sharpen Detail', { sharpenAmount: 60, sharpenRadius: 1, sharpenDetail: 35, sharpenMasking: 25 }),
  P('Quick', 'Noise Clean', { nrLuminance: 30, nrColor: 30 }),
  P('Quick', 'Dehaze Lift', { dehaze: 20, contrast: 6 }),
  P('Quick', 'Auto-ish Brighten', { exposure: 0.4, highlights: -25, shadows: 25, whites: 6, blacks: -4 }),
];

export const PRESET_CATEGORIES = [...new Set(PRESET_LIBRARY.map(p => p.category))];
