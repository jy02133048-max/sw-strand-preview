/* p2-organs.js — P2 preview 器官适配层(2026-08-21 cc)
 *
 * 铁律(sw-p2-production-contract-v1):
 *  - 结构展开/材质映射 = 生产 app.js 同源函数逐字拷贝(见各段落行号引注),库=structure-lib.js(SHA 83e5a315…)
 *  - 报价 = 状态机 approximate(quote_verified=false)→ /api/design-bom verified;
 *    preview 用 MOCK SERVER 段模拟服务端,合入生产时整段替换为真实 fetch('/api/design-bom')
 *  - 事件 = 只进本地日志,绝不发网络;闭集校验;ViewContent/TasteRevealed 去重按契约
 */
(function () {
  'use strict';
  var MATERIALS = window.SW_MATERIALS_PUBLIC || [];
  var LIB = window.SW_STRUCTURE_LIBRARY || [];
  var byKey = {};
  MATERIALS.forEach(function (m) { byKey[m.key] = m; });

  /* ── 生产同款颗数公式(前端 beadCount 同款,checklist §3 codex 已确认) ── */
  function beadCount(wristCm, mm) {
    return Math.max(4, Math.round((wristCm * 10 + 13.6 + Math.PI * mm) / mm));
  }

  /* ══ 结构展开:app.js L4258-4311 逐字拷贝 ══ */
  function expandStructureFrame(motif, count) {
    const fixed = motif.filter((segment) => segment[1] !== 'flex')
      .reduce((sum, segment) => sum + segment[1], 0);
    const flexCount = motif.filter((segment) => segment[1] === 'flex').length;
    if (!flexCount) {
      const unit = motif.flatMap((segment) => Array(segment[1]).fill(segment[0]));
      return Array.from({ length: count }, (_, index) => unit[index % unit.length]);
    }
    const available = Math.max(flexCount, count - fixed);
    const perFlex = Math.floor(available / flexCount);
    let remainder = available % flexCount;
    const output = [];
    motif.forEach(([token, length]) => {
      const segmentLength = length === 'flex' ? perFlex + (remainder-- > 0 ? 1 : 0) : length;
      for (let index = 0; index < segmentLength; index += 1) output.push(token);
    });
    return output.slice(0, count);
  }
  function expandStructureRepeat(motif, count) {
    const unit = motif.flatMap((segment) => Array(segment[1]).fill(segment[0]));
    return Array.from({ length: count }, (_, index) => unit[index % unit.length]);
  }
  function luckyStructureTokens(structure, count) {
    if (structure.build) return structure.build(count).slice(0, count);
    if (structure.kind === 'repeat') return expandStructureRepeat(structure.motif || [['N', 1]], count);
    return expandStructureFrame(structure.motif || [['N', 'flex']], count);
  }

  /* ══ 材质映射:app.js L4282-4366 拷贝;唯一适配=池子来自公开物料表 ══ */
  function visualLightness(material) {
    const hex = String(material?.visual_color || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return 0.5;
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  }
  function shuffled(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  function pool() { return MATERIALS; } /* 适配:preview 池=全公开物料(生产=luckyBudgetPool) */
  function luckyFamilyCandidates(family) {
    const aliases = {
      white_neutral: ['white_neutral', 'silver_gray'],
      silver_gray: ['silver_gray', 'white_neutral'],
      yellow_gold: ['yellow_gold', 'gold'],
      gold: ['gold', 'yellow_gold'],
      black: ['black'],
    };
    const accepted = aliases[family] || [family];
    return pool().filter((material) => accepted.includes(material.color_family));
  }
  function luckyFamilyMaterial(family, fallback, offset = 0) {
    const candidates = shuffled(luckyFamilyCandidates(family));
    return candidates[offset % Math.max(1, candidates.length)] || fallback;
  }
  function luckyMaterialSequence(palette, count, structure) {
    if (!palette.length || !count || !structure) return { materials: [], tokens: [] };
    const tokens = luckyStructureTokens(structure, count);
    while (tokens.length < count) tokens.push('N');
    const chromatic = palette.filter((material) => !['white_neutral', 'silver_gray', 'black'].includes(material.color_family));
    const rolePool = chromatic.length ? chromatic : palette;
    const dominant = rolePool[0] || palette[0];
    const neutral = palette.find((material) => ['white_neutral', 'silver_gray'].includes(material.color_family))
      || luckyFamilyMaterial('white_neutral', dominant);
    const anchor = luckyFamilyMaterial('black', palette.at(-1) || dominant);
    const fixed = (structure.fixed || []).map((family, index) => luckyFamilyMaterial(family, rolePool[index % rolePool.length] || dominant, index));
    const focal = fixed[0]
      || palette.find((material) => ['multicolor', 'gold'].includes(material.color_family))
      || [...palette].sort((a, b) => visualLightness(b) - visualLightness(a))[0]
      || dominant;
    const rotations = { A: 0, B: 0, C: 0, N: 0 };
    const pools = {
      A: rolePool.length ? rolePool : [dominant],
      B: rolePool.length > 1 ? rolePool.slice(1) : rolePool,
      C: rolePool.length > 2 ? rolePool.slice(2) : rolePool,
      N: structure.fixed ? [neutral] : [dominant, neutral].filter(Boolean),
    };
    const pickRole = (token) => {
      const p = pools[token] || pools.A;
      const index = rotations[token] || 0;
      rotations[token] = index + 1;
      return p[index % p.length] || dominant;
    };
    const materials = tokens.map((token) => {
      if (typeof token === 'number') return fixed[token % fixed.length] || dominant;
      if (token === 'F') return focal;
      if (token === 'K') return anchor;
      return pickRole(token);
    });
    return { materials, tokens };
  }

  /* ── 七选一注册表(contract builder_generators;beidou archive 禁选) ── */
  var CONTRAST = [
    [['white_neutral'], ['black', 'blue']], [['blue'], ['yellow_gold', 'gold']],
    [['green'], ['purple']], [['pink'], ['green']],
    [['yellow_gold'], ['purple', 'blue']], [['red'], ['white_neutral']]];
  function famPick(fams) {
    var out = [];
    fams.forEach(function (f) { out = out.concat(pool().filter(function (m) { return m.color_family === f; })); });
    return out.length ? out[Math.floor(Math.random() * out.length)] : MATERIALS[0];
  }
  function libEntry(id) { return LIB.find(function (s) { return s.id === id; }); }
  var GENERATORS = {
    golden_cut:  { structure_id: 'goldensection', ui: 'GOLDEN CUT' },
    octave:      { structure_id: 'octave',        ui: 'OCTAVE' },
    major_triad: { structure_id: 'majortriad',    ui: 'MAJOR TRIAD' },
    five_phases: { structure_id: 'wuxing',        ui: 'FIVE PHASES' },
    sun_moon:    { structure_id: 'sunmoon',       ui: 'SUN & MOON' },
    pole_star:   { structure_id: 'focal',         ui: 'POLE STAR' },
    pure_chance: { structure_id: null,            ui: 'PURE CHANCE' },
  };
  function applyStructure(genKey, count) {
    var g = GENERATORS[genKey];
    if (!g) throw new Error('unknown generator: ' + genKey);
    if (g.structure_id === null) { /* pure chance:generator 源,不冒充结构 */
      var ks = [];
      for (var i = 0; i < count; i += 1) ks.push(MATERIALS[Math.floor(Math.random() * MATERIALS.length)].key);
      return { generator_id: 'pure_chance', structure_id: null, named_structure: false,
        ui_label: g.ui, hook: 'No pattern — the stones fell where they fell.', keys: ks };
    }
    var entry = libEntry(g.structure_id);
    if (!entry || entry.selectable === false) throw new Error('structure not selectable: ' + g.structure_id);
    var c = CONTRAST[Math.floor(Math.random() * CONTRAST.length)];
    var palette = [famPick(c[0]), famPick(c[1])];
    if (entry.colors === 3) palette.push(famPick(CONTRAST[Math.floor(Math.random() * CONTRAST.length)][0]));
    if (g.structure_id === 'focal') palette = [famPick(c[0]), famPick([['gold', 'yellow_gold'][Math.floor(Math.random() * 2)]])];
    var seq = luckyMaterialSequence(palette, count, entry);
    return { generator_id: genKey, structure_id: g.structure_id, named_structure: true,
      ui_label: g.ui, hook: entry.hook_en || entry.meaning || '', keys: seq.materials.map(function (m) { return m.key; }),
      tokens: seq.tokens };
  }

  /* ══ 报价状态机 ══
   * ┌ PREVIEW MOCK SERVER — 合入生产时本段整体替换为 fetch('/api/design-bom') ┐
   * 模拟 retail-pricing-v1 信号公式;材料信号里的克价均值用【档位聚合中位数】,
   * 不携带任何单石成本数据。preview 报价≈线上,分毫差异以 /api/design-bom 为准。 */
  var TIER_RANGE = { budget: { min: 55, max: 98 }, mid: { min: 105, max: 178 },
    premium: { min: 185, max: 278 }, luxury: { min: 285, max: 520 } };
  var TIER_AVG_CNY = { budget: 2.05, mid: 3.5, premium: 8.0, luxury: 60.0 }; /* 档位聚合中位数(build 时算) */
  var TIER_ORDER = ['budget', 'mid', 'premium', 'luxury'];
  function mockEstimate(keys) {
    if (!keys.length) return 0;
    var entries = keys.map(function (k) { return byKey[k] || { price_tier: 'mid' }; });
    var actualTier = entries.map(function (e) { return e.price_tier; })
      .sort(function (a, b) { return TIER_ORDER.indexOf(b) - TIER_ORDER.indexOf(a); })[0] || 'mid';
    var range = TIER_RANGE[actualTier] || TIER_RANGE.mid;
    var n = entries.length;
    var avgCny = entries.reduce(function (s, e) { return s + (TIER_AVG_CNY[e.price_tier] || 3.5); }, 0) / n;
    var rare = entries.filter(function (e) { return e.price_tier === 'premium' || e.price_tier === 'luxury'; }).length;
    var uniq = new Set(keys).size;
    var span = range.max - range.min;
    var signal = avgCny * 1.9 + (rare / Math.max(1, n)) * span * 0.72 + Math.max(0, uniq - 1) * 5 + (n - 24) * 0.7;
    var quantum = actualTier === 'budget' ? 2 : actualTier === 'mid' ? 3 : 5;
    return Math.round(Math.min(range.max, Math.max(range.min, range.min + signal)) / quantum) * quantum;
  }
  function designBom(recipe) { /* PREVIEW MOCK:形状=生产 /api/design-bom */
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ totals: { estimated_retail_usd: mockEstimate(recipe.beads) },
          quote_verified: true, pricing_version: 'retail-pricing-v1 (preview mock)' });
      }, 320);
    });
  }
  /* └ PREVIEW MOCK SERVER 段结束 ┘ */

  /* ══ 事件层:本地日志,闭集校验,契约去重;绝不发网络 ══ */
  var ALLOWED = new Set(['StudioStart', 'FirstInteraction', 'ViewContent', 'ModeSelected', 'WorkspaceViewed',
    'WorkspaceCompleted', 'ValidationBlocked', 'MomentSelected', 'GenerationStarted', 'GenerationFailed',
    'DesignGenerated', 'DesignViewed', 'EditorOpened', 'BeadSwapped', 'LuckyMixed', 'StructureSelected',
    'BraceletCleared', 'RefinementApplied', 'DesignSaved', 'DesignPublished', 'InitiateCheckout',
    'PurchaseHandoffStarted', 'PurchaseReady', 'CheckoutLinkCreated', 'CheckoutOpened', 'CheckoutFailed',
    'SessionExit', 'TasteRevealed']);
  var LOG = window.__SW_EVENT_LOG = [];
  var seenOnce = {};   /* ViewContent: session+route 一次 */
  var tasteSeen = {};  /* TasteRevealed: session+wish+structure+index 一次 */
  function uuid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'ev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function track(event, fields) {
    if (!ALLOWED.has(event)) throw new Error('event not in closed set: ' + event);
    fields = fields || {};
    if (event === 'ViewContent') {
      var k1 = 'vc:' + (fields.design_mode || 'unknown');
      if (seenOnce[k1]) return null;
      seenOnce[k1] = true;
    }
    if (event === 'TasteRevealed') {
      if (!fields.wish_code || !fields.reveal_index) throw new Error('TasteRevealed missing closed fields');
      var k2 = ['tr', fields.wish_code, fields.structure_id || '', fields.reveal_index].join(':');
      if (tasteSeen[k2]) return null;
      tasteSeen[k2] = true;
    }
    var rec = { event_id: uuid(), event: event, fields: fields, at: Date.now(), transport: 'preview-local-only' };
    LOG.push(rec);
    if (window.__SW_DEBUG) console.debug('[p2-event]', event, fields);
    return rec;
  }
  /* Meta/Google 映射表只做注册,preview 永不发送(AddToCart 明确 null) */
  var PLATFORM_MAPPING = { meta: { ViewContent: 'ViewContent', DesignGenerated: 'CustomizeProduct',
    InitiateCheckout: 'InitiateCheckout', PaidOrder: 'Purchase', AddToCart: null } };

  window.SW_P2_ORGANS = {
    materials: MATERIALS, byKey: byKey,
    imgFor: function (key) { return '../beadwork/beads-day/' + key + '_v2.webp'; },
    tierBadge: function (tier) { return { budget: '$', mid: '$$', premium: '$$$', luxury: '$$$$' }[tier] || '$$'; },
    beadCount: beadCount,
    generators: GENERATORS,
    applyStructure: applyStructure,
    estimate: mockEstimate,
    approxLabel: 'Estimated total — final quote updates when the fit is complete.',
    designBom: designBom,
    track: track,
    platformMapping: PLATFORM_MAPPING,
    _test: { luckyStructureTokens: luckyStructureTokens, luckyMaterialSequence: luckyMaterialSequence,
      libEntry: libEntry, expandStructureFrame: expandStructureFrame },
  };
})();
