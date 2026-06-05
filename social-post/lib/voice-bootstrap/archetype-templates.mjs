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
  old_new_contrast: {
    'zh-tw': '以前 {舊做法，費時費力}。現在 {新做法，AI 槓桿}。{省下的時間或心力}。',
    en: 'Old way: {painful manual approach}. New way: {AI-leveraged approach}. {time or effort saved}.',
  },
  tool_discovery: {
    'zh-tw': '{驚嘆} {來源} 做了 {工具}，能 {反直覺能力}。{社會證明/影響}。{怎麼用}。',
    en: '{trigger} {source} built {tool} that {counter-intuitive capability}. {social proof / impact}. {how to use it}.',
  },
  pov_question: {
    'zh-tw': 'POV：{情境}。{真正的問題}？{邀請互動}。',
    en: 'POV: {situation}. {the real question}? {invite replies}.',
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
