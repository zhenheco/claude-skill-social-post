const TEMPLATES = {
  news_hottake: {
    'zh-tw': '{工具} 出了 {新功能}。{反直覺判斷}。{一句影響}。',
    en: '{tool} just shipped {feature}. {contrarian take}. {one-line why it matters}.',
  },
  vulnerability_reveal: {
    'zh-tw': '{表面成果}。但真相是：{幕後掙扎}。{學到的原理}。{留給讀者的東西}。',
    en: '{visible win}. But the truth is: {behind-the-scenes struggle}. {the principle I took away}.',
  },
  principle_contrast: {
    'zh-tw': '{領域} 的底層邏輯，其實不是 {表面動作}，是 {真正關鍵}。',
    en: "The real logic of {domain} isn't {surface action} — it's {what actually matters}.",
  },
  milestone_mission: {
    'zh-tw': '{數字里程碑}，對我不是虛榮。{重申在做什麼、為誰}。',
    en: "{number milestone} — not vanity to me. {restate what I'm building and for whom}.",
  },
  practical_list: {
    'zh-tw': '{常見誤解或痛點}。{我整理的清單/流程}：{幾個可立即套用的項目}。',
    en: '{common misconception or pain}. {curated list or workflow}: {specific items readers can apply now}.',
  },
  cautionary_take: {
    'zh-tw': '如果你正在 {做法}，但還不懂 {風險/名詞}，你其實是在 {代價}。',
    en: 'If you are {doing the popular thing} but cannot explain {risk or concept}, you are {paying the hidden cost}.',
  },
  founder_story: {
    'zh-tw': '我開始 {創業/專案}。{短時間後現實打臉}：{缺口}。{學到的下一步}。',
    en: 'I started {venture or project}. {early reality check}: {missing proof or constraint}. {lesson or next move}.',
  },
};

function deepFreeze(value) {
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === 'object') deepFreeze(entry);
  }
  return Object.freeze(value);
}

export const ARCHETYPE_TEMPLATES = deepFreeze(TEMPLATES);

export function templateFor(archetype, lang) {
  const templates = ARCHETYPE_TEMPLATES[archetype];
  if (!templates) throw new Error(`unknown archetype: ${archetype}`);
  const template = templates[lang];
  if (!template) throw new Error(`unknown language for ${archetype}: ${lang}`);
  return template;
}
