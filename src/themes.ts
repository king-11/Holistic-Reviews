// Each theme lists surface, sidebar, text, muted, border and accent; the rest of the UI palette is derived from those.
const definitions = [
  ['paper', 'Paper', '#fdfcf9 #f7f5f0 #2f2e2b #7a776f #e8e5dc #5668c9', 'pierre-light'],
  ['pierre-light', 'Pierre Light', '#ffffff #f5f5f5 #0a0a0a #737373 #e5e5e5 #009fff'],
  ['pierre-light-soft', 'Pierre Light Soft', '#ffffff #f7f7f7 #525252 #8a8a8a #ededed #009fff'],
  ['pierre-light-vibrant', 'Pierre Light Vibrant', '#ffffff #f5f5f5 #0a0a0a #737373 #e5e5e5 #4fa5ff'],
  ['pierre-light-protanopia-deuteranopia', 'Pierre Light Protanopia/Deuteranopia', '#ffffff #f5f5f5 #0a0a0a #737373 #e5e5e5 #009fff'],
  ['pierre-light-tritanopia', 'Pierre Light Tritanopia', '#ffffff #f5f5f5 #0a0a0a #737373 #e5e5e5 #009fff'],
  ['ayu-light', 'Ayu Light', '#fcfcfc #f8f9fa #5c6166 #828e9f #e8ebee #f29718'],
  ['catppuccin-latte', 'Catppuccin Latte', '#eff1f5 #e6e9ef #4c4f69 #8c8fa1 #ccd0da #8839ef'],
  ['everforest-light', 'Everforest Light', '#fdf6e3 #f4f0d9 #5c6a72 #939f91 #e6e2cc #8da101'],
  ['github-light', 'GitHub Light', '#ffffff #f6f8fa #24292e #6a737d #e1e4e8 #0366d6'],
  ['github-light-default', 'GitHub Light Default', '#ffffff #f6f8fa #1f2328 #656d76 #d0d7de #0969da'],
  ['github-light-high-contrast', 'GitHub Light High Contrast', '#ffffff #f6f8fa #0e1116 #3d444d #88929d #0349b4'],
  ['gruvbox-light-hard', 'Gruvbox Light Hard', '#f9f5d7 #f3eac7 #3c3836 #7c6f64 #ebdbb2 #076678'],
  ['gruvbox-light-medium', 'Gruvbox Light Medium', '#fbf1c7 #f2e5bc #3c3836 #7c6f64 #ebdbb2 #076678'],
  ['gruvbox-light-soft', 'Gruvbox Light Soft', '#f2e5bc #ebdbb2 #3c3836 #7c6f64 #d5c4a1 #076678'],
  ['horizon-bright', 'Horizon Bright', '#fdf0ed #fadad1 #1c1e26 #8b8a8f #f9cbbe #e84a72'],
  ['kanagawa-lotus', 'Kanagawa Lotus', '#f2ecbc #e7dba0 #545464 #8a8980 #d5cea3 #4d699b'],
  ['light-plus', 'Light Plus', '#ffffff #f3f3f3 #000000 #717171 #e5e5e5 #007acc'],
  ['material-theme-lighter', 'Material Theme Lighter', '#fafafa #f2f2f2 #546e7a #90a4ae #e7e7e8 #39adb5'],
  ['min-light', 'Min Light', '#ffffff #f6f6f6 #212121 #757575 #e5e5e5 #6f42c1'],
  ['night-owl-light', 'Night Owl Light', '#fbfbfb #f0f0f0 #403f53 #7a8181 #d9d9d9 #2aa298'],
  ['one-light', 'One Light', '#fafafa #eaeaeb #383a42 #a0a1a7 #dbdbdc #526fff'],
  ['rose-pine-dawn', 'Rosé Pine Dawn', '#faf4ed #f2e9e1 #575279 #797593 #dfdad9 #907aa9'],
  ['slack-ochin', 'Slack Ochin', '#ffffff #f7f7f8 #1d1c1d #616061 #dddddd #1264a3'],
  ['snazzy-light', 'Snazzy Light', '#fafbfc #f3f4f5 #565869 #9ea0ab #dedfe0 #09a1ed'],
  ['solarized-light', 'Solarized Light', '#fdf6e3 #eee8d5 #657b83 #93a1a1 #ddd6c1 #268bd2'],
  ['vitesse-light', 'Vitesse Light', '#ffffff #f7f7f7 #393a34 #8a8b86 #f0f0f0 #1c6b48'],
] as const;

export type ThemeId = (typeof definitions)[number][0];

export const themes = definitions.map(([id, label, palette, code]) => {
  const [surface, sidebar, text, muted, border, accent] = palette.split(' ');
  return { id: id as ThemeId, label, code: (code ?? id) as string, palette: { surface, sidebar, text, muted, border, accent } };
});

export const isTheme = (value: unknown): value is ThemeId => themes.some(theme => theme.id === value);

export const themeById = (id: ThemeId) => themes.find(theme => theme.id === id)!;

const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));

export const mix = (from: string, to: string, amount: number) => {
  const target = channels(to);
  return `#${channels(from)
    .map((value, index) =>
      Math.round(value + (target[index] - value) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

// Theme colors are tuned for code, not UI chrome, so darken any that would miss WCAG AA against their backgrounds.
const readable = (color: string, minimum: number, ...backgrounds: string[]) => {
  let result = color;
  for (let amount = 0.05; amount <= 1 && backgrounds.some(bg => contrast(result, bg) < minimum); amount += 0.05)
    result = mix(color, '#000000', amount);
  return result;
};

export function themeTokens(id: ThemeId): Record<string, string> {
  const { surface, sidebar, text, muted, border, accent } = themeById(id).palette;
  const body = readable(text, 7, surface, mix(sidebar, text, 0.06));
  const strong = readable(mix(body, '#000000', 0.3), 7, surface);
  const primary = readable(accent, 4.5, '#ffffff');
  const green = readable('#28865a', 3, surface, sidebar);
  const red = readable('#c85860', 3, surface, sidebar);
  return {
    surface,
    sidebar,
    subtle: mix(sidebar, text, 0.03),
    hover: mix(sidebar, text, 0.06),
    text: body,
    strong,
    brand: strong,
    secondary: readable(mix(body, surface, 0.25), 4.5, surface, sidebar),
    muted: readable(muted, 3, surface, sidebar),
    border,
    'border-strong': mix(border, text, 0.08),
    accent: readable(accent, 4.5, surface),
    'accent-soft': mix(surface, accent, 0.1),
    primary,
    'primary-hover': mix(primary, '#000000', 0.1),
    green,
    'green-soft': mix(surface, green, 0.08),
    red,
    'red-soft': mix(surface, red, 0.08),
    approve: readable('#25784f', 4.5, '#ffffff'),
    danger: readable('#b13e48', 4.5, '#ffffff'),
    'file-modified': readable('#3666ad', 3, surface, sidebar),
    'file-renamed': readable('#936313', 3, surface, sidebar),
    'file-deleted': readable('#b7424e', 3, surface, sidebar),
    backdrop: `${mix(body, '#000000', 0.5)}5c`,
  };
}
