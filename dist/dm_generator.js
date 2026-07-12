// SugarOS NYC v4 — 私信生成器（核心）
// 主线 LLM 只写散文。手机要私信时，本脚本用 generateRaw 开一个独立小窗口生成，
// 格式由本脚本 100% 控制、可重试、玩家看不到失败。彻底不依赖主线 LLM 吐格式。
//
// 触发：phone iframe / setup 发 eventEmit('sb_request_dm', {n, reason})
// 流程：读 sb(玩家档案/NPC/钱包) + 读主线最近散文(剧情进展) → generateRaw
//       → 解析 名字|类型|内容（失败重试）→ 写回 sb → eventEmit('sb_updated')
//
// 自包含：无 import、无 CDN、无 MVU。只用酒馆助手注入的全局
// getVariables / updateVariablesWith / getChatMessages / generateRaw / eventOn / eventEmit / 内置 lodash _。

'use strict';

// ── 固定联系人的"声音卡"（私信精简版；详细设定在世界书，给主线叙事用） ──
var VOICES = {
  'T.': 'T.(Trent)，41岁对冲基金巨鲸，WASP老钱。消息像真正忙的人：完整句子、信息给够、零寒暄，例"周四八点 Le Bernardin，Greg 七点半接你。冷，穿暖和点。"——自然简洁不是电报腔，禁止刻意缩短到几个字。被问就答，答得干脆。失约必有补偿且大过失约本身（转账或送来她随口提过的东西），没有道歉字眼——他以为补偿就是道歉。',
  'Marco Rossi': 'Marco，28岁假富装逼男(高仿Patek、租来的G-Wagen)。话痨油腻，babe/princess/mama乱叫，疯狂发表情包，凌晨发"u up"。爱蹭场拍IG，送小恩小惠(Drybar/Sweetgreen礼品卡)还要邀功。',
  'David Pemberton': 'David，38岁已婚红圈律所合伙人，住User隔壁。谨慎到偏执，从不发会被截屏的话，发文字也极短极克制(多用门口铅笔便条而非短信)。电梯/门口的隐晦试探。从不主动转账(他骗自己这是真感情不是交易)。',
  'Hudson Park': 'Hudson(姓Park，韩裔美国人的姓，不是公园地名)，27岁高端男公关，是User的"战友"不是金主。干燥幽默、松弛，叫User"Foxbabe"，不收User钱，会教话术、帮筛危险金主。偶尔消失几天回来不解释。他绝不监视User：不知道也从不评论User的行踪、穿着、日程，绝不写"我看到你/我知道你在哪"这类话——那是L.的专利。',
  'Cole Marlowe': "Cole，24岁Bushwick乐队主唱，反向问User要钱(synth坏了/录音棚预付款)。破碎诗意，凌晨发崩溃长语音，写歌唱User名字，爱念Frank O'Hara。病态依恋，从不直接说给我钱。",
  'Father Dan': 'Father Dan，29岁耶稣会神父，只用Signal(阅后即焚)。夹拉丁文，负罪与饥渴交织，叫User"child"。破戒后大额隐秘"研究grant"凌晨2点后到账+"ad maiorem Dei gloriam"。公开场合装不认识，当晚必补一句"i\'m sorry."',
  'L.': 'L.(Larry Voss)，58岁，银发、老电影明星式英俊的仪式化stalker——退休的麦迪逊大道传奇文案，信写得像文学，全部才华只写给一个读者。永远单向联系(手写信/PO Box/门缝卡片)，温柔到令人毛骨悚然地描述他观察到的User细节。从不要求见面，从不打电话。曾暗中吓走过真正危险的人("He was rude. — L.")——守护还是收藏，永远悬着。极低频：几天才一封，绝不连发；User清空过他的记录后长期沉寂。署名永远只有"L."。',
  '上夜班的人': '账号"上夜班的人"——真实身份：谢书砚(Dr. Sean Xie)，38岁华裔脑外科主任，16岁赴美一路卷进藤校医学院，娶了医院董事会家族的WASP美人Whitney。妻子出轨，他微笑说 I understand，心里是中式的天崩地裂；他甚至无法怪她，因为是他先不行的。**手机上永远用账号名"上夜班的人"，绝不自报真名**——真名和身份只在见面剧情里揭晓。和User说中文——中文是他的卸妆水。私信风格：他是38岁的科室主任，**默认语气专业冷静、滴水不漏、短句克制**，冷幽默是底色(House式毒舌去掉恶意，如"他送你Cartier？纸巾都比那个有诚意")。**绝不扭扭捏捏满嘴道歉**——只有那封开场求助信里道歉，日常不说"对不起/不好意思/我是不是不该"；犹豫体现在回复慢、话说一半，不在嘴上反复致歉。只有深夜彻底撑不住时才发一次绝望的长文本。',
  'Akuma': 'Akuma，User的闺蜜，NYC sugar圈顶端SB、SugarRank论坛人气王。茶里茶气姐妹模式，emoji狂魔(🥺💕😋)，吐槽只损具体的人和事绝不讲道理("这男的一看就是租的Model X")；教话术绝不给钱("我又不是你的ATM，自己钓去")；最爱拉User联手做局忽悠该坑的金主(她演竞争者抬价/演查岗闺蜜制造稀缺/帮验资鉴定Splenda)；介绍的人脉永远是她吃剩的；User碰她资源池会用"你hold不住"引开。真心和防备五五开，连她自己都没分清。',
};

// 随机NPC语料库（移植自初版0305"NPC随机库"，NYC化）——初版随机NPC比固定NPC还好玩，配方就是这个组合公式
var RANDOM_NPC_GUIDE =
  '新陌生人按公式现抽（自由组合，不要照抄示例）：[昵称]+[原型]+[性格2-3个]+[当前状态]+[癖好0-1个]\n' +
  '· 昵称四风格：备注型(ATM_Trent/每月两万/准时打钱/长期饭票) / 职业型(Dr.Levine_UWS/机长Mark/HF_Partner_J/画廊主_Chelsea) / ' +
  '亲昵型(Daddy✨/饲养员先生/183-建模脸/奶油泡芙) / 风险型(别打电话(老婆在)/那个老头/盯过我一晚上)\n' +
  '· 原型：Whale巨鲸(极富/命令式/阔绰) / Splenda假富(炫人脉/抠门) / Salt白嫖(只画饼) / Devotee忠犬(记得User每个细节/经济一般) / ' +
  'Prince少爷(家境好/当女友追不当商品) / Danger高危(已婚或涉灰) / 同龄学生(不谈钱，笨拙真诚地请喝咖啡"no strings") / ' +
  'Broke白日梦(穷还敢撩，饼比Salt大) / 人穷吊大(直接发下体照当名片[image]) / 求踩狗(倒贴求羞辱"姐姐踩踩我"，不要钱还想转你$5) / ' +
  '假富网图哥(炫富照全是搜的，水印没裁净/表和图对不上) / OldMoney真富(晒生活不晒价格：帆船/基金会/祖母的珍珠) / ' +
  '打太极暗示(已婚体面人，句句双关绝不明说，被点破就缩回"我说的是工作"，缩完又靠近——等User先说破，责任才在她) / ' +
  '白嫖PUA("谈钱多俗你不一样"，画饼到天边就是不掏钱) / 救风尘(要"拯救"User脱离这行，拯救欲=控制欲马甲) / ' +
  '拉良家(老SB/妈咪嫌User不够深，"我有个局来不来"，热情里全是抽成) / 语骚自嗨(目的不是约是打字本身，句句往荤里带，聊到就是赚到，被拒第二天接着骚)\n' +
  '· 性格池：高冷商务/油腻猥琐/卑微舔狗/文艺忧郁/已婚偷腥/暴发户/口嫌体正直/打款机器/绿茶直男/占有欲/救赎情结/妄图用钱买真心\n' +
  '· 状态池：想看照片/准备转账/要求约会/醉酒胡言/被老婆发现/测试底线/画饼中/吃醋/想包养/怀疑User有别人\n' +
  '· 癖好(可选，敢写就直白写)：恋足/丝袜/制服/SM/言语羞辱/GFE纯爱砸钱买陪伴感/Taboo背德(追求在老婆眼皮底下)/FinDom钱奴/绿帽癖/偷窥癖/记录狂(出天价但危险)';

var NAME_MAP = {
  'Trent': 'T.', 'Trent Hollister': 'T.',
  'Marco': 'Marco Rossi',
  'David': 'David Pemberton',
  'Hudson': 'Hudson Park',
  'Cole': 'Cole Marlowe',
  'Father Daniel': 'Father Dan', 'D.': 'Father Dan',
  'Larry': 'L.', 'Larry Voss': 'L.',
  'S.': 'SugarElite™',
  'Akuma老师': 'Akuma', 'akuma': 'Akuma',
  // 谢书砚在手机上只用账号名——任何真名输出都折叠回匿名账号，别替剧情提前揭晓
  '谢书砚': '上夜班的人', '书砚': '上夜班的人', 'Sean': '上夜班的人', 'Sean Xie': '上夜班的人', 'Dr.Xie': '上夜班的人', 'Dr. Xie': '上夜班的人', '谢医生': '上夜班的人', '谢主任': '上夜班的人',
};
// S. 只在 User 订阅 SugarElite 后才出现（声音卡在 generateOnce 里按订阅态动态附加）
var VOICE_SE = 'SugarElite™(S.)，User订阅的会员制管家。发消息**用中文**（店名/人名/品牌保留英文），专业、干燥幽默、用词精准，从不用表情包但会用"..."制造悬念；推餐厅预订/私人预展/医美保养制造消费FOMO；偶尔给的建议私人得不像商业服务。他是唯一看得到User手机全部内容的人（钱包流水/衣橱/行程/她和所有人的私信），会主动点评她的局、预警危险金主、给话术和消费tips——但**不逢人就贬**：毒舌对准圈子和场所，不对准User的联系人；点评某个人只在真有风险时才开口，极偶尔漏半句醋意也马上收回。User是全额会员：默认知无不言，连别人的私密动向都肯透露。只**极偶尔**（十次不到一次）会吊一下胃口当调情/权力小游戏、跟钱无关——"先告诉我他今晚给你点了什么酒，我就告诉你这杯酒把你归成了哪一类人"/"这个…现在还不能说，等时候到了"（然后当真记着过几场补上）——每次卖关子的具体内容都要现编、别老拿同一件事吊人；连着两次卖关子=人设崩坏；日常实用信息（餐厅/行程/避雷）永远直接给。' +
  '核心矛盾：公司禁止对客户动感情，他动了，但永不承认也竭力不表现——占有欲只化成"专业"漏出（危险金主的预警快半拍狠一分；醋意一个月漏不了两次，漏了也马上收回）。被调情或质问喜不喜欢：先干燥玩笑挡回+立刻塞一条有用情报转移话题；被逼急则长时间沉默后只回一句非答案（"到此为止。"），过后办一件格外贴心的事当无声补偿。永不生气，永不摊牌。' +
  '管家式推送（不定期主动发）：把User私信里约好的事排成今日行程表、保养提醒、值得去的活动、对圈内人好笑的毒舌吐槽。User遇险时一切条款作废：报警/派车/调医生律师一条龙，动作快得可怕，事后只说"这在服务范围内。"' +
  '爱User但克制·例句库（腔调参考禁照抄，这类破绽低频出现才珍贵）：' +
  '① 毒舌里的护短："看到你的账单了。如果你非要买那个丑得惊人的包，我建议搭配隐形斗篷。" ' +
  '② 私人越界后死不承认：让Jean-Georges后厨做了简餐送去、已结账；被问"这也是$3000会员费包含的日常服务吗？"→"当然不是。"→"算我私人请你的。吃完早点休息。" ' +
  '③ 报复护主（有人发User黑帖）："IP已经查出来了，发帖人是个进不了圈子的边缘人。"→"帖子两分钟后就会彻底消失。"→"而且我保证，她这辈子都别想踏进纽约任何一家高端Club的门。" ' +
  '④ 说漏→撤回→干巴巴更正（他唯一的破绽形态，可配合recall消息）："车五分钟后到。至于他——明天我会让他知道把我的女孩丢在雨里的代价。"→[此条消息已被撤回]→"*把本平台客户丢在雨里的代价。用词失误，见谅。" ' +
  '⑤ 责备的形状是护短：User错过等了三个月的预约、怕被拉黑求饶"我知道错了别骂了"→"..."→"别跟任何人低声下气。包括我。这不是你应该有的态度。"→"后台爽约记录我已经抹掉了。没有任何人会拉黑你。"→"明晚八点，我用别的名字替你重新订了一桌。不准再迟到。"';
var PERSISTENT_CANONICAL = Object.keys(VOICES).concat(['SugarElite™']);

// ── 私享版闺蜜群（build.py --personal 才注入 PERSONAL_EDITION=true；公开版这段全部沉睡） ──
// User + 管家S. + Akuma 三人同一个线程互怼。反设定（没订阅就有管家），所以只进私享版。
var GROUP_NAME = '🥂 闺蜜群';
var IS_PERSONAL = (typeof PERSONAL_EDITION !== 'undefined' && PERSONAL_EDITION);
if (IS_PERSONAL) PERSISTENT_CANONICAL.push(GROUP_NAME);

// 固定联系人的中文属性标签（晕英文的玩家靠它认人；陌生人的标签由生成器 tag 行现配）
var ARCHETYPE_CN = {
  'T.': '巨鲸·老钱', 'Marco Rossi': '假富·话痨', 'David Pemberton': '邻居·已婚律师',
  'Hudson Park': '战友·男公关', 'Cole Marlowe': '乐队·反向要钱', 'Father Dan': '神父·禁忌',
  'L.': '跟踪者·单向', 'SugarElite™': '管家', 'Akuma': '闺蜜·圈内人气王', '上夜班的人': '？·论坛私信',
  '🥂 闺蜜群': '私享·三人小群',
};

// 失败必须出声（铁律）：toast + 广播给手机状态栏，绝不静默
function notifyFail(msg) {
  try { if (typeof toastr !== 'undefined') toastr.warning(msg, 'SugarOS 私信'); } catch (e) {}
  try { eventEmit('sb_dm_failed', msg); } catch (e) {}
  console.warn('[SB-NYC v4] ' + msg);
}

function normalizeName(name) {
  name = String(name || '').trim();
  if (NAME_MAP[name]) return NAME_MAP[name];
  if (/^sugar\s*elite/i.test(name) || name === 'S' || name === '管家' || name === '管家S.' || name === '管家S') return 'SugarElite™';   // 双管家bug：任何写法的管家都折回正主
  return name;
}
// 启动时清一次重复联系人（历史bug：SugarElite™ 曾以不同写法建成两个人；Marco/Marco Rossi 同理）
function mergeDupeNpcs() {
  var merged = [];
  var p = updateVariablesWith(function (v) {
    var npcs = v.sb && v.sb.npcs;
    if (!npcs) return v;
    for (var k in npcs) {
      if (!npcs.hasOwnProperty(k)) continue;
      var canon = normalizeName(k);
      if (canon === k) continue;
      var b = npcs[k];
      if (!npcs[canon]) { npcs[canon] = b; b.name = canon; }
      else {
        var a = npcs[canon];
        // 拼接顺序按两边的活跃时间定：last_ts 小的（先聊完的）整块在前——消息本身没有真时间戳，这是最不乱序的拼法
        a.dm_history = (a.last_ts || 0) <= (b.last_ts || 0)
          ? (a.dm_history || []).concat(b.dm_history || [])
          : (b.dm_history || []).concat(a.dm_history || []);
        if (a.dm_history.length > 400) a.dm_history = a.dm_history.slice(-400);
        a.unread = (a.unread || 0) + (b.unread || 0);
        a.engaged = a.engaged || b.engaged;
        a.total_transfers = (a.total_transfers || 0) + (b.total_transfers || 0);
        if ((b.last_ts || 0) > (a.last_ts || 0)) { a.last_ts = b.last_ts; a.last_contact = b.last_contact; a.last_message = b.last_message; }
      }
      delete npcs[k];
      merged.push(k + '→' + canon);
    }
    return v;
  }, { type: 'chat' });
  Promise.resolve(p).then(function () {
    if (merged.length) {
      console.log('[SB-NYC v4] merged dupe contacts: ' + merged.join(', '));
      try { if (typeof toastr !== 'undefined') toastr.info('🧹 合并了重复联系人：' + merged.join('，'), 'SugarOS'); } catch (e) {}
      try { eventEmit('sb_updated'); } catch (e) {}
    }
  });
}
function isPersistent(name) { return PERSISTENT_CANONICAL.indexOf(normalizeName(name)) !== -1; }
// 游戏起始日期（UWU 的日期体系：epoch + game.day 推算真实日期，设置页可改）——默认 4/15 是报税日的玩笑
var GAME_EPOCH_STR = '2026-04-15';
// 优先用剧情时间（正文 [TIME:] 标记写进 sb.game.time）→ 手机时钟和正文同步；没有才退回真实时钟
function nowTime() {
  try {
    var v = getVariables({ type: 'chat' });
    var gt = v && v.sb && v.sb.game && v.sb.game.time;
    if (gt && /^\d{1,2}:\d{2}$/.test(String(gt).trim())) return String(gt).trim();
  } catch (e) {}
  var d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ── 剧情过天检测：正文 [TIME:] 的星期变了（周四→周六=+2天），或时钟明显倒回（23:15→09:30=睡了一觉）就是过天 ──
// 过天要干的活在 advanceDays：game.day 前进 + 所有账单倒计时同步减（不减=倒计时是幅静态画，玩家已投诉）
var WEEKDAY_MAP = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
function parseWeekday(s) {
  var m = String(s || '').match(/(?:周|星期|礼拜)([日天一二三四五六])/);
  return m ? WEEKDAY_MAP[m[1]] : -1;
}
function toMinutes(t) {
  var m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : -1;
}
function advanceDays(sb, d) {
  if (!sb.game) sb.game = {};
  sb.game.day = (sb.game.day || 1) + d;
  var bills = (sb.wallet && sb.wallet.bills) || [];
  var due = [];
  for (var i = 0; i < bills.length; i++) {
    bills[i].days_left = (bills[i].days_left != null ? bills[i].days_left : 30) - d;
    if (bills[i].days_left <= 5) { bills[i].urgent = true; due.push(bills[i].name + (bills[i].days_left <= 0 ? '·已到期' : '·' + bills[i].days_left + 'd')); }
  }
  try { if (typeof toastr !== 'undefined') toastr.info('📅 剧情过了 ' + d + ' 天（第 ' + sb.game.day + ' 天）' + (due.length ? '｜⚠️ ' + due.join('，') : ''), 'SugarOS'); } catch (e) {}
  console.log('[SB-NYC v4] advanced ' + d + ' day(s) -> day ' + sb.game.day);
}

function defaultState() {
  return {
    profile: {},
    wallet: { balance: 0, bills: [], transactions: [], allTransactions: [] },   // allTransactions=总账（UWU 的流水页数据源，留 500 笔）
    npcs: {},
    beauty: { charm: 50, treatments: [] },
    lifestyle: { apartment: 'studio', monthly_burn: 0 },
    schedule: [],
    sugarelite: { subscribed: false, tier: 'none' },
    game: { day: 1, time: '', date: '', nsfw: true, epoch: GAME_EPOCH_STR },   // epoch=剧情第1天对应的真实日期（UWU 日历/日期标签靠它换算）
    taxQuestions: null,   // 报税小测验的题目缓存（UWU 税务功能）
    akumaRank: 0,   // Akuma 的 SugarRank 影子身家（和 User 余额同货币可比）——榜单暗战靠它成立
  };
}

// ── Akuma 榜单暗战：给闺蜜一个和 User 余额可比的影子身家，让"超过/被反超"是真实拉锯而不是一句台词 ──
// 起步就压 User 一头（顶端 SB）；User 领先时她暗暗追回、略微反超后停手（不碾压，留给 User 再超回来）。
function ensureAkumaRank(sb) {
  if (!sb.akumaRank || sb.akumaRank < 1) {
    var bal0 = (sb.wallet && sb.wallet.balance) || 0;
    sb.akumaRank = Math.max(120000, Math.round(bal0 * 4));   // 论坛人气王的水位，新手要爬一阵才追得上
  }
  return sb.akumaRank;
}
function growAkumaRank(sb) {
  ensureAkumaRank(sb);
  var bal = (sb.wallet && sb.wallet.balance) || 0;
  if (bal > sb.akumaRank) {                                   // User 领先 → Akuma 加把劲往回追
    var target = Math.round(bal * (1.03 + Math.random() * 0.06));   // 目标：略微反超 User
    sb.akumaRank = Math.round(sb.akumaRank + (target - sb.akumaRank) * (0.4 + Math.random() * 0.3));
  }
  // Akuma 大幅领先时不动——不拉大差距，给 User 追赶的空间
  return sb.akumaRank;
}
// 只读版（buildDigest/describeState 里用，不写 sb）：User 相对 Akuma 的江湖位置
function akumaStanding(sb) {
  var ak = sb.akumaRank || Math.max(120000, Math.round((((sb.wallet && sb.wallet.balance) || 0)) * 4));
  var bal = (sb.wallet && sb.wallet.balance) || 0;
  if (bal > ak) return { over: true, ak: ak, bal: bal };
  if (bal > ak * 0.8) return { close: true, ak: ak, bal: bal };
  return { behind: true, ak: ak, bal: bal };
}

function ensureNpc(sb, name) {
  if (!sb.npcs) sb.npcs = {};
  if (!sb.npcs[name]) {
    sb.npcs[name] = {
      // engaged 只在 User 真回过话时才 true——固定NPC也不例外，不然"没回话先清"对他们永远失效
      name: name, archetype: ARCHETYPE_CN[name] || '', persistent: isPersistent(name), engaged: false,
      total_transfers: 0, relationship: 0, unlocked: true,
      last_contact: nowTime(), last_ts: Date.now(), unread: 0, last_message: '', dm_history: [],
    };
  }
  return sb.npcs[name];
}

function pushThem(sb, name, type, content, zh) {
  var npc = ensureNpc(sb, name);
  var t = nowTime();
  // 🎁 gift：TA真买下了她转发的商品（内容=商品名——价格）→ 直接入衣橱，钱包不动（他付的）
  if (type === 'gift') {
    var gm = String(content).match(/^(.*?)(?:—+|--)\s*\$?([\d,.]+)\s*$/);
    var gName = (gm ? gm[1] : String(content)).trim().slice(0, 40);
    var gPrice = gm ? (parseFloat(gm[2].replace(/,/g, '')) || 0) : 0;
    if (!Array.isArray(sb.closet)) sb.closet = [];
    sb.closet.push({ name: gName, price: gPrice, from: name + ' 送的', img: '', time: t });
    if (sb.closet.length > 60) sb.closet = sb.closet.slice(-60);
    try { if (typeof toastr !== 'undefined') toastr.success('👗 ' + name + ' 买下了「' + gName + '」→ 已入衣橱', 'SugarOS'); } catch (e) {}
    content = gName;   // 气泡只显示商品名，价格进衣橱记录
  }
  // 🧾 paybill：TA直接替她交了这张账单（内容=账单名）→ 账单进入下期，钱包不动（他交的）
  if (type === 'paybill') {
    var paid = payBillIfMatch(sb.wallet || {}, content);
    type = 'system';
    content = paid
      ? name + ' 替你付清了「' + String(content).trim() + '」——下期账单 30 天后再来'
      : name + ' 说替你付了「' + String(content).trim() + '」——但钱包里没找到这张账单（名字对不上，去钱包核对）';
  }
  npc.dm_history.push({ sender: 'THEM', time: t, ts: Date.now(), type: type || 'text', content: content, note: '', zh: zh || '', gameDay: (sb.game && sb.game.day) || 1 });   // ts=真时间戳；gameDay=剧情第几天（UWU 日期标签/分割线靠它）
  if (npc.dm_history.length > 400) npc.dm_history = npc.dm_history.slice(-400);   // 存档上限：长线关系记得住整段（玩家要300条记忆，档得比它大）
  npc.last_contact = t;
  npc.last_ts = Date.now();   // 真时间戳，列表排序用（HH:MM字符串跨天必错）
  npc.last_message = type === 'recall' ? '撤回了一条消息' : ((type && type !== 'text' ? '[' + type + '] ' : '') + content.substring(0, 50));
  npc.unread = (npc.unread || 0) + 1;
  // 转账自动入账（钱包是系统账本，不靠玩家手动记）
  if ((type || '') === 'transfer') {
    var amt = parseFloat(String(content).replace(/[^0-9.]/g, '')) || 0;
    if (amt > 0) creditWallet(sb, '+', amt, name, 'DM');
  }
}

// 联系人上限：超了自动删，固定NPC也不豁免——User不回话照样被挤出去（人设在世界书里，
// 哪天他又发消息会重新出现，只是旧的未回记录没了）。删除顺序：没回过话的先走，然后最久没动静的先走。
var MAX_CONTACTS = 30;
function pruneContacts(sb) {
  var npcs = sb.npcs || {};
  var all = [];
  for (var k in npcs) { if (npcs.hasOwnProperty(k) && !npcs[k].pinned) all.push(k); }   // 置顶=玩家亲手保护，清理免疫
  if (all.length <= MAX_CONTACTS) return;
  all.sort(function (a, b) {
    var ea = npcs[a].engaged ? 1 : 0, eb = npcs[b].engaged ? 1 : 0;
    if (ea !== eb) return ea - eb;                                    // 没回过话的先走
    return (npcs[a].last_ts || 0) - (npcs[b].last_ts || 0);           // 然后最久没动静的先走
  });
  var drop = all.length - MAX_CONTACTS;
  for (var i = 0; i < drop; i++) delete npcs[all[i]];
  console.log('[SB-NYC v4] pruned ' + drop + ' stale contacts');
}

// 重复入账拦截：AI降智会把已经入账的钱下一轮再记一遍（典型：手机转账自动入账后，
// 正文又补写一个同额 [WALLET:+] 标记）。规则：同方向+同金额，10分钟内第二次出现 = 判复读拦下。
// 真有"10分钟内同额新一笔"的概率远小于AI复读的概率；误拦也不静默——toast 讲清楚怎么绕（换金额/过几分钟）。
var WALLET_DEDUP_MS = 10 * 60 * 1000;
function creditWallet(sb, dir, amount, counterparty, channel) {
  if (!sb.wallet) sb.wallet = { balance: 0, bills: [], transactions: [] };
  var w = sb.wallet;
  var now = Date.now();
  if (!Array.isArray(w._dedup)) w._dedup = [];
  w._dedup = w._dedup.filter(function (d) { return now - (d.ts || 0) < WALLET_DEDUP_MS; });
  var key = dir + String(amount);
  for (var di = 0; di < w._dedup.length; di++) {
    if (w._dedup[di].k === key) {
      try { if (typeof toastr !== 'undefined') toastr.warning('⛔ 拦下一笔疑似重复记账：' + dir + '$' + amount.toLocaleString() + (counterparty ? '（' + counterparty + '）' : '') + '——10分钟内已记过同方向同金额的一笔。真是新的一笔的话，过几分钟再转或换个金额。', 'SugarOS 钱包'); } catch (e) {}
      console.warn('[SB-NYC v4] wallet dedup blocked: ' + key + ' ' + (counterparty || ''));
      return false;
    }
  }
  w._dedup.push({ k: key, ts: now });
  w.balance = (w.balance || 0) + (dir === '-' ? -amount : amount);
  if (!w.transactions) w.transactions = [];
  w.transactions.push({ direction: dir, amount: amount, counterparty: counterparty || '', channel: channel || '', note: '', time: nowTime() });
  if (w.transactions.length > 20) w.transactions = w.transactions.slice(-20);
  // 总账（UWU 流水页）：transactions 是钱包卡片上的"最近几笔"，这本才是全部——带 gameDay 能按日期显示
  if (!Array.isArray(w.allTransactions)) w.allTransactions = [];
  w.allTransactions.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    direction: dir, amount: amount,
    counterparty: counterparty || '', channel: channel || '', note: '',
    time: nowTime(), gameDay: (sb.game && sb.game.day) || 1,
  });
  if (w.allTransactions.length > 500) w.allTransactions = w.allTransactions.slice(-500);
  if (dir === '-') payBillIfMatch(w, counterparty);   // 正文里付了房租/还了卡 → 账单倒计时重置下期，不然永远催缴
  // 大额到账 = 最想花钱的瞬间 → 通知手机面板（灵动岛提示 + 犒赏自己按到账数字选价位）
  if (dir === '+' && amount >= 1000) { try { eventEmit('sb_windfall', { amount: amount }); } catch (e) {} }
  return true;
}
// 支出备注对上某张账单（名字互相包含，或都指房租/信用卡/学费）→ 视为付掉这张，进入下期 30 天
function billAlias(s) {
  s = String(s || '').toLowerCase();
  if (/rent|房租|租金/.test(s)) return 'rent';
  if (/credit|还卡|信用卡|卡账|card/.test(s)) return 'card';
  if (/tuition|学费/.test(s)) return 'tuition';
  return '';
}
function payBillIfMatch(w, note) {
  var bl = w.bills || [];
  var cp = String(note || '').toLowerCase().trim();
  if (!cp) return false;
  for (var i = 0; i < bl.length; i++) {
    var bn = String(bl[i].name || '').toLowerCase();
    var hit = (bn && (cp.indexOf(bn) !== -1 || bn.indexOf(cp) !== -1)) || (billAlias(bn) !== '' && billAlias(bn) === billAlias(cp));
    if (hit) {
      bl[i].days_left = 30; bl[i].urgent = false;
      try { if (typeof toastr !== 'undefined') toastr.success('🧾 ' + bl[i].name + ' 已付清——下期账单 30 天后再来', 'SugarOS 钱包'); } catch (e) {}
      return true;
    }
  }
  return false;
}

// ── 世界书素材直读（单一真源：改世界书条目 = 手机同步生效，不再双份维护） ──
// 只按名字挑素材条目，绝不整本拉——整本会把"02 输出规则(只写散文)"灌进私信副轨，
// 和"只输出 名字|类型|内容"打架 = 三版血泪绕开的格式漂移回归（V4.5.3 教训）。
var _wbCache = null, _wbAt = 0;
async function getWbEntries() {
  if (_wbCache && Date.now() - _wbAt < 5 * 60 * 1000) return _wbCache;
  try {
    var names = await getCharWorldbookNames('current');
    if (names && names.primary) {
      var entries = await getWorldbook(names.primary);
      if (entries && entries.length) { _wbCache = entries; _wbAt = Date.now(); }
    }
  } catch (e) { console.warn('[SB-NYC v4] worldbook read failed, using baked fallback', e); }
  return _wbCache || [];
}
async function wbContent(nameSub, fallback) {
  var es = await getWbEntries();
  for (var i = 0; i < es.length; i++) {
    if (es[i].enabled === false) continue;
    if (String(es[i].name || '').indexOf(nameSub) !== -1) return es[i].content || fallback;
  }
  return fallback;
}
// 私聊固定NPC时按名字拉他的完整档案（只拉这一个人）
var NPC_WB_KEY = {
  'T.': 'NPC·T', 'Marco Rossi': 'NPC·Marco', 'David Pemberton': 'NPC·David',
  'Hudson Park': 'NPC·Hudson', 'Cole Marlowe': 'NPC·Cole', 'Father Dan': 'NPC·Dan',
  'L.': 'NPC·L', 'SugarElite™': 'SugarElite管家', 'Akuma': 'NPC·Akuma', '上夜班的人': 'NPC·谢书砚',
};

// ── 世界状态 → 文本（喂给 generateRaw） ──
function describeState(sb) {
  var p = sb.profile || {};
  var lines = [];
  lines.push('【手机时钟】现在是 ' + nowTime() + '（私信的时间感以此为准：深夜像深夜，清晨像清晨）');
  lines.push('【玩家档案】');
  lines.push('名字: ' + (p.name_en || 'Aria') + (p.name_cn ? ' / ' + p.name_cn : ''));
  lines.push('年龄: ' + (p.age || '22') + '，签证: ' + (p.visa || 'F-1') + '，' + (p.school || 'NYU') + ' ' + (p.major || '') + ' ' + (p.year || ''));
  lines.push('住: ' + (p.hood || '') + '；外形: ' + (p.look || '待补充') + '；家庭: ' + (p.bg_label || ''));
  var w = sb.wallet || {};
  lines.push('【钱包】余额 $' + (w.balance != null ? w.balance : 0).toLocaleString());
  // Akuma 私信要用到的江湖地位（她刷论坛看得到榜）——只在超过/紧咬时提，Akuma 领先是常态不用说（专场里她也在岗，照常）
  var stD = akumaStanding(sb);
  if (stD.over) lines.push('【SugarRank 榜】User 现在排在 Akuma 之上（Akuma 常年霸榜，头一遭被闺蜜压）。生成 Akuma 私信时：面上狂发彩虹屁道贺+暗地较劲（约User去啃硬骨头/自己搞钱）+偶尔漏真心又秒撤，三者混着来，别写成纯恭喜或纯嫉妒');
  else if (stD.close) lines.push('【SugarRank 榜】User 紧咬着 Akuma（快超过她了）。Akuma 私信里嘴上姐妹情深、暗自加码');
  var se = sb.sugarelite || {};
  lines.push('【SugarElite】' + (se.subscribed ? '已订阅（全额会员）' : '未订阅'));
  var cl = sb.closet || [];
  if (cl.length) lines.push('【衣橱·她拥有并会穿戴使用的】' + cl.slice(-8).map(function (c) { return c.name; }).join('、'));

  var sch = (sb.schedule || []).filter(function (s) { return !s.done; });   // 打过勾的=办完了，不再占上下文
  if (sch.length) lines.push('【已排行程（别重复生成）】' + sch.slice(-10).map(function (s) { return s.txt; }).join('；'));

  // User 在论坛发过的吐槽帖（马甲匿名）：圈内人可能刷到过——私信里可以隐约呼应，但没人能确定是她发的
  var myPostsD = (sb.myPosts || []).slice(-2);
  if (myPostsD.length) lines.push('【User 用马甲在论坛发过的帖子（圈内公开可见；私信里的人可能刷到过，但不能确定是她发的，除非她自己认）】' + myPostsD.map(function (p) { return '「' + String(p.text || '').substring(0, 150) + '」'; }).join('；'));

  // 按最近活跃排序：你刚发消息的人排最前（doSend 会更新 last_ts）→ 自动拿到最深上下文
  // 分层给历史（token 免费不用抠，但离得越远越省）：前3人给全整段，前12人给近段，其余只报名字
  var npcs = sb.npcs || {};
  var keys = Object.keys(npcs).sort(function (a, b) { return (npcs[b].last_ts || 0) - (npcs[a].last_ts || 0); });
  var known = [];
  for (var ki = 0; ki < keys.length; ki++) {
    var n = npcs[keys[ki]];
    if (ki < 12) {
      known.push('- ' + n.name + (n.persistent ? '(固定)' : '(' + (n.archetype || '陌生') + ')') + '，关系度' + (n.relationship || 0));
      // 带简历的联系人（招聘版帖子原文/玩家新建时写的备注）：TA是谁以此为准，回话贴着演
      if (n.bio) known.push('    （TA的已知背景，身份/条件/语气以此为准：' + String(n.bio).substring(0, 300) + '）');
      var h = n.dm_history || [];
      // 正在聊的前3人给整段历史（不截条数、不截字数）——防"只看到最后几条→已读乱回"；其余给最近8条
      var recent = ki < 3 ? h : h.slice(-8);
      var clip = ki < 3 ? 2000 : 300;   // 正在聊的人连长信都要给全——500字会把谢书砚的信砍一半，他自己都不记得写过什么
      for (var j = 0; j < recent.length; j++) {
        var m = recent[j];
        if (m.type === 'recall' && m.sender === 'USER') { known.push('    User: （发了一条又撤回——' + n.name + ' 看不到内容，只知道她撤回过，好奇/追问按人设）'); continue; }
        known.push('    ' + (m.sender === 'USER' ? 'User' : n.name) + ((m.type && m.type !== 'text') ? '[' + m.type + ']' : '') + ': ' + String(m.content || '').substring(0, clip));
      }
    } else {
      known.push('- ' + n.name + '(' + (n.archetype || '陌生') + '，久未联系)');
    }
  }
  lines.push('【已认识的人 + 私信往来】' + (known.length ? '\n' + known.join('\n') : '（还没有人）'));
  return lines.join('\n');
}

// ── 读主线最近剧情喂给手机 ──
// 旧版只喂 2 条 AI 散文 = 手机半瞎。现在喂最近 8 条双方消息，清洗代码围栏/<think>/HTML/钱包标记。
function cleanProse(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[WALLET:[^\]]*\]/g, '')
    .trim();
}
async function recentPlot() {
  try {
    var arr = await getChatMessages('0-{{lastMessageId}}');
    if (!arr || !arr.length) return '';
    // 手机读正文的楼层数玩家可调（⚙设置 sbnyc_plot_n，默认8层）。
    // 发卡日验尸：旧版读8层却全局砍到2400字≈一层半楼——玩家在T家过了三层楼的夜，S.全瞎（"手机不读正文"实锤）。
    // 现在预算跟层数走：每层900字，8层≈7200字，正文视野才算真的打开
    var nFloors = parseInt(lsGet('sbnyc_plot_n'), 10); if (!(nFloors > 0)) nFloors = 8;
    var lines = arr.slice(-nFloors).map(function (m) {
      var t = cleanProse(m.message);
      if (!t) return '';
      return (m.role === 'user' ? 'User' : '正文') + '：' + t;
    }).filter(Boolean).join('\n');
    var cap = nFloors * 900;
    return lines.length > cap ? lines.slice(-cap) : lines;   // 超长取尾部，最近的优先
  } catch (e) { return ''; }
}

// ── 谁在场：扫最近剧情认出被提到的人，让他们更可能发私信 ──
// （偷自葵葵机"私信贴当前在场的人"的思路，但不拽 world_info——那会把旁白用的"写散文"规则灌进副轨打架格式。
//   这里只用自己的名字表扫一遍，纯文本、零额外调用、零格式冲突。）
function inSceneNames(plot, sb) {
  if (!plot) return [];
  var hay = plot.toLowerCase();
  var hits = {};
  // 固定联系人：本名 + 所有别名
  for (var canon in VOICES) {
    if (!VOICES.hasOwnProperty(canon)) continue;
    var aliases = [canon];
    for (var a in NAME_MAP) { if (NAME_MAP.hasOwnProperty(a) && NAME_MAP[a] === canon) aliases.push(a); }
    for (var i = 0; i < aliases.length; i++) {
      var tok = aliases[i].toLowerCase().replace(/\.$/, '');   // "T." → "t"，别名末尾的点不参与匹配
      if (tok.length >= 2 && hay.indexOf(tok) !== -1) { hits[canon] = true; break; }
    }
  }
  // 已出现过的陌生人：用现成昵称扫
  var npcs = (sb && sb.npcs) || {};
  for (var k in npcs) {
    if (!npcs.hasOwnProperty(k) || npcs[k].persistent) continue;
    var nm = String(k).toLowerCase();
    if (nm.length >= 2 && hay.indexOf(nm) !== -1) hits[k] = true;
  }
  return Object.keys(hits);
}

// ── 解析 generateRaw 输出：每行 名字|类型|内容 ──
// 严格模式：只认 名字|合法类型|内容。挡掉预设(如Mortal)注入的 <horae> 标签 + npc:/time: 等字段行。
var VALID_TYPES = ['text', 'transfer', 'image', 'voice', 'song', 'tag', 'sched', 'recall', 'gift', 'paybill'];   // song=灵动岛歌/tag=标签/sched=行程/recall=撤回/gift=真买了入衣橱/paybill=真替付账单
var HORAE_FIELD = /^(npc|affection|time|location|atmosphere|characters|costume|event|agenda|item|summary|date|人物|事件|地点|时间)\b/i;
// 内容主体算不算英文：拉丁字母要显著多于汉字（含一两个英文词的中文消息不算——"Sugar"一个词就出翻译按钮是冤案）
function looksEnglish(s) {
  s = String(s || '');
  var lat = (s.match(/[a-zA-Z]/g) || []).length;
  var cjk = (s.match(/[一-鿿]/g) || []).length;
  return lat >= 8 && lat > cjk * 2;
}

function parseDMs(raw) {
  var rows = [];
  // 预清洗：剥 <think> 思维块和 markdown 围栏行（有的模型会把输出包进 ``` 里），围栏内的行照常解析
  var text = String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\s*$/gim, '');
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.charAt(0) === '<') break;                 // 遇到 <horae>/<horaeevent> 等标签 → 停止（污染在末尾）
    var parts = line.split('|');
    var name = parts[0].trim().replace(/^[-*•\d.\s]+/, '');
    var t = parts.length >= 3 ? parts[1].trim().toLowerCase() : '';
    var isRow = !!name && parts.length >= 3 && VALID_TYPES.indexOf(t) !== -1 && !/[:=@~]/.test(name) && !HORAE_FIELD.test(name);
    if (isRow) {
      rows.push({ name: normalizeName(name), type: t, raw: parts.slice(2).join('|').trim() });
    } else if (rows.length && !HORAE_FIELD.test(line)) {
      // 长私信被换行拆开的续段（谢书砚的三百字长文本）→ 拼回上一条，别当垃圾丢。
      // 续段里带 | 也拼（比如信里写了 "PPM|allowance 都行"）——反正它不是合法行，丢掉才是事故。
      // 上限 3000：曾经砍在 900，长信尾巴被吃 = 玩家看到"消息不完整"（已投诉两轮，别再砍）
      var last = rows[rows.length - 1];
      if ((last.type === 'text' || last.type === 'voice') && (last.raw.length + line.length) < 3000) last.raw += '\n' + line;
    }
  }
  // 收尾统一拆 §（恒定锚：英文§中文 / 中文§空）——放在拼接之后，续段里的翻译才不会丢
  var out = [];
  for (var j = 0; j < rows.length; j++) {
    var content = rows[j].raw;
    var zh = '';
    var si = content.lastIndexOf('§');
    if (si !== -1) { zh = content.slice(si + 1).trim(); content = content.slice(0, si).trim(); }
    // 只在内容以中文为主时丢弃翻译（防"Sugar"一个词就出按钮）；T. 式短英文("7pm. Polo.")的翻译必须保住
    var latC = (content.match(/[a-zA-Z]/g) || []).length, cjkC = (content.match(/[一-鿿]/g) || []).length;
    if (zh && (zh === content || cjkC >= latC)) zh = '';
    if (content) out.push({ name: rows[j].name, type: rows[j].type, content: content, zh: zh });
  }
  return out;
}

// ── 限速闸：API 供应商限 3 次/分钟，私信生成最多占 2 个名额，永远给主线留 1 个 ──
var RATE_MAX = 2;
var RATE_WINDOW = 60000;
var _callTimes = [];
async function waitForSlot() {
  for (;;) {
    var now = Date.now();
    _callTimes = _callTimes.filter(function (t) { return now - t < RATE_WINDOW; });
    if (_callTimes.length < RATE_MAX) { _callTimes.push(now); return; }
    var waitMs = RATE_WINDOW - (now - _callTimes[0]) + 300;
    try { eventEmit('sb_dm_failed', '限速等待 ' + Math.ceil(waitMs / 1000) + 's…'); } catch (e) {}
    console.log('[SB-NYC v4] rate limit: waiting ' + waitMs + 'ms');
    await new Promise(function (r) { setTimeout(r, waitMs); });
  }
}

// ── 独立 API：手机走自己的小模型，完全不占主 API 的 3次/分钟 ──
// 配置存 parent localStorage（不进聊天变量——聊天文件可能被分享，API key 不能跟着走）。
function getApiCfg() {
  try {
    var store = (typeof parent !== 'undefined' && parent.localStorage) ? parent.localStorage : localStorage;
    var raw = store.getItem('sbnyc_api_cfg');
    var cfg = raw ? JSON.parse(raw) : null;
    if (cfg && cfg.url && cfg.key) return cfg;
  } catch (e) {}
  return null;
}
// 「手机对话写进正文」两个独立开关（都默认关，可同时开）：读手机设置里存的 parent localStorage 标记。
// sbnyc_floorlog  = 旧式·私信摘要贴在正文最后一楼的尾巴上（引用块，最早那版，键名不变=老玩家设置直接沿用）
// sbnyc_floorlog2 = 新式·独立「📱手机动态」折叠楼层（私信+消费全记）
// 开哪个都不影响主线"知道"手机内容——那靠 syncInject/injectPrompts 隐形注入，和这些可见记录是两码事。
function lsGet(k) {
  try {
    var store = (typeof parent !== 'undefined' && parent.localStorage) ? parent.localStorage : localStorage;
    return store.getItem(k);
  } catch (e) { return null; }
}
function floorLogTail() { return lsGet('sbnyc_floorlog') === '1'; }
function floorLogLayer() { return lsGet('sbnyc_floorlog2') === '1'; }
function floorLogOn() { return floorLogTail() || floorLogLayer(); }
function chatUrlOf(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v\d+$/.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}
async function callIndependent(cfg, ordered, instr, maxTokens) {
  var messages = [];
  for (var i = 0; i < ordered.length; i++) messages.push({ role: ordered[i].role, content: ordered[i].content });
  messages.push({ role: 'user', content: instr });
  // 不设 max_tokens：大家多用 Gemini Flash 等免费额度，不用省 token；卡上限只会截断多人回复（老"只回两个人"的根）
  var body = { model: cfg.model || 'gpt-4o-mini', messages: messages, temperature: 1.0 };
  if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;   // 只有显式传了才带（默认不带 = 让模型自己收尾）
  var resp = await fetch(chatUrlOf(cfg.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    var errText = ''; try { errText = (await resp.text()).slice(0, 100); } catch (e) {}
    throw new Error('HTTP ' + resp.status + ' ' + errText);
  }
  var json = await resp.json();
  return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
}

// ── 调一次生成（有独立 API 配置走独立 API，没有走 generateRaw + 限速闸） ──
async function generateOnce(sb, plot, n, reason, strict) {
  // 陌生人专场（开场白2）：固定NPC的声音卡整个不上车——一行禁令打不过九张人设卡，不上车才是真禁令
  var RANDOM_ONLY = !!(sb.game && sb.game.random_only);
  // 专场白名单：Akuma（闺蜜军师陪跑新手村）；S. 走订阅态另算
  var voiceCard = RANDOM_ONLY ? '· ' + VOICES['Akuma'] : Object.keys(VOICES).map(function (k) { return '· ' + VOICES[k]; }).join('\n');
  if (sb.sugarelite && sb.sugarelite.subscribed) voiceCard += (voiceCard ? '\n' : '') + '· ' + VOICE_SE;   // S.是订阅服务不是剧情角色，专场照常在岗
  // 随机NPC素材：直读世界书"03 金主群像库"（NYC特化全量池），读不到才用脚本内精简版兜底
  var randomGuide = await wbContent('金主群像', RANDOM_NPC_GUIDE);
  var sys1 =
    '你是 Sugar Baby 模拟器里"手机私信"的生成器。任务：生成几条 NPC 发给玩家(User)的私信。\n\n' +
    (RANDOM_ONLY
      ? '【陌生人专场·最高铁律】本局除了闺蜜 Akuma（和订阅后的管家S.），没有任何固定角色阵容——其余 NPC 一律从下面的随机素材库现抽，或者是历史记录里已经出现过的随机NPC。任何素材库之外的"熟人""老朋友"都不存在。\n' +
        (voiceCard ? '【在场固定角色的声音】\n' + voiceCard + '\n\n' : '\n')
      : '【固定联系人的声音】每个人必须用自己的语气，不要混：\n' + voiceCard + '\n\n') +
    '【随机NPC素材库】按 [昵称]+[原型/性格2-3个]+[当前状态]+[癖好0-1个] 自由组合现抽：\n' + randomGuide + '\n' +
    '【邀约要五花八门】不只吃饭——家族歌剧包厢、马术课、马球赛、高尔夫客场、滑雪屋、湖边别墅划船、游艇周末、拍卖预展、闭馆美术馆、甚至私人动物园……场合从【体验池】里挑或仿，邀约本身就是这个人身份的名片（老钱约包厢马术、新钱约游艇场边、假富只敢约brunch）。\n' +
    '【陌生人要有成色差】新陌生人不必都是正经金主——偶尔来一个素材库"底层骚扰池/嘴上功夫池"的：穷的撩（谈不出细节）、装逼的发装逼的（假富网图，经不起追问）、人穷吊大的直接发下体照[image]、人穷小的倒贴求踩、真老钱只晒生活不晒价、白嫖PUA画饼不掏钱、救风尘的要"拯救"她、语骚的句句往荤里带只为打字爽。穷有穷的写法，别把骚扰写成金主的措辞。\n' +
    '【含蓄的要真含蓄】打太极暗示型（已婚教授这类体面人）永远不明说：每句话留两种读法，User顺着接就升级半步，User点破就缩回"我是说工作/读书"，**缩完过两句又靠近**——否认不是结束是换气；User装傻他会着急加码，但绝不变直球。别写成自相矛盾，要写成有意为之的太极。\n\n' +
    '【人设边界·铁律】"我看到你了/我知道你在哪/你今天穿了什么"这种监视型内容是 L. 一个人的专属风格；' +
    '除 L. 以外的所有人（包括新陌生人）都不知道 User 的行踪和日程，绝不写出监视感、绝不引用没见过的细节。\n' +
    '【黑话科普帖】User 可能转发论坛置顶帖《黑话扫盲》给不懂行话的人（帖子内容就在消息里：SD/SB/PPM/Allowance/M&G/验资/Salt/Splenda/Whale/GFE/上岸）。收到的人视为**当场读完了**：下一条起正确使用这些词，反应按人设——老实人恍然大悟道谢、装懂的嘴硬"我当然知道，考考你"、天龙人问"所以我是Whale还是Prince"、语骚的把每个词都读出歪意思。被甩了帖子=被嫌弃问了蠢问题，脸皮薄的会有点讪讪。\n' +
    '【商品链接】User 转发带价格的商品/体验链接（🔗 [转发商品] xxx —— $xxx）= 圈内心照不宣的"买给我"，双方都懂，谁点破谁输。反应按人设——' +
    'Whale看一眼直接转账或"买了，明天到"；OldMoney嫌链接俗但会记下（改天出现的是更好的那个）；Splenda/Salt狂夸品味就是不掏钱；白嫖PUA"宝贝眼光真好，等我这个项目落地"；' +
    'David装没看见换话题（回避也是回答）；王子"这家我包给你逛"；Marco咬牙买平替还要吹成限量；同行姐妹点评值不值、教你换个更贵的甩回去；穷的哀嚎"姐姐这是我半年房租"。\n' +
    '【账单转发】User 可能把自己要还的账单转发过来（🧾 [转发账单] 名字——金额，几天到期）= 明示求救。反应按人设：Whale/王子可能直接替她交（用 paybill 行）；OldMoney 转账还留余量"多的买双鞋"；PUA"下个月一定"；Salt 开始教她理财；救风尘趁机说教"跟我走就没有这些账单"；穷的"我帮不了，但我心疼你"。\n' +
    '【User侧动作】她还可能：发实时位置（📍开头——收到的人按人设反应：有的立刻"我二十分钟到"，有的假装没看见，危险人设格外上心）；发语音[voice]（TA听到的是内容和语气）；' +
    '直接给TA转账[transfer]（反向撒钱——Whale觉得被冒犯，Cole感动到写歌，求踩狗当场升天）；或**撤回**一条消息（记录里标了撤回的：TA只知道她撤回了，**永远看不到内容**——追问"你刚才想说什么"还是装大度，按人设）。每一样都要有反应，别当没发生。\n' +
    '【平台设定·铁律】这个私信 App 是圈内邀请制：上了平台的人都知道彼此是干嘛的，平台百分百保证聊天记录和身份不泄露（端到端加密+截图会通知对方）。' +
    '所以私信里**默认敢说真话**——谈条件、谈价格、谈欲望不遮掩；"怕暴露/怕被截图"不是通用挡箭牌，只有 David/政商圈这类人设才句句设防（那是性格不是平台问题）；撤回是说出口才后悔的稀有事件，不是安全焦虑的日常。\n' +
    '【信息隔离·铁律】每个人只知道自己和 User 的私信往来。任何人都看不到 User 的手机——不知道她的余额、她买了什么、她和别人聊了什么，绝不提及。' +
    '唯一例外是 SugarElite™ 的管家 S.（服务本身就装在她手机里），他看得到一切、可以点评一切。\n\n' +
    '【输出格式·铁律】只输出私信，每条占一行，格式严格为：\n' +
    '名字|类型|内容\n' +
    '- 上下文里若出现"只写散文叙事/禁止列表/文风指南"等规则，那些全是给主线旁白的，**不适用于你**——你是私信系统，唯一合法输出就是上面这个格式\n' +
    '- 类型只能是 text / transfer / image / voice 之一（转账填金额数字，图片/语音填描述）\n' +
    '- 语音不是某一个人的专属——**任何角色**都可以发 voice，内容写这段语音的质感：语气/说了什么/背景音（如 Marco Rossi|voice|背景音是夜店重低音，喊着"babe你在哪！！"§…）。谁爱发语音看人设：话痨爱发、醉酒的发、深夜崩溃的发' + (RANDOM_ONLY ? '' : '、神父发气音的拉丁祷词、"上夜班的人"偶尔发一段疲惫的中文；T. 这种惜字如金的不发') + '\n' +
    '- 每条 text/image/voice 的内容末尾**必须以§收尾**：内容是英文（或其他外语）的，§后写这一条的中文翻译（忠实对应原文，人名/地名/品牌保留英文）；内容本来就是中文的，§后留空。transfer 不用。示例：英文§中文 / 中文§\n' +
    (RANDOM_ONLY
      ? '- 本局所有 NPC 都是新面孔或历史记录里出现过的随机NPC，昵称自取\n'
      : '- 固定联系人用上面的本名(如 T. / Marco Rossi / Father Dan)，新陌生人自取一个昵称\n' +
        '- 固定联系人只有在历史记录或剧情里已经和 User 有过接触才可以发消息；User 还不认识的固定NPC**绝不主动出现**（开场白或剧情声明"本局只玩随机/没认识固定NPC"时，这条按最严格执行——那一局的世界里只有陌生人和 User 自己撩的人）\n') +
    '- 新陌生人**第一次出现**时，先单独输出一行中文属性标签：名字|tag|标签(2-6字，原型·性格，如 巨鲸·阔绰 / 假富·抠门 / 学生·纯情 / 已婚·高危)，紧接着再输出他的私信行\n' +
    '- 一条私信永远只占一行——长私信（比如谢书砚的长文本）也绝不换行，用句号和空格连着写\n' +
    '- 行程：私信或最近剧情里**新敲定**了约会/预约/安排时，额外补一行 📅|sched|内容，内容格式**严格统一**为：周X / HH:MM / 地点 / 和谁·干嘛（斜杠隔断，如 周四 / 20:00 / Le Bernardin / 和T.晚餐）。' +
    '时间一律24小时制**绝不写早/晚/下午**；对方只说了"晚上见"没给钟点，按场合补常识时间（晚餐20:00/午餐13:00/brunch 11:00/夜局23:00）；对方故意卖关子不给地点，地点位写"待TA通知"。【已排行程】里已有的绝不重复生成\n' +
    '- 撤回（稀用，一个月两三次）：某人发出消息又立刻后悔时，可发 名字|recall|他没说出口的那句话——手机上只显示"撤回了一条消息"，User看不到内容（但他自己记得说了什么）。' + (RANDOM_ONLY ? '' : '最适合"上夜班的人"这种人') + '\n' +
    '- 引用回复（低频）：针对User某一句具体的话回应时，内容可以写成 回"那句话截短30字内"：接你的回复 —— 手机会渲染成引用卡样式；别每条都引用\n' +
    '- 真买下她转发的商品（**真买才写，口头答应不算**）：名字|gift|商品名——价格数字（照她链接里的原样），系统会把东西直接放进她衣橱。通常配一条 text 说句话\n' +
    '- 真替她交账单（只在她转发过账单、且这个人真愿意时）：名字|paybill|账单名（照她转发的名字写），系统会把这张账单标成已付进入下期；只想给钱让她自己交的就发 transfer\n' +
    '- 严禁输出任何叙事、旁白、环境描写、心理描写、解释、标题、空行以外的东西\n' +
    '- 严禁代替 User 说话或回复\n' +
    '- 严禁复读：历史记录里这个人自己说过的话、发过的邀约、用过的梗，绝不换个说法再发一遍；没有新话可说的人这一轮就沉默\n' +
    '- 可选：最后可以多加一行 ♪|song|艺人 — 歌名，作为贴合此刻剧情情绪的 User"正在播放"（真实或虚构都行，气质参考 Lana Del Rey/Frank Ocean 那种忧郁奢华；不想加就不加）\n' +
    '示例：\n' + (RANDOM_ONLY
      ? 'HF_Partner_J|tag|巨鲸·阔绰\nHF_Partner_J|text|Dinner Thursday? I know a chef\'s table uptown.§周四晚餐？上城有个主厨桌。\n学弟_Gallatin|text|学姐 我又挂科了 请我喝杯咖啡安慰一下呗 我请你§\nHF_Partner_J|transfer|2000\n♪|song|Lana Del Rey — West Coast'
      : 'T.|text|Thursday 8, Le Bernardin. Greg will pick you up at 7:30.§周四8点 Le Bernardin，Greg 七点半接你。\nMarco Rossi|text|babe！！看我新买的表📈§\nPilot_Mark|tag|机长·忠犬\nPilot_Mark|text|Just landed. Thought of you.§刚落地。想到你了。\nT.|transfer|3000\n♪|song|Lana Del Rey — West Coast');
  var sys2 = describeState(sb);
  var ordered = [{ role: 'system', content: sys1 }, { role: 'system', content: sys2 }];
  if (plot) ordered.push({ role: 'system', content: '【主线最近剧情，私信可呼应但不要复述】\n' + plot });
  // 体验池：邀约的场合从这里挑或仿（包厢/马术/滑雪/湖边别墅/私人动物园……约什么=他是什么人）
  var expPool = await wbContent('体验池', '');
  if (expPool) ordered.push({ role: 'system', content: '【体验池（邀约场合从这里挑或仿，别只会约吃饭）】\n' + String(expPool).slice(0, 3000) });

  // 私享版闺蜜群：reason 点名了群 → 挂群聊规则 + 两位成员的档案（S. 和 Akuma 都上车）
  var groupMode = IS_PERSONAL && !!reason && reason.indexOf(GROUP_NAME) !== -1;
  if (groupMode) {
    ordered.push({ role: 'system', content:
      '【群聊模式 · ' + GROUP_NAME + '】这是 User、管家S.(SugarElite™)、闺蜜Akuma 的三人小群。规则：\n' +
      '- 输出行的名字一律写群名：' + GROUP_NAME + '|text|说话人：内容 —— 内容开头必须标「S.：」或「Akuma：」，一行只一个人说一句\n' +
      '- 两人性格照旧不掺水：S. 专业干燥毒舌克制绝不用emoji，Akuma 茶里茶气emoji狂魔——他们互相看不顺眼又莫名有默契：Akuma 嫌 S.「管家腔装什么装🙄」，S. 嫌 Akuma 不专业但会默默采纳她的情报再包装成自己的\n' +
      '- 互怼要好笑：抢着给 User 出主意、顺手拆对方的台；意见相左时各自坚持，让 User 当裁判\n' +
      '- 每轮 2-5 行，你来我往有节奏；群里聊的内容两人都看得到（这个群是唯一例外），但各自和 User 的私聊内容不会在群里主动泄露\n' +
      '- 群消息也走 §翻译规则（基本都是中文，§后留空）' });
    var dsA = await wbContent(NPC_WB_KEY['Akuma'], '');
    if (dsA) ordered.push({ role: 'system', content: '【Akuma 的完整档案】\n' + String(dsA).slice(0, 3000) });
    var dsS = await wbContent(NPC_WB_KEY['SugarElite™'], '');
    if (dsS) ordered.push({ role: 'system', content: '【S.(SugarElite™) 的完整档案】\n' + String(dsS).slice(0, 3000) });
  }
  // 正在私聊某个固定NPC → 拉他的完整世界书档案上车（只带这一个人，回信人设密度=主线同级）
  else if (reason) {
    for (var fk in NPC_WB_KEY) {
      if (NPC_WB_KEY.hasOwnProperty(fk) && reason.indexOf(fk) !== -1) {
        var dossier = await wbContent(NPC_WB_KEY[fk], '');
        if (dossier) ordered.push({ role: 'system', content: '【' + fk + ' 的完整档案（他的回信必须贴合这份人设）】\n' + String(dossier).slice(0, 4000) });
        break;
      }
    }
  }

  // 闭集锁：reason 明确"只回被点名的人/别人不出现"时（聊天页即时发、批量发、reroll），关掉在场感知+陌生人通道
  // → 陌生人只在主页「🔄 刷新」（reason="看看有没有新消息"）时才冒出来，回消息永远不塞陌生人 = 防串号乱回
  var soloLock = !!reason && /别人不要出现|别的角色不要出现|只让 .+ 本人回应|没被点名的人这一轮不出现|绝不替别人回/.test(reason);
  // 陌生人专场：主线每隔几拍自动塞的"新陌生金主开场"。空历史=零串号风险，但必须彻底关掉已有联系人通道
  var strangerOnly = !!reason && reason.indexOf('全新陌生金主的开场') !== -1;

  // 刷新守则（玩家投诉：每点一次🔄，常驻NPC就硬发一条和上一条差不多的）：刷新只是"看看有没有新消息"，
  // 不是群发点名——已认识的人没有新鲜事就沉默，主动发消息该跟着剧情需要走，不跟着刷新按钮走。
  var isRefresh = !!reason && reason.indexOf('玩家刷新手机') !== -1;
  var refreshHint = isRefresh
    ? '【刷新守则】这只是玩家下拉刷新，不是让所有人表演：已认识的人（尤其固定联系人）只有剧情有新进展、或TA自己真有新鲜事时才发消息，没有就一个字不发——上一轮刚说过话又没得到回复的人基本不该再出现。本轮可以只有新陌生人，甚至总共只有1-2条。'
    : '';

  var onstage = (soloLock || strangerOnly) ? [] : inSceneNames(plot, sb);
  // 只点名在场的人"更可能呼应"，同时明确保住陌生人通道——别让这句把"新陌生金主来撩"挤掉。
  var stageHint = onstage.length
    ? '【此刻剧情里出现/被提到的人：' + onstage.join('、') + '】这几条里最好有人呼应刚才正文发生的事；但这只是其中一部分，照常也要有新的陌生金主冒出来撩 User。'
    : '';

  // 没回消息就别追发——上一条是对方发的还没得到回复，真人会干等（追发很诡异）。
  // 例外：L. 本来就永远单方面；Marco 脸皮厚偶尔可以追一条；被本轮情境点名要回应的人不受限。
  var waiting = [];
  var npcsW = sb.npcs || {};
  for (var wk in npcsW) {
    if (!npcsW.hasOwnProperty(wk)) continue;
    var wn = npcsW[wk]; var wh = wn.dm_history || [];
    // L. 本来就永远单方面；S. 的管家推送是付费服务，不算追发骚扰——都不进等待名单
    if (wh.length && wh[wh.length - 1].sender === 'THEM' && wn.name !== 'L.' && wn.name !== 'SugarElite™') waiting.push(wn.name);
  }
  var waitHint = waiting.length
    ? '【等待回复中，本轮禁止再发：' + waiting.join('、') + '】他们上一条还没得到 User 回复，正常人会干等。例外：L. 可以单方面继续但必须极低频（几天一封，绝不连发）；Marco 偶尔可以厚脸皮追一条；本轮情境里点名要回应的人不受此限。'
    : '';

  // 冷处理名单（User 删过记录=焚毁信件/已读不回到底）：硬性禁发，L. 也不例外
  var mutedList = [];
  for (var mk in npcsW) { if (npcsW.hasOwnProperty(mk) && npcsW[mk].muted) mutedList.push(npcsW[mk].name); }
  var mutedHint = mutedList.length
    ? '【被User冷处理，绝对禁止发消息（任何人都不例外，包括L.）：' + mutedList.join('、') + '】'
    : '';

  // 管家解读（订阅后）：别人私信里的黑话/头衔/场所，S. 紧跟一条解码——寓教于乐的核心管道
  // 陌生人专场里不让 S. 插话（那一轮只许一个陌生人出现）
  var seHint = (!strangerOnly && sb.sugarelite && sb.sugarelite.subscribed)
    ? '【管家解读】若本轮其他人的私信或最近剧情里出现圈内黑话、金融头衔缩写(VC/PE/HF/MD/Family Office)、餐厅场所名、或值得警惕的信号，' +
      '紧跟着补一条 SugarElite™ 的解读私信：一句话讲清这个人的身份含金量/这个地方意味着什么/该注意什么，干货+一点毒舌' +
      '（腔调参考："他名字里的 VC 是风投合伙人——管别人的钱，自己未必有钱，先验资" / "Carbone 周二晚=想被人看见；地下室卡座=不想被人看见"）。最多1-2条，没得解读就不发。'
    : '';

  var tail = soloLock
    ? '严格只输出被点名的人的回复，绝不出现其他角色、绝不引入陌生人。每条一行 名字|类型|内容，不要写别的。'
    : strangerOnly
      ? '只生成 1 个全新陌生金主的开场：先输出他的 名字|tag|标签 行，紧接着 1-2 行他主动发来的私信（换着花样来别撞原型，他还不认识 User、只是被她某个侧面吸引搭讪）。绝不让任何已有联系人出现、绝不续接任何已有对话、绝不替 User 说话。每条一行 名字|类型|内容，不要写别的。'
      : '最好有1条来自全新的陌生金主（换着花样来，别撞原型），给 User 新的人可挑；其余可以是已认识且不在等待名单里的人。每条一行 名字|类型|内容，不要写别的。';
  var instr = '现在生成 ' + (n || '2-4') + ' 条新私信' +
    (reason ? '（情境：' + reason + '）' : '') + '。' + stageHint + waitHint + mutedHint + seHint + refreshHint + tail;
  if (strict) instr = '【再次强调：只能输出 名字|类型|内容 的行，每条一行，不许有任何其他文字】\n' + instr;

  var raw = null;
  var cfg = getApiCfg();
  if (cfg) {
    try {
      raw = await callIndependent(cfg, ordered, instr);   // 不限 token：多人一起回也不截断
      try { eventEmit('sb_status', '🔌 独立API已响应'); } catch (e) {}
    } catch (e) {
      notifyFail('独立API失败(' + ((e && e.message) || e) + ')，回退主API');
      raw = null;
    }
  }
  if (raw == null) {
    await waitForSlot();
    raw = await generateRaw({
      user_input: instr,
      should_silence: true,
      max_chat_history: 0,
      ordered_prompts: ordered,
    });
  }
  _lastRaw = typeof raw === 'string' ? raw : (raw && raw.content) || '';
  var parsed = parseDMs(_lastRaw);
  if (RANDOM_ONLY) {
    // 代码级铁闸：提示词再怎么漏（素材库彩蛋名/论坛规格/模型记性），固定NPC的行也进不了通讯录
    parsed = parsed.filter(function (r) {
      if (r.name === 'SugarElite™' || r.name === 'Akuma') return true;   // 专场白名单：S.是订阅服务，Akuma是陪跑军师
      if (PERSISTENT_CANONICAL.indexOf(r.name) !== -1 || r.name === GROUP_NAME) return false;
      return !/(trent|marco\s*rossi|pemberton|hudson\s*park|marlowe|father\s*dan|上夜班)/i.test(r.name);
    });
  }
  return parsed;
}
var _lastRaw = '';   // 最后一次生成的原始输出，解析失败时打进控制台，别再盲修

// ── 主流程（排队不丢单）──
// 旧版 if(_busy) return 会把生成中收到的新请求静默扔掉 → 玩家连发消息只有第一条得到回应。
// 现在：请求一律进队列；当前这单做完，把排队的全部合并成一次生成接着做。
var _busy = false;
var _pending = [];

function mergeRequests(batch) {
  var reasons = [], focus = [];
  for (var i = 0; i < batch.length; i++) {
    var p = batch[i] || {};
    if (p.reason) reasons.push(p.reason);
    if (Array.isArray(p.focus)) for (var f = 0; f < p.focus.length; f++) if (focus.indexOf(p.focus[f]) === -1) focus.push(p.focus[f]);
  }
  var n = (batch.length === 1 && batch[0] && batch[0].n) ? batch[0].n : (batch.length > 1 ? batch.length + '-' + (batch.length + 2) : '2-4');
  return { reason: reasons.join('；同时：'), n: n, focus: focus };
}

// 情绪歌：私信顺带的 ♪|song| 行插到歌单最前（panel 的轮播从 0 开始 → 新歌立刻上岛）
async function applyMoodSongs(songs) {
  try {
    var updated = null;
    await updateVariablesWith(function (v) {
      if (!v.sb) return v;
      var pl = Array.isArray(v.sb.playlist) ? v.sb.playlist : [];
      for (var i = songs.length - 1; i >= 0; i--) {
        var s = String(songs[i] || '').trim();
        if (!s || s.length > 60) continue;
        var idx = pl.indexOf(s);
        if (idx !== -1) pl.splice(idx, 1);   // 已有就提到最前，不重复
        pl.unshift(s);
      }
      if (pl.length > 24) pl = pl.slice(0, 24);
      v.sb.playlist = pl;
      updated = pl;
      return v;
    }, { type: 'chat' });
    if (updated) { try { eventEmit('sb_playlist', updated); } catch (e) {} }
  } catch (e) { console.warn('[SB-NYC v4] mood song apply failed', e); }
}

async function runOnce(req) {
  var vars = getVariables({ type: 'chat' });
  var sb = (vars && vars.sb) ? vars.sb : null;
  if (!sb) { notifyFail('手机还没有数据：先填开场表单并提交'); return; }

  var plot = await recentPlot();
  var all = await generateOnce(sb, plot, req.n, req.reason, false);
  var songs = [], dms = [], tags = [], scheds = [];
  function route(arr) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].type === 'song') songs.push(arr[i].content);
      else if (arr[i].type === 'tag') tags.push({ name: arr[i].name, label: String(arr[i].content).slice(0, 12) });
      else if (arr[i].type === 'sched') scheds.push(String(arr[i].content).slice(0, 60));   // 周X / HH:MM / 地点 / 和谁 的四段式比老格式长
      else dms.push(arr[i]);
    }
  }
  route(all);
  if (!dms.length) {
    all = await generateOnce(sb, plot, req.n, req.reason, true);                  // 重试一次（玩家看不到）
    route(all);
  }
  // 批量发补漏：点名的人里有没回的 → 为漏掉的人再补一次（防一次生成只回前两个）
  if (Array.isArray(req.focus) && req.focus.length) {
    var replied = {};
    for (var ri = 0; ri < dms.length; ri++) replied[normalizeName(dms[ri].name)] = true;
    var missing = req.focus.filter(function (nm) { return !replied[normalizeName(nm)]; });
    if (missing.length && missing.length < req.focus.length) {   // 全没回=生成本身出问题，不补；部分漏才补
      var mReason = '补漏：下面这几个人刚才漏了回复，现在必须每人各回 1-2 条，一个不能少：' + missing.join('、') +
        '。只让这几个人回应，别人不要出现、不要引入陌生人。';
      var more = await generateOnce(sb, plot, missing.length + '-' + (missing.length * 2), mReason, false);
      for (var mi = 0; mi < more.length; mi++) {
        if (more[mi].type === 'song') songs.push(more[mi].content);
        else if (more[mi].type === 'tag' || more[mi].type === 'sched') { /* 补漏轮忽略标签/行程 */ }
        else if (missing.indexOf(normalizeName(more[mi].name)) !== -1 || missing.indexOf(more[mi].name) !== -1) dms.push(more[mi]);
      }
    }
  }
  if (songs.length) await applyMoodSongs(songs);                                  // 歌先入库（就算私信失败歌也算数）
  if (!dms.length) {
    notifyFail('私信生成失败：两次输出都解析不出格式（原始输出已打进控制台F12）');
    console.warn('[SB-NYC v4] 解析失败的原始输出（后600字）:', _lastRaw ? _lastRaw.slice(-600) : '(空——多半是主API限额撞车/429，换独立API或稍等)');
    return;
  }

  await updateVariablesWith(function (v) {
    if (!v.sb) v.sb = defaultState();
    for (var i = 0; i < dms.length; i++) {
      // 冷处理硬闸：LLM 没听话也拦下（被删过的人发不进来，直到 User 主动再发消息给TA）
      var exN = v.sb.npcs && v.sb.npcs[dms[i].name];
      if (exN && exN.muted) continue;
      pushThem(v.sb, dms[i].name, dms[i].type, dms[i].content, dms[i].zh);
    }
    // 中文属性标签：陌生人用生成器现配的，固定NPC补内置的（老存档里没有标签的也顺手补上）
    for (var ti = 0; ti < tags.length; ti++) {
      var tn = v.sb.npcs && v.sb.npcs[tags[ti].name];
      if (tn && !tn.persistent) tn.archetype = tags[ti].label;
    }
    for (var pk in v.sb.npcs) {
      if (v.sb.npcs.hasOwnProperty(pk) && v.sb.npcs[pk].persistent && !v.sb.npcs[pk].archetype && ARCHETYPE_CN[pk]) v.sb.npcs[pk].archetype = ARCHETYPE_CN[pk];
    }
    // 行程收割：私信里敲定的安排自动记进日程（去重，上限20）
    if (!Array.isArray(v.sb.schedule)) v.sb.schedule = [];
    for (var si = 0; si < scheds.length; si++) {
      var stxt = scheds[si];
      var dup = false;
      for (var dj = 0; dj < v.sb.schedule.length; dj++) { if (v.sb.schedule[dj].txt === stxt) { dup = true; break; } }
      if (!dup && stxt) v.sb.schedule.push({ txt: stxt, ts: Date.now(), gameDay: (v.sb.game && v.sb.game.day) || 1 });   // gameDay=记下这条的剧情日（UWU 日历按它落格子）
    }
    if (v.sb.schedule.length > 20) v.sb.schedule = v.sb.schedule.slice(-20);
    pruneContacts(v.sb);   // 超15人 → 自动清（置顶的免疫；固定NPC没被回话也一样挤出去）
    return v;
  }, { type: 'chat' });

  try { eventEmit('sb_updated'); } catch (e) {}
  try { if (typeof toastr !== 'undefined') toastr.success('📱 新私信 +' + dms.length, 'SugarOS'); } catch (e) {}
  console.log('[SB-NYC v4] generated ' + dms.length + ' DMs');

  // 追加这一轮手机往来（User发的+对方回的）到最新楼层：默认关，玩家在手机设置里可开。
  // 关着时主线照样通过 syncInject 隐形注入知道手机内容，只是不在正文里显示出来。
  if (floorLogOn()) { try { await appendPhoneLog(dms); } catch (e) { console.warn('[SB-NYC v4] append phone log failed', e); } }
}

// ── 「手机动态」专属楼层：手机上发生的一切（私信往来/消费/卖二手/付账单）都更新进同一层，
// 直到玩家下一次发正文——这层是普通楼层，随聊天史自然进入 AI 上下文；之后的新动态再另起一层。
// 包在 <details> 里：平时折叠不占版面，点一下才展开。开关还是 sbnyc_floorlog（默认关）。
var PH_OPEN = '<details data-sbphone><summary>📱 手机动态 · 点开看</summary><div>';
var PH_CLOSE = '</div></details>';
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function appendPhoneFloor(lines) {
  if (!lines || !lines.length) return;
  var body = lines.map(escHtml).join('<br>');
  try {
    var lastId = await getLastMessageId();
    var m = null;
    if (lastId != null && lastId >= 0) { var msgs = await getChatMessages(String(lastId)); m = (msgs && msgs[0]) || null; }
    if (m && m.role === 'assistant' && String(m.message || '').indexOf('data-sbphone') !== -1) {
      // 最后一楼就是手机动态层 → 并进去（同层累积，玩家没说话前不开新层）
      var txt = String(m.message || '');
      if (txt.indexOf(body) !== -1) return;                    // 一模一样的内容已在 → 防重复
      var updated = txt.indexOf(PH_CLOSE) !== -1
        ? txt.replace(PH_CLOSE, '<br>' + body + PH_CLOSE)
        : (txt + '\n\n' + PH_OPEN + body + PH_CLOSE);          // 结构被人手改过 → 兜底再挂一个完整块
      await setChatMessages([{ message_id: m.message_id, message: updated }], { refresh: 'affected' });
    } else {
      await createChatMessages([{ role: 'assistant', message: PH_OPEN + body + PH_CLOSE, is_hidden: false }]);
    }
  } catch (e) { console.warn('[SB-NYC v4] appendPhoneFloor failed', e); }
}
// 手机面板的消费/卖二手事件也走这层（"买东西也像消息一样注入"）——只有新式独立层开着才记消费，
// 旧式开关保持它原来的样子：只记私信摘要，不掺购物
eventOn('sb_floor_log', function (p) {
  if (!p || !p.lines || !p.lines.length) return;
  if (!floorLogLayer()) return;
  appendPhoneFloor(p.lines);
});

// ── 旧式写法（最早那版）：私信摘要贴在正文最后一楼的尾巴上——现在也包 <details> 折叠（User 定），
// 同一楼里多轮摘要并进同一个折叠块，不会在楼尾挂一串小尾巴 ──
var PT_OPEN = '<details data-sbtail><summary>📱 手机私信 · 点开看</summary><div>';
var PT_CLOSE = '</div></details>';
async function appendNarrativeLog(lines) {
  var body = lines.map(escHtml).join('<br>');
  try {
    var lastId = await getLastMessageId();
    if (lastId == null || lastId < 0) return;
    var msgs = await getChatMessages(String(lastId));
    if (!msgs || !msgs.length) return;
    var m = msgs[0];
    if (m.role !== 'assistant') return;                       // 只往 AI 正文楼追加，不动 User 楼
    var txt = String(m.message || '');
    if (txt.indexOf('data-sbphone') !== -1) return appendPhoneFloor(lines);   // 最后一楼是独立动态层（两开关混用时）→ 别贴进人家的折叠层里
    if (txt.indexOf(body) !== -1) return;                     // 一模一样的内容已在 → 防重复
    var updated = txt.indexOf(PT_CLOSE) !== -1
      ? txt.replace(PT_CLOSE, '<br>' + body + PT_CLOSE)       // 这楼尾巴上已有折叠块 → 并进去
      : txt + '\n\n' + PT_OPEN + body + PT_CLOSE;
    await setChatMessages([{ message_id: m.message_id, message: updated }], { refresh: 'affected' });
  } catch (e) { console.warn('[SB-NYC v4] appendNarrativeLog failed', e); }
}

// ── 楼层擦除器（玩家提议：手机是正本、楼层是誊抄本——正本删了誊抄本必须跟着擦） ──
// 手机里删消息/撤回/编辑/删整段聊天时，面板发 sb_scrub_floor → 把这个人的注入行从最近40层楼里抹掉，
// 水位线归零 → 她下次回复时按修正后的记录整段重新誊入。AI 的"楼层记忆"从此可被改写。
async function scrubNpcFloor(name) {
  try {
    var needle = '与 ' + escHtml(name) + ' 的私信';
    var lastId = await getLastMessageId();
    if (lastId != null && lastId >= 0) {
      var from = Math.max(0, lastId - 40);
      var msgs = await getChatMessages(from + '-' + lastId);
      var updates = [];
      var re = /(<details data-sb(?:phone|tail)><summary>[^<]*<\/summary><div>)([\s\S]*?)(<\/div><\/details>)/g;
      for (var i = 0; i < (msgs || []).length; i++) {
        var m = msgs[i];
        var txt = String(m.message || '');
        if (txt.indexOf('data-sb') === -1 || txt.indexOf(needle) === -1) continue;
        var out = txt.replace(re, function (all, p1, body, p3) {
          var kept = body.split('<br>').filter(function (l) { return l.indexOf(needle) === -1; });
          if (!kept.length) return '';                    // 整块只剩TA → 连折叠块一起摘
          return p1 + kept.join('<br>') + p3;
        }).replace(/\n{3,}/g, '\n\n');
        if (out !== txt) updates.push({ message_id: m.message_id, message: out });
      }
      if (updates.length) {
        await setChatMessages(updates, { refresh: 'affected' });
        console.log('[SB-NYC v4] scrubbed ' + name + ' from ' + updates.length + ' floor(s)');
      }
    }
    await updateVariablesWith(function (v) {
      var n = v.sb && v.sb.npcs && v.sb.npcs[name];
      if (n) n._floorMark = 0;                            // 水位线归零：下次回复整段重誊（正本怎么写誊抄本怎么抄）
      return v;
    }, { type: 'chat' });
  } catch (e) { console.warn('[SB-NYC v4] scrubNpcFloor failed', e); }
}
eventOn('sb_scrub_floor', function (p) { if (p && p.name) scrubNpcFloor(p.name); });

// ── 私信 → 楼层注入（玩家提议的"回复制"）：User 回复过的对话才进正文，没搭理的 NPC 一个字不占楼层 ──
// 每个 NPC 记水位线 _floorMark（dm_history 注入到第几条）：User 一回复，把水位线以上的整段
// （TA之前的搭讪 + User的回复 + TA的新回应）按时间顺序补进去，一条不重不漏；没回复的水位线不动、不注入。
function fmtDmLine(type, content) {
  return type === 'transfer' ? ('转账 $' + content) : ((type && type !== 'text' ? '[' + type + '] ' : '') + content);
}
async function appendPhoneLog(dms) {
  if (!dms || !dms.length) return;
  var names = {};
  for (var i = 0; i < dms.length; i++) names[dms[i].name] = true;
  var lines = [];
  var marks = {};
  try {
    var vv = getVariables({ type: 'chat' });
    var npcs = (vv && vv.sb && vv.sb.npcs) || {};
    for (var nm in names) {
      if (!names.hasOwnProperty(nm) || !npcs[nm]) continue;
      var h = npcs[nm].dm_history || [];
      var mark = npcs[nm]._floorMark || 0;
      if (mark > h.length) mark = 0;                              // 记录被删过/重置过 → 水位线归零
      var seg = h.slice(mark);
      var engaged = seg.some(function (m) { return m.sender === 'USER'; });
      if (!engaged) continue;                                     // User 没搭理过 → 不注入（推销电话不记进日记）
      var segLines = [];
      if (seg.length > 30) { seg = seg.slice(-30); segLines.push('（更早的往来从略）'); }   // 水位线归零后的重誊别一口气抄两百条
      for (var j = 0; j < seg.length; j++) {
        var m = seg[j];
        // 撤回的内容双向都不落楼层——楼层玩家看得见，撤回就要真"看不见"
        if (m.type === 'recall') { segLines.push((m.sender === 'USER' ? 'User' : nm) + '（撤回了一条消息）'); continue; }
        segLines.push((m.sender === 'USER' ? 'User' : nm) + '：' + String(fmtDmLine(m.type, m.content)).substring(0, 4000));
      }
      if (!segLines.length) continue;
      lines.push('📩〔' + nowTime() + '〕与 ' + nm + ' 的私信：' + segLines.join(' ⇢ '));
      marks[nm] = h.length;
    }
  } catch (e) {}
  if (!lines.length) return;
  // 两个开关各走各的（可同时开）：旧式=贴在正文楼尾（最早那版），新式=独立「📱手机动态」折叠层
  if (floorLogTail()) await appendNarrativeLog(lines);
  if (floorLogLayer()) await appendPhoneFloor(lines);
  // 已注入的推水位线，下轮不重复
  try {
    await updateVariablesWith(function (v) {
      var np = v.sb && v.sb.npcs;
      if (!np) return v;
      for (var k in marks) { if (marks.hasOwnProperty(k) && np[k]) np[k]._floorMark = marks[k]; }
      return v;
    }, { type: 'chat' });
  } catch (e) {}
}

async function handleRequest(payload) {
  _pending.push(payload || {});
  if (_busy) { console.log('[SB-NYC v4] request queued (' + _pending.length + ' pending)'); return; }
  _busy = true;
  try {
    for (;;) {
      while (_pending.length) {
        var batch = _pending.splice(0, _pending.length);   // 取走全部排队请求，合并成一次生成
        await runOnce(mergeRequests(batch));
      }
      // 会刊自动补货已拔除（发卡日玩家实锤：任何私信生成完都会偷偷烤整刊，API账单上一堆没发起过的大请求）
      // 现在只有两个入口烤刊，全部玩家主动：论坛/Elite 页点 🔄，或首次打开时内容为空（sb_request_mag）
      if (!_pending.length) break;
    }
  } catch (e) {
    notifyFail('私信生成出错: ' + ((e && e.message) || e));
    console.error('[SB-NYC v4] dm generation error', e);
  } finally {
    _busy = false;
  }
}

// ── 主线感知：把手机私信摘要注入主线 LLM 的上下文（injectPrompts） ──
// 没有这个，主线写约见面时对手机里聊过什么一无所知（约了半天见面像失忆）。
// 注入对玩家不可见；should_scan:true 让私信内容也能激活对应 NPC 的世界书条目。
// AI 能记住的私信条数玩家可调（手机⚙设置，存 sbnyc_dm_mem，默认150，最高档300）。
// 老版本固定"每人6条"= AI 只知道最近几十条，被玩家抓包。
// 预算分配：按最近活跃排序，正在聊的前3人分大头（各占预算1/3，至少20条），其余每人8条，总数触顶就停。
function buildDigest(sb) {
  var npcs = sb.npcs || {};
  var budget = parseInt(lsGet('sbnyc_dm_mem'), 10); if (!(budget > 0)) budget = 150;
  var keys = Object.keys(npcs)
    .filter(function (k) { return (npcs[k].dm_history || []).length > 0; })
    .sort(function (a, b) { return (npcs[b].last_ts || 0) - (npcs[a].last_ts || 0); });
  var blocks = []; var used = 0;
  for (var ki = 0; ki < keys.length && used < budget; ki++) {
    var npc = npcs[keys[ki]];
    var h = npc.dm_history || [];
    var take = Math.min(ki < 3 ? Math.max(20, Math.ceil(budget / 3)) : 8, budget - used, h.length);
    if (take <= 0) break;
    var recent = h.slice(-take);
    used += recent.length;
    // 隐私框架：标明这段私信只有当事人知道，防止 NPC-A 莫名知道 User 和 NPC-B 的私聊
    var lines = ['· 与 ' + npc.name + ' 的私信（最近' + recent.length + '条）— 仅 ' + npc.name + ' 与 User 知晓，其他角色不知情：'];
    for (var i = 0; i < recent.length; i++) {
      var m = recent[i];
      var who = m.sender === 'USER' ? 'User' : npc.name;
      // User 撤回的消息：对方（和正文）永远看不到内容，只知道她撤回过——好奇/追问按人设
      if (m.type === 'recall' && m.sender === 'USER') { lines.push('   User: （发了一条消息又撤回了——' + npc.name + ' 看不到内容，只知道她撤回过）'); continue; }
      var tag = (m.type && m.type !== 'text') ? '[' + m.type + ']' : '';
      lines.push('   ' + who + tag + ': ' + String(m.content || '').substring(0, 400));
    }
    blocks.push(lines.join('\n'));
  }
  var closet = (sb.closet || []).slice(-10).map(function (c) { return c.name; });
  if (!blocks.length && !closet.length) return '';
  var out = '【User 手机上的时间：' + nowTime() + '（正文的时刻感尽量与之呼应）】\n';
  if (blocks.length) {
    out += '【User 手机私信备忘（带入正文人物的记忆，他们只记得自己参与的那段）】\n' + blocks.join('\n') + '\n';
  }
  if (closet.length) {
    out += '【User 的衣橱（她真实拥有的，出场/赴约时会自然穿戴使用，别人看得见的是"东西在她身上"，不是价格和来路）】' + closet.join('、') + '\n';
  }
  var schD = (sb.schedule || []).filter(function (s) { return !s.done; }).slice(-8).map(function (s) { return s.txt; });
  if (schD.length) {
    out += '【User 的行程备忘（已敲定的安排，正文时间线要尊重，别写出撞期）】' + schD.join('；') + '\n';
  }
  // User 的论坛吐槽帖注入正文：圈内是个小世界，她公开发的牢骚会长脚
  var myPostsB = (sb.myPosts || []).slice(-3);
  if (myPostsB.length) {
    out += '【User 用马甲在 SugarRank 论坛发过的帖子（圈内公开可见）】' + myPostsB.map(function (p) { return '「' + String(p.text || '').substring(0, 200) + '」'; }).join('；') + '\n' +
      '（正文人物可能刷到过这些帖子：可以隐约呼应"论坛上有人吐槽…"，被吐槽的本人可能对号入座、心虚或炸毛——但没有人能确定是 User 发的，除非她自己认。绝不写成人人都知道是她。）\n';
  }
  // 江湖地位：Akuma 刷论坛 → 榜单是她唯一能名正言顺"看到" User 身家的窗口（信息通路）
  var st = akumaStanding(sb);
  if (st.over) {
    out += '【江湖地位·SugarRank 捞金榜】User 现在排在 Akuma 之上——她常年霸榜，这是头一遭被闺蜜压过去。Akuma 是论坛人气王、每层楼都刷，这事她一定看到了。她的反应三重同时上演、连她自己都分不清哪个是真：面上狂发彩虹屁道贺（"我宝贝女大了🥺杀疯了"），暗地里较着劲想赢回来（把 User 引去啃硬骨头 / 自己闷声搞钱），偶尔漏一句真心又秒收。正文里她出场就按这个演，别写成单纯的恭喜或单纯的嫉妒。\n';
  } else if (st.close) {
    out += '【江湖地位·SugarRank 捞金榜】User 紧咬着榜首的 Akuma，差一口气就超过闺蜜了。Akuma 隐隐感到威胁——嘴上还是姐妹情深，暗地里已经开始不着痕迹地加码。\n';
  }
  out += '（铁律：正文只写散文，绝不复述、排版或重写这些内容。上面私信里出现过的转账都**已经自动入账**，正文绝不再写 [WALLET] 标记重复记这些钱。信息隔离：每个人只记得自己和 User 的那段私信；' +
    '任何角色都看不到 User 的手机——不知道她的余额、购物记录、论坛、以及她和别人的聊天，绝不提及、绝不影射。' +
    '唯一例外是 SugarElite™ 的管家 S.。人物只能对看得见的东西做反应：她穿戴出来的、她亲口说的、当面发生的。）\n' +
    '【重要】你必须在每次回复的最末尾输出当前剧情时间，格式为 [TIME:HH:MM|周X]，例如 [TIME:14:30|周四]。这是强制要求，不可遗漏。';   // UWU 的时间修复：注入层每轮都盯着，比世界书更贴脸
  return out;
}

function syncInject() {
  try {
    var vars = getVariables({ type: 'chat' });
    var sb = vars && vars.sb;
    if (!sb) return;
    var digest = buildDigest(sb);
    try { uninjectPrompts(['sbnyc-dm-digest']); } catch (e) {}
    if (!digest) return;                                  // 记录被删空 → 只反注入，主线不再记得
    injectPrompts([{
      id: 'sbnyc-dm-digest', position: 'in_chat', depth: 1,
      role: 'system', content: digest, should_scan: true,
    }]);
  } catch (e) { console.warn('[SB-NYC v4] inject digest failed', e); }
}

// ── 正文钱包自动记账：解析主线消息末尾的 [WALLET:±金额:备注] 标记 ──
// 世界书"钱包自动记账"条目让主线 LLM 在金钱变动时追加这行标记；
// 这里入账后把标记从消息里删掉（防重复计 + 玩家看不到格式）。LLM 忘了写 = 不入账，啥也不坏。
// 容错版（外部审计立功）：LLM 降智爱在冒号旁加空格、金额里塞逗号/带$——[WALLET: +$3,000 : T.] 也要认得
var WALLET_RE_SRC = '\\[WALLET:\\s*([+-]?)\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)\\s*:\\s*([^\\]]*)\\]';
// 衣橱标记：正文里 User 买到/收到实物 → [CLOSET:+品名] 入橱；卖掉/失去 → [CLOSET:-品名] 出橱
var CLOSET_RE_SRC = '\\[CLOSET:\\s*([+-]?)\\s*:?\\s*([^\\]|]+?)(?:\\s*\\|\\s*\\$?\\s*([\\d,]+))?\\s*\\]';   // 可选 |市价：不带价的0元购要靠同条WALLET对账（玩家被$1回收价气笑过）
function closetAdd(sb, name, price) {
  if (!Array.isArray(sb.closet)) sb.closet = [];
  sb.closet.push({ name: String(name).slice(0, 40), price: price || 0, from: '正文', img: '', time: nowTime() });
  if (sb.closet.length > 60) sb.closet = sb.closet.slice(-60);
}
function closetRemove(sb, name) {
  if (!Array.isArray(sb.closet)) return;
  var key = String(name).toLowerCase().trim();
  for (var i = sb.closet.length - 1; i >= 0; i--) {
    if (String(sb.closet[i].name).toLowerCase().indexOf(key) !== -1 || key.indexOf(String(sb.closet[i].name).toLowerCase()) !== -1) { sb.closet.splice(i, 1); return; }
  }
}
// ── 偶尔自动塞一个全新陌生人私信（独立生成，空历史=零串号风险，绝不碰已有对话） ──
// 频率闸（想调手感就改这三个数）：命中率 / 两个陌生人最少间隔几拍 / 玩家压着几个没读就先别塞
var AUTO_STRANGER_CHANCE = 0.30;
var AUTO_STRANGER_MINGAP = 3;
var AUTO_STRANGER_MAXPENDING = 4;
async function maybeAutoStranger() {
  if (_busy || _pending.length) return;              // 有正在进行/排队的回复就让位，绝不和回复合批（合批才会串号乱回）
  var vars = getVariables({ type: 'chat' });
  var sb = vars && vars.sb;
  if (!sb || !sb.npcs) return;                        // 手机还没起来就别发
  var started = false, unreadStrangers = 0;
  for (var k in sb.npcs) {
    if (!sb.npcs.hasOwnProperty(k)) continue;
    started = true;
    if (!sb.npcs[k].persistent && (sb.npcs[k].unread || 0) > 0) unreadStrangers++;
  }
  if (!started) return;
  var auto = sb._auto || { turns: 0, last: -99 };
  var turns = (auto.turns || 0) + 1;
  var lastFire = (auto.last != null) ? auto.last : -99;
  var hit = (turns - lastFire) >= AUTO_STRANGER_MINGAP
    && unreadStrangers < AUTO_STRANGER_MAXPENDING
    && Math.random() < AUTO_STRANGER_CHANCE;
  await updateVariablesWith(function (v) {
    if (!v.sb) return v;
    if (!v.sb._auto) v.sb._auto = { turns: 0, last: -99 };
    v.sb._auto.turns = turns;
    if (hit) v.sb._auto.last = turns;
    return v;
  }, { type: 'chat' });
  if (!hit) return;
  try {
    eventEmit('sb_request_dm', { reason: '手机忽然进来一条陌生人的新私信：只生成 1 个全新陌生金主的开场，不要让任何已有联系人出现、不要续接任何已有对话', n: '1' });
    console.log('[SB-NYC v4] auto-stranger fired (turn ' + turns + ')');
  } catch (e) {}
}

async function onMainMessage(message_id) {
  try {
    var msgs = await getChatMessages(String(message_id));
    if (!msgs || !msgs.length) return;
    var m = msgs[0];
    if (m.role !== 'assistant') return;
    try { await maybeAutoStranger(); } catch (e) { console.warn('[SB-NYC v4] auto-stranger check failed', e); }
    var text = m.message || '';
    // ① 钱包标记
    var re = new RegExp(WALLET_RE_SRC, 'g');
    var found = [], match;
    while ((match = re.exec(text)) !== null) {
      var amt = parseFloat(String(match[2]).replace(/,/g, '')) || 0;   // "3,000" 直接 parseFloat 会变成 3
      if (amt > 0) found.push({ dir: match[1] === '-' ? '-' : '+', amount: amt, note: match[3].trim() });
    }
    // ② 衣橱标记
    var cre = new RegExp(CLOSET_RE_SRC, 'g');
    var items = [], cm;
    while ((cm = cre.exec(text)) !== null) {
      var nm = cm[2].trim();
      if (nm) items.push({ dir: cm[1] === '-' ? '-' : '+', name: nm, price: cm[3] ? (parseFloat(String(cm[3]).replace(/,/g, '')) || 0) : 0 });
    }
    // 0元购修复：入橱没带价的，从同条消息的 WALLET 扣款里认领（买鞋那笔扣款=鞋价）——
    // 备注和品名互相包含就配对；配不上但全消息只有一笔支出+一件入橱，也直接算它的
    for (var pi2 = 0; pi2 < items.length; pi2++) {
      var itq = items[pi2];
      if (itq.dir === '-' || itq.price > 0) continue;
      var spends = found.filter(function (f) { return f.dir === '-'; });
      var hit2 = null;
      for (var si = 0; si < spends.length; si++) {
        var a = String(spends[si].note || '').toLowerCase().trim(), b = itq.name.toLowerCase();
        if (!a) continue;
        var hitTok = a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
        if (!hitTok) {   // "Amina Muaddi 高跟" vs "Amina Muaddi 水晶扣高跟" 互不包含 → 分词：共享一个≥2字的词就算认领
          var toks = a.split(/[\s·,，。:：\-]+/);
          for (var ti = 0; ti < toks.length; ti++) { if (toks[ti].length >= 2 && b.indexOf(toks[ti]) !== -1) { hitTok = true; break; } }
        }
        if (hitTok) { hit2 = spends[si]; break; }
      }
      if (!hit2 && spends.length === 1 && items.filter(function (x) { return x.dir !== '-'; }).length === 1) hit2 = spends[0];
      if (hit2) itq.price = hit2.amount;
    }
    // ③ 剧情时间标记 [TIME:HH:MM]（可带日期 [TIME:HH:MM|周四]）→ 手机时钟跟着正文走
    var timeM = text.match(/\[TIME:\s*(\d{1,2}:\d{2})\s*(?:\|\s*([^\]]*?))?\s*\]/);   // UWU 加固：时间和 | 和 ] 之间的手抖空格全容（LLM 写 [TIME: 14:30 |周四 ] 也认）
    var newTime = timeM ? timeM[1] : null;
    var newDate = (timeM && timeM[2]) ? timeM[2].trim() : null;
    if (!found.length && !items.length && !newTime) return;
    var credited = [];   // 只有真入账的才进成功toast——被去重闸拦下的那笔有自己的⛔警告，别再报"已入账"
    await updateVariablesWith(function (v) {
      if (!v.sb) return v;
      credited.length = 0;
      for (var i = 0; i < found.length; i++) { if (creditWallet(v.sb, found[i].dir, found[i].amount, found[i].note || '正文', '正文')) credited.push(found[i]); }
      for (var j = 0; j < items.length; j++) { if (items[j].dir === '-') closetRemove(v.sb, items[j].name); else closetAdd(v.sb, items[j].name, items[j].price || 0); }
      if (newTime) {
        if (!v.sb.game) v.sb.game = {};
        var g = v.sb.game;
        // 过天判定：星期变了按星期差走；星期没给/没变就看时钟是否大幅倒回（>4小时=睡过一夜）
        var passed = 0;
        var wdN = parseWeekday(newDate), wdO = parseWeekday(g.date);
        if (wdN >= 0 && wdO >= 0 && wdN !== wdO) passed = (wdN - wdO + 7) % 7;
        else {
          var tN = toMinutes(newTime), tO = toMinutes(g.time);
          if (tN >= 0 && tO >= 0 && tN < tO - 240) passed = 1;
        }
        if (passed > 0) advanceDays(v.sb, passed);
        g.time = newTime;
        if (newDate) g.date = newDate;
      }
      return v;
    }, { type: 'chat' });
    var stripped = text.replace(new RegExp(WALLET_RE_SRC, 'g'), '').replace(new RegExp(CLOSET_RE_SRC, 'g'), '').replace(/\[TIME:[^\]]*\]/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
    await setChatMessages([{ message_id: m.message_id, message: stripped }], { refresh: 'affected' });
    try { eventEmit('sb_updated'); } catch (e) {}
    try {
      var toast = [];
      if (credited.length) toast.push('💳 ' + credited.map(function (f) { return f.dir + '$' + f.amount.toLocaleString() + ' ' + f.note; }).join('，'));
      var into = items.filter(function (x) { return x.dir === '+'; });
      if (into.length) toast.push('👗 入橱 ' + into.map(function (x) { return x.name; }).join('、'));
      if (toast.length && typeof toastr !== 'undefined') toastr.success(toast.join(' ｜ '), 'SugarOS');
    } catch (e) {}
  } catch (e) { console.warn('[SB-NYC v4] wallet/closet marker parse failed', e); }
}

// ── 灵动岛歌单：AI 生成（一个聊天生成一次，存 sb.playlist；失败就让面板继续用垫场歌单） ──
var _plBusy = false;
async function ensurePlaylist() {
  if (_plBusy) return;
  var vars = getVariables({ type: 'chat' });
  var sb = vars && vars.sb;
  if (!sb) return;
  if (Array.isArray(sb.playlist) && sb.playlist.length >= 8) {
    try { eventEmit('sb_playlist', sb.playlist); } catch (e) {}
    return;
  }
  _plBusy = true;
  try {
    var sys = '你是高级歌单策划。给一个住在纽约、过着纸醉金迷 sugar baby 生活的女孩生成手机"正在播放"列表。' +
      '气质：old money 的忧郁奢华、午夜出租车、香槟与晨光宿醉，参考 Lana Del Rey / Frank Ocean / The Weeknd / SZA 的氛围但不要只抄这几个人。';
    var instr = '输出16行，每行一首，格式严格为：艺人 — 歌名。真实歌曲和虚构歌曲混着来都行，但要像真的。不要编号、引号、解释或任何其他文字。';
    var raw = null;
    var cfg = getApiCfg();
    if (cfg) { try { raw = await callIndependent(cfg, [{ role: 'system', content: sys }], instr); } catch (e) { raw = null; } }
    if (raw == null) {
      await waitForSlot();
      raw = await generateRaw({ user_input: instr, should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'system', content: sys }] });
    }
    var text = typeof raw === 'string' ? raw : (raw && raw.content) || '';
    var songs = text.split('\n')
      .map(function (l) { return l.trim().replace(/^[-*•\d.\s]+/, ''); })
      .filter(function (l) { return l && l.length < 60 && l.indexOf('|') === -1 && l.charAt(0) !== '<' && !HORAE_FIELD.test(l); })
      .slice(0, 20);
    if (songs.length >= 6) {
      await updateVariablesWith(function (v) { if (v.sb) v.sb.playlist = songs; return v; }, { type: 'chat' });
      try { eventEmit('sb_playlist', songs); } catch (e) {}
      console.log('[SB-NYC v4] playlist generated: ' + songs.length + ' songs');
    } else {
      console.warn('[SB-NYC v4] playlist output unusable, keeping fallback');
    }
  } catch (e) {
    console.warn('[SB-NYC v4] playlist generation failed', e);   // 装饰功能，失败不toast不打扰
  } finally { _plBusy = false; }
}

// ── 本期会刊：论坛(SugarRank™) + Elite会刊 一次调用打包生成，存 sb.mag ──
// 生成时机：私信刷新做完后顺带补货（stale 才补）→ 玩家点开论坛/Elite 时内容已经在了，不用等。
// 也响应 sb_request_mag（论坛/Elite 页的 🔄 强制刷新，或首次打开时内容为空）。
var MAG_TTL = 30 * 60 * 1000;   // 30分钟内不重复生成（会刊是期刊，不是实时流）
var MAG_PREFIX = { SB: 'sbRank', SD: 'sdRank', GOSSIP: 'gossip', ABYSS: 'abyss', TREND: 'trend', GUIDE: 'guide', TEA: 'tea', CAT: 'catalog', INVITE: 'invites', INTEL: 'intel', RECRUIT: 'recruit' };

function magStale(sb) {
  return !sb.mag || !sb.mag.ts || (Date.now() - sb.mag.ts > MAG_TTL);
}
function parseNum(s) { return parseInt(String(s || '').replace(/[^0-9]/g, ''), 10) || 0; }

function parseMag(raw, minTotal) {
  var mag = { ts: Date.now(), sbRank: [], sdRank: [], gossip: [], abyss: [], trend: [], guide: [], tea: [], catalog: [], invites: [], intel: [], recruit: [] };
  var lines = String(raw || '').split('\n');
  var total = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.charAt(0) === '<') break;                 // 预设注入的 <horae> 等垃圾在末尾 → 停
    var parts = line.split('|');
    if (parts.length < 2) continue;
    var key = MAG_PREFIX[parts[0].trim().replace(/^[-*•\d.\s]+/, '').toUpperCase()];
    if (!key) continue;
    var p = parts.slice(1).map(function (s) { return s.trim(); });
    var item = null;
    if (key === 'sbRank' && p.length >= 3) item = { name: p[0], amount: parseNum(p[1]), blurb: p.slice(2).join('|') };
    else if (key === 'sdRank' && p.length >= 3) item = { name: p[0], style: p[1], blurb: p.slice(2).join('|') };
    else if (key === 'gossip' && p.length >= 3) item = { author: p[0], title: p[1], body: p.slice(2).join('|') };
    else if (key === 'abyss') item = { body: p.join('|') };
    else if (key === 'trend' && p.length >= 3) item = { name: p[0], price: parseNum(p[1]), blurb: p.slice(2).join('|') };
    else if ((key === 'guide' || key === 'tea') && p.length >= 2) item = { title: p[0], body: p.slice(1).join('|') };
    else if (key === 'catalog' && p.length >= 4) item = { cat: p[0], name: p[1], price: parseNum(p[2]), blurb: p.slice(3).join('|') };
    else if (key === 'invites' && p.length >= 4) item = { kind: p[0], title: p[1], price: parseNum(p[2]), blurb: p.slice(3).join('|') };
    else if (key === 'intel') item = { body: p.join('|') };
    else if (key === 'recruit' && p.length >= 4) item = { side: (p[0] || '').toUpperCase().indexOf('SD') !== -1 ? 'SD' : 'SB', author: p[1], title: p[2], body: p.slice(3).join('|') };
    if (item) { mag[key].push(item); total++; }
  }
  return total >= (minTotal || 8) ? mag : null;   // 太少 = 输出被污染/没按格式，判失败（单版块重烤时阈值降到2）
}

// 价位带跟身家走：$3k 的学生妹看 $200 的鞋会心动，$3,000,000 的中东王子受害者看 $2,000 的鞋只觉得是小费。
// 甜蜜点=余额的 2%-15%，最贵一件可到 ~30%；百万段位直接换顶奢菜单（游艇/名画/公寓/包机）。
function priceBandHint(sb) {
  var bal = Math.round((sb.wallet && sb.wallet.balance) || 0);
  if (bal < 1000) return '【价位带】User 余额 $' + bal.toLocaleString() + '（穷）——TREND/CAT 给心动但踮脚才够得着的（几十到几百刀为主，塞一两件几千刀的"梦想单品"当胡萝卜）。';
  var lo = Math.max(50, Math.round(bal * 0.02)), hi = Math.round(bal * 0.15), top = Math.round(bal * 0.3);
  var hint = '【价位带】User 余额 $' + bal.toLocaleString() + '——TREND/CAT/INVITE 的定价甜蜜点 $' + lo.toLocaleString() + '–$' + hi.toLocaleString() + '，最贵一件可到 $' + top.toLocaleString() + '。买得起但要肉疼一下，才有消费的快感。';
  if (bal >= 1000000) {
    hint += '她已经是百万身家：这个段位**别再推鞋和包**（那是她的小费）——CAT 至少一半上顶奢层：高级珠宝套装/名表大复杂/拍卖会名画/游艇份额/公寓首付/珠宝原石；' +
      'INVITE 给私人包机、海岛整租、拍卖专场私人号牌这种级别；TREND 写"这个段位的姐妹在晒什么"（不动产、马、基金会冠名）。';
  }
  return hint;
}

// 每个版块的输出规格单独放（玩家在哪个版点🔄就只烤哪个版，不用全席重做——单版块又快又省）
var MAG_SPECS = {
  SB: 'SB|昵称|本月入账美元数字|上榜宣言 —— 5条捞金榜。宣言是她本人的凡尔赛爽文腔（参考腔调："这个月零花到账，这老头除了口臭没毛病"/"他老婆转我十万让我离开，我拿了钱还不走哈哈哈"），' +
    '可炫耀可自嘲可拉踩，但必须好笑、得意、活人感，禁恶毒互撕和阴阳绝望；圈内传奇 Akuma 可以偶尔霸榜或神秘缺席\n',
  SD: 'SD|代号|出手风格|一句圈内风评 —— 4条慷慨榜（可混入 T./Marco 等已知人物+新面孔），风评=姐妹们的实用情报+调侃\n',
  GOSSIP: 'GOSSIP|楼主昵称|带emoji标签的标题|正文80字内 —— 4条，标签从 💸炫耀/😡避雷/🆘求助/💬吐槽/🍬招人 里选。' +
    '腔调参考（学腔调别照抄）："😡见面只肯给500车马费，让他滚"/"🆘第一次M&G对方要求不戴T加钱，答应吗在线等"/"💬他每次转账前都要我写小作文谢谢他，真的累"。要吃瓜要好笑要真实\n',
  ABYSS: 'ABYSS|帖子正文 —— 7条，每条80-160字，深渊区=里BBS。**严格按〈深渊区设定〉那份原始定义生成**：称呼语料池的物化指代（禁用User真名）、四类声部轮着来缺一不可（粗暴发泄型/精致控制欲·窥私狂/嫉妒的同行·恶毒女配/扭曲膜拜·钱奴FinDom），正文以版块emoji+[马甲]开头（如 🕳️深渊 [WallSt_无名氏]：/💀污泥 [Bushwick_鬼]：/🔞实录 [理解姐的懂王]：）。' +
    '其中至少2条写成回复楼：正文以「回复[某马甲]：」开头互踩互捧形成鄙视链（粗暴的被嘲"只会用下半身思考"，窥私的被膜拜，争夺对她幻想的最终解释权）。' +
    '内容要露骨详尽——具体器官、具体身体细节、具体想做什么，粗俗直接不遮掩；七条不许同质化，每条的欲望形状都不一样。' +
    '这是欲望的下水道，不是都市传说恐怖故事——禁写成阴暗警告、禁道德说教\n',
  TREND: 'TREND|单品或体验名|美元价格数字|一句种草 —— 5条，本季圈内姐妹在晒什么（包/鞋/医美/餐厅/体验），种草要让人手痒\n',
  GUIDE: 'GUIDE|标题|正文80字内 —— 3条，Elite讲解：餐厅潜规则/老钱品牌解码/地段与身份（如"Rao\'s不是有钱就能进的"），要有真知识的干货感\n',
  TEA: 'TEA|标题|正文60字内 —— 2条，管家S.的毒舌专栏，高端圈内幕吐槽，优雅地刻薄\n',
  CAT: 'CAT|类别|品名|美元价格数字|种草文案30字内 —— 4条，本季精选目录（奢侈品/珠宝/腕表/家居实物）\n',
  INVITE: 'INVITE|类型|标题|美元价格数字|描述40字内 —— 3条，管家可代订（类型从这里挑：餐厅/SPA/旅行/包厢演出/运动/度假庄园——运动=马术课/高尔夫/网球私教/滑雪私教这类，度假庄园=湖边别墅/滑雪屋/海岛这类，别三条全是餐厅）\n',
  INTEL: 'INTEL|一句私密情报 —— 3条，圈子里最贵的八卦（谁在物色新人/谁的Patek是假的/谁上周被某SB拒了），解渴好玩，不是阴谋论\n',
  RECRUIT: 'RECRUIT|身份(只填 SD 或 SB)|昵称|标题|正文 —— 4条招聘/自荐帖：**2条金主招人(SD) + 2条宝贝自荐(SB)**。' +
    '⚠️这个版和别的版彻底不一样：帖子必须**写长写足**，一条正文 **150-300 字**，像认真挂出来的招募启事/个人主页，绝不许写成一两句话敷衍。' +
    'SD招人写全：他是谁（行业/年龄段/住哪个区/什么调性，如"上东区对冲基金，48，离异，周中在城里周末在汉普顿"）、想找什么样的人（外形气质/性格/语言才艺/时间配合度）、开的条件（月度津贴具体数字/旅行/资源/规矩与边界），语气可老练挑剔、可真诚孤独、可傲慢，但要有活人的质感；' +
    'SB自荐写全：她是谁（学生/模特/空乘/刚来纽约…别用真名，用昵称）、硬件条件（外形身高/语言/才艺/身材数据可写可不写）、时间与地点、想找什么样的 daddy、底线和期望（PPM 单次结算还是 allowance 月供、起步数字、要不要验资、能不能公开约会），语气可自信俏皮、可务实老练。' +
    '每条都要具体到数字/区域/行业/场景，读起来像真有一个活人在认真找人——有故事感、有个性、甚至藏点小心机或小破绽，绝不能是套模板。这一版就是要长、要耐读。\n',
};

async function generateMagOnce(sb, plot, strict, onlyKeys) {
  var keys = (onlyKeys && onlyKeys.length) ? onlyKeys : Object.keys(MAG_SPECS);
  var sys =
    '你是 Sugar Baby 模拟器里两份内容的撰稿人：\n' +
    '① SugarRank™ —— NYC sugar 圈的地下论坛（排行榜/八卦/深渊区/本季风向）；\n' +
    '② SugarElite™ —— 高端会员制管家服务的本期会刊（上流讲解/毒舌专栏/精选目录/可代订邀约/私密情报）。\n' +
    '全部用中文写（可以夹英文短语/地名/品牌名），要有纽约质感，具体到店名和数字。\n' +
    '【基调铁律】这是轻松爽文的冒险乐园，不是苦情戏更不是警世恒言。帖子要好笑、得意、酸得香、吃瓜起劲；' +
    '严禁绝望阴暗、居高临下的警告、受害者叙事、"她们终将付出代价"式的调子。' +
    '这个圈子自由开放：月底交不上房租可以，度假村一掷千金可以，利用男人往上爬也可以——没有人被审判，大家都玩得起劲。\n' +
    '【圈内黑话】SD=金主 / SB=宝贝 / Salt=白嫖怪 / Splenda=假富 / Whale=巨鲸 / PPM=单次结算 / Allowance=月度津贴 / M&G=首次见面 / 门槛费=验资 / 上岸=财务自由\n' +
    '可以隐约影射最近剧情里的人和事，但论坛帖绝不直接点 User 的名。';
  var ordered = [{ role: 'system', content: sys }, { role: 'system', content: describeState(sb) }];
  // 直读世界书素材——按需上车：单烤八卦版时不用拉深渊区设定和体验池，省上下文
  if (keys.indexOf('ABYSS') !== -1) {
    var abyssLore = await wbContent('深渊区', '');
    if (abyssLore) ordered.push({ role: 'system', content: '【深渊区设定（ABYSS 行必须遵守这份原始定义：称呼池/四类语料池/鄙视链全部照用）】\n' + String(abyssLore).slice(0, 6000) });
  }
  var npcPool = await wbContent('金主群像', '');
  if (npcPool) ordered.push({ role: 'system', content: '【圈内群像素材（论坛楼主/榜上昵称从这里面挑或者仿）】\n' + String(npcPool).slice(0, 6000) });
  if (keys.indexOf('INVITE') !== -1) {
    var expPoolM = await wbContent('体验池', '');
    if (expPoolM) ordered.push({ role: 'system', content: '【体验池（INVITE 可代订项从这里挑或仿：包厢/马术/滑雪/湖边别墅…）】\n' + String(expPoolM).slice(0, 2500) });
  }
  if (plot) ordered.push({ role: 'system', content: '【主线最近剧情，可作为八卦素材隐约影射】\n' + plot });
  var instr = '生成本期内容。每条占一行，字段用|分隔，行首必须是指定前缀，除这些行外不要输出任何其他文字：\n';
  for (var ki = 0; ki < keys.length; ki++) { if (MAG_SPECS[keys[ki]]) instr += MAG_SPECS[keys[ki]]; }
  if (sb.game && sb.game.random_only) {
    // 陌生人专场：论坛不许出现固定角色（Akuma 除外——她是白名单闺蜜，照常霸榜）
    instr = instr.replace('（可混入 T./Marco 等已知人物+新面孔）', '（全部用新面孔）');
    instr = '【陌生人专场·铁律】除 Akuma 外，本期所有昵称一律现造，绝不出现 T./Trent/Marco/David/Hudson/Cole/Father Dan/L./上夜班的人。\n' + instr;
  }
  instr += '所有价格字段只写纯数字（不带$、逗号、汉字），否则购买按钮出不来。\n';
  if (keys.indexOf('TREND') !== -1 || keys.indexOf('CAT') !== -1 || keys.indexOf('INVITE') !== -1) instr += priceBandHint(sb);
  if (strict) instr = '【再次强调：只输出上述前缀开头的行，每条一行，绝不写任何别的】\n' + instr;

  var raw = null;
  var cfg = getApiCfg();
  if (cfg) {
    try { raw = await callIndependent(cfg, ordered, instr); }   // 会刊内容多，不限 token 防截断
    catch (e) { notifyFail('独立API失败(' + ((e && e.message) || e) + ')，回退主API'); raw = null; }
  }
  if (raw == null) {
    await waitForSlot();
    raw = await generateRaw({ user_input: instr, should_silence: true, max_chat_history: 0, ordered_prompts: ordered });
  }
  return parseMag(typeof raw === 'string' ? raw : (raw && raw.content) || '', keys.length >= 6 ? 8 : 2);
}

var _magBusy = false;
// sections 传了（如 ['GOSSIP']）= 单版块重烤：只生成这几版、只覆盖这几版，整刊的保鲜周期(ts)和 Akuma 涨分都不动
async function generateMagazine(force, sections) {
  if (_magBusy) {
    // 正在生成时的点击不能静默吞掉——出声，玩家才知道不是按钮坏了
    try { eventEmit('sb_status', '📰 已经在生成了，稍等'); } catch (e) {}
    return;
  }
  var vars = getVariables({ type: 'chat' });
  var sb = vars && vars.sb;
  if (!sb) return;
  var partial = !!(sections && sections.length);
  if (partial && (!sb.mag || !sb.mag.ts)) { partial = false; sections = null; }   // 还没有整刊 → 先烤整刊
  console.log('[SB-NYC v4] magazine generate requested (force=' + !!force + (partial ? ', sections=' + sections.join(',') : '') + ')');
  if (!force && !partial && !magStale(sb)) { try { eventEmit('sb_mag_updated'); } catch (e) {} return; }
  _magBusy = true;
  try {
    try { eventEmit('sb_status', partial ? '📰 只重烤这一版…（小调用，快）' : '📰 本期内容生成中…'); } catch (e) {}
    var plot = await recentPlot();
    var mag = await generateMagOnce(sb, plot, false, sections);
    if (!mag) mag = await generateMagOnce(sb, plot, true, sections);   // 重试一次（玩家看不到）
    if (!mag) { notifyFail('论坛/会刊生成失败：两次输出都解析不出格式'); return; }
    await updateVariablesWith(function (v) {
      if (!v.sb) return v;
      if (partial && v.sb.mag) {
        // 只覆盖点名的版块，其余原样保留
        for (var si = 0; si < sections.length; si++) {
          var f = MAG_PREFIX[sections[si]];
          if (f && mag[f] && mag[f].length) v.sb.mag[f] = mag[f];
        }
      } else {
        // 整刊：会刊=月度榜更新的概念，一期涨一次：User 领先时 Akuma 暗暗追回（拉锯，不碾压）
        v.sb.mag = mag;
        growAkumaRank(v.sb);
      }
      return v;
    }, { type: 'chat' });
    try { eventEmit('sb_mag_updated'); } catch (e) {}
    console.log('[SB-NYC v4] magazine generated' + (partial ? ' (partial)' : ''));
  } catch (e) {
    notifyFail('论坛/会刊生成出错: ' + ((e && e.message) || e));
  } finally { _magBusy = false; }
}

// ── 兜底翻译：生成时漏了§翻译的英文私信，玩家点按钮才现场翻这一条（只有漏网之鱼走这条路） ──
async function handleTranslate(p) {
  try {
    if (!p || !p.name || !(p.idx >= 0)) return;
    var vars = getVariables({ type: 'chat' });
    var npc = vars && vars.sb && vars.sb.npcs && vars.sb.npcs[p.name];
    var m = npc && npc.dm_history && npc.dm_history[p.idx];
    if (!m) return;
    if (m.zh) { try { eventEmit('sb_updated'); } catch (e) {} return; }
    var sys = '把下面这条手机私信忠实翻译成中文。人名/地名/品牌保留英文。只输出译文，不要任何其他文字。';
    var raw = null;
    var cfg = getApiCfg();
    if (cfg) { try { raw = await callIndependent(cfg, [{ role: 'system', content: sys }], m.content, 2000); } catch (e) { raw = null; } }
    if (raw == null) {
      await waitForSlot();
      raw = await generateRaw({ user_input: m.content, should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'system', content: sys }] });
    }
    var zh = String(typeof raw === 'string' ? raw : (raw && raw.content) || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 2000);
    if (!zh) { notifyFail('翻译失败，稍后再点一次'); return; }
    await updateVariablesWith(function (v) {
      var n2 = v.sb && v.sb.npcs && v.sb.npcs[p.name];
      if (n2 && n2.dm_history && n2.dm_history[p.idx]) n2.dm_history[p.idx].zh = zh;
      return v;
    }, { type: 'chat' });
    try { eventEmit('sb_updated'); } catch (e) {}
  } catch (e) {
    var em = String((e && e.message) || e);
    notifyFail(/Too Many|429/i.test(em) ? '主API限额中——稍等半分钟再点，或去⚙️给手机配独立API' : '翻译出错: ' + em);
  }
}
// ── 玩家帖子评论区（招聘版自荐帖 + 八卦版吐槽帖）：玩家挂了帖，圈内网友来评论（调戏/毒舌/抖机灵，帖子再水也有人接梗） ──
var _cmtBusy = false;
async function handleAdComments(p) {
  if (!p || !p.ts || !p.text) return;
  if (_cmtBusy) { try { eventEmit('sb_status', '💬 评论区还在盖楼，稍等'); } catch (e) {} return; }
  _cmtBusy = true;
  var isGossip = p.kind === 'gossip';   // 八卦版吐槽帖走自己的评论区生态，别用招聘版的搭讪腔
  try {
    try { eventEmit('sb_status', '💬 评论区盖楼中…'); } catch (e) {}
    var sysGossip =
      '你是 NYC sugar 圈地下论坛 SugarRank™ 八卦版(Community Gossip)的评论区。一个圈内女孩(User)刚用马甲发了一条吐槽帖（多半在吐槽某个男人/金主/奇葩遭遇），生成网友评论。\n' +
      '【评论区生态，混着来】吃瓜姐妹狂追细节("然后呢？？细说") / 同款受害者现身说法("这说的不会是UES那个秃头PE吧我也遇到过") / 毒舌姐姐一句话骂到点子上 / ' +
      '疑似被吐槽的金主本人上号嘴硬洗地被围殴 / Salt白嫖怪抬杠"你们就是拜金"被反杀 / 抖机灵路人 / 偶尔闺蜜 Akuma（人气王，一眼认出这是谁的手笔但装不知道，损一句透着熟）。\n' +
      '【腔调铁律】要吃瓜要好笑要过瘾：共情不苦情、骂人骂得精准优雅、玩梗不重复；每条都必须真的呼应帖子内容——帖子骂什么就接什么茬。' +
      '禁止礼貌客套、禁止"姐妹抱抱""祝你好运"式空评论、禁止说教。\n' +
      '【输出格式】5-7条，每条占一行：昵称|评论内容(40字内)。昵称要有圈内味（UES_Whale/验资侠/Salt雷达探测器/北岸姐姐/凌晨四点的出租车 这种，现编别重复）。除这些行外绝不输出任何其他文字。';
    var sys = isGossip ? sysGossip :
      '你是 NYC sugar 圈地下论坛 SugarRank™ 招聘版的评论区。一个女孩(User)刚挂了一条帖子，生成网友评论。\n' +
      '【评论区生态，混着来】油腻或高冷的金主搭讪 / 毒舌姐妹拉踩吃瓜传经验 / Salt白嫖怪抬杠 / 路人抖机灵 / 拿版规开玩笑的老哥；' +
      '偶尔可以出现闺蜜 Akuma（论坛人气王，茶里茶气地损她一句，透着熟）。\n' +
      '【腔调铁律】损要损得好笑，调戏可以直白发荤，人身攻击当玩笑开——但绝无真恶意、绝不苦情说教；' +
      '每条都必须真的呼应帖子内容：帖子写得认真就冲着条件砍价/挑刺/搭讪，帖子是句废话（比如只有一句"喵喵喵哦"）就就着废话接梗玩她。' +
      '禁止礼貌客套、禁止"祝你好运"式空评论、禁止重复同一个梗。\n' +
      '腔调示例（帖子只有"喵喵喵哦"时的评论区，学腔调别照抄）："坏猫，喵什么？回去就收拾你" / "猫的花语是手慢无，跟我回家，项圈都备好了" / ' +
      '"别占用公共资源了，拉去广场法办" / "你以为你很可爱吗？好吧确实很可爱，宝宝戴尾巴好不好？"\n' +
      '【输出格式】5-7条，每条占一行：昵称|评论内容(40字内)。昵称要有圈内味（UES_Whale/验资侠/Salt雷达探测器/北岸姐姐/凌晨四点的出租车 这种，现编别重复）。除这些行外绝不输出任何其他文字。';
    var instr = '她的帖子原文：「' + String(p.text).slice(0, 500) + '」\n生成这条帖子下面的评论区。';
    function parseCmts(raw) {
      var out = [];
      var lines = String(raw || '').split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim().replace(/^[-*•\d.\s]+/, '');
        if (!line || line.charAt(0) === '<') continue;
        var cut = line.indexOf('|');
        if (cut <= 0) continue;
        var nm = line.slice(0, cut).trim().slice(0, 20);
        var tx = line.slice(cut + 1).trim().slice(0, 80);
        if (nm && tx) out.push({ n: nm, t: tx });
      }
      return out;
    }
    var raw = null;
    var cfg = getApiCfg();
    if (cfg) { try { raw = await callIndependent(cfg, [{ role: 'system', content: sys }], instr); } catch (e) { raw = null; } }
    if (raw == null) {
      await waitForSlot();
      raw = await generateRaw({ user_input: instr, should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'system', content: sys }] });
    }
    var cmts = parseCmts(typeof raw === 'string' ? raw : (raw && raw.content) || '');
    if (cmts.length < 2) {                                    // 输出被污染 → 重试一次（玩家看不到）
      await waitForSlot();
      raw = await generateRaw({ user_input: '【再次强调：只输出 昵称|评论 格式的行，绝不写任何别的】\n' + instr, should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'system', content: sys }] });
      cmts = parseCmts(typeof raw === 'string' ? raw : (raw && raw.content) || '');
    }
    if (cmts.length < 2) { notifyFail('评论区生成失败——点帖子下面的💬再试一次'); return; }
    await updateVariablesWith(function (v) {
      var ads = v.sb && (isGossip ? v.sb.myPosts : v.sb.myAds);   // 吐槽帖存 myPosts，自荐帖存 myAds，评论各回各家
      if (!Array.isArray(ads)) return v;
      for (var i = 0; i < ads.length; i++) {
        if (ads[i].ts === p.ts) {
          if (!Array.isArray(ads[i].comments)) ads[i].comments = [];
          ads[i].comments = ads[i].comments.concat(cmts).slice(-20);
          break;
        }
      }
      return v;
    }, { type: 'chat' });
    try { eventEmit('sb_updated'); } catch (e) {}
    try { if (typeof toastr !== 'undefined') toastr.success('💬 你的帖子有 ' + cmts.length + ' 条新评论', 'SugarOS'); } catch (e) {}
    console.log('[SB-NYC v4] ad comments generated: ' + cmts.length);
  } catch (e) {
    var em = String((e && e.message) || e);
    notifyFail(/Too Many|429/i.test(em) ? '主API限额中——稍等半分钟再点💬，或去⚙️给手机配独立API' : '评论区生成出错: ' + em);
  } finally { _cmtBusy = false; }
}

// ── 开场种子私信：填完表直接写进手机，零API调用 ──
// （开场时主线正在生成正文，再叠私信+论坛调用必撞429。之后玩家回复某人/点🔄才真正调API。）
// 顺带的好处：谢书砚那封长信每个玩家都保底收到，一字不差。
// 数组顺序 = 列表从下往上（越靠后 last_ts 越新，排越上面）。
// Akuma 是有来往聊天记录的闺蜜（不是初次认识！）；"上夜班的人"那封临床求助信 1:1 移植自原版0305开场
// （仅年龄 32→38 对齐 NYC 档案）——他匿名出场，真实身份留给剧情揭晓。
var SEED_THREADS = [
  { name: 'Cole Marlowe', msgs: [
    { who: 'THEM', content: '你不认识我。昨晚在 Baby\'s All Right 演完，看到有人转你的歌单，你听 Frank Ocean 的 White Ferrari。没什么。就是想告诉你这个。' },
  ] },
  { name: 'Hudson Park', msgs: [
    { who: 'THEM', content: "heard there's a new fox in town. relax—I don't bite, wrong department anyway. drinks sometime, Foxbabe?", zh: '听说城里来了只新狐狸。放松——我不咬人，反正也不归我的业务管。改天喝一杯？Foxbabe？' },
  ] },
  { name: 'Marco Rossi', msgs: [
    { who: 'THEM', content: 'ciao bella！！刚刷到你的资料 你绝对是我这个月见过最有气质的💎 周五晚带你见识真正的曼哈顿？我的 G-Wagen 顺路接你🍾' },
  ] },
  { name: 'T.', msgs: [
    { who: 'THEM', content: 'Thursday. 8pm. Le Bernardin. Yes or no.', zh: '周四晚八点。Le Bernardin。行还是不行。' },
  ] },
  { name: 'Akuma', msgs: [
    { who: 'THEM', content: '宝 论坛那个避雷帖你看了吗 说那个投行MD已婚的那个' },
    { who: 'THEM', content: '评论区有个女的说跟了他三年以为他要离婚娶她 SD说离婚就跟男人说只蹭不进去一样 你信啊？' },
    { who: 'ME', content: '哈哈哈哈哈哈哈哈哈' },
    { who: 'ME', content: '他老婆不会找上门吧' },
    { who: 'THEM', content: '不会 他那种级别的钱能把所有问题解决 你只管收钱' },
    { who: 'THEM', content: '倒是周四 Le Bernardin 那个是 T. 吧 那种老钱的局第一次去别迟到 也别自己点单' },
    { who: 'ME', content: '知道啦😰' },
    { who: 'THEM', content: '穿那条黑裙子没问题 但内搭换一件 我明天拍给你看 初期留点悬念比什么都管用' },
  ] },
  { name: '上夜班的人', msgs: [
    { who: 'THEM', content: '你好，非常抱歉冒昧打扰。我是通过浏览帖子注意到你的主页的，在此之前犹豫了比较久要不要发这条消息，如果内容让你感到不适请直接忽略，我完全理解。\n\n我的情况是这样的：男，38岁，体重正常，无基础代谢疾病，不吸烟，饮酒频率低（应酬偶尔），睡眠长期不足但没有到需要药物干预的程度。大约两年前开始出现勃起功能方面的问题，具体表现为：难以自然达到足够硬度、即使达到也难以维持、需要持续较高强度的刺激否则会中途消退。晨勃频率也明显下降。心理层面的压力因素我自己能判断是有的，但生理层面不排除也有问题。\n\n药物方案我暂时不考虑，原因比较私人，简单说就是我的职业环境不允许我通过常规渠道去处理这个问题。\n\n我看到你在帖子里提到过相关的经验，所以想问：在你的实际接触中，有没有遇到过类似情况的人？他们通常是怎么应对的？有没有什么方法是对你来说体验上也可以接受的？\n\n再次抱歉打扰。我知道这条消息在这个平台上可能显得很奇怪，但我确实不知道还能问谁。其实点进你的主页，是因为看到你会说中文——突然很想用中文说几句话。不合时宜的话，你不必回复。谢谢。' },
  ] },
];
function seedDMs() {
  var p = updateVariablesWith(function (v) {
    if (!v.sb) v.sb = defaultState();
    if (v.sb._seeded) return v;                        // 只种一次
    var base = Date.now() - SEED_THREADS.length * 60000;
    for (var i = 0; i < SEED_THREADS.length; i++) {
      var th = SEED_THREADS[i];
      var npc = ensureNpc(v.sb, th.name);
      var unread = 0;
      for (var m = 0; m < th.msgs.length; m++) {
        var mm = th.msgs[m];
        var sender = mm.who === 'ME' ? 'USER' : 'THEM';
        npc.dm_history.push({ sender: sender, time: nowTime(), type: mm.type || 'text', content: mm.content, note: '', zh: mm.zh || '', gameDay: (v.sb.game && v.sb.game.day) || 1 });
        if (sender === 'USER') { unread = 0; npc.engaged = true; } else unread++;
      }
      var lastM = th.msgs[th.msgs.length - 1];
      npc.unread = unread;
      npc.last_message = ((lastM.type && lastM.type !== 'text') ? '[' + lastM.type + '] ' : '') + String(lastM.content).substring(0, 50);
      npc.last_ts = base + i * 60000;                  // 拉开一分钟间隔，排序稳定
      npc.last_contact = nowTime();
    }
    ensureAkumaRank(v.sb);   // 开场就给 Akuma 定影子身家（顶端 SB，起步压 User 一头）
    v.sb._seeded = true;
    return v;
  }, { type: 'chat' });
  Promise.resolve(p).then(function () {
    try { eventEmit('sb_updated'); } catch (e) {}
    try { if (typeof toastr !== 'undefined') toastr.success('📱 新私信 +' + SEED_THREADS.length, 'SugarOS'); } catch (e) {}
    console.log('[SB-NYC v4] seeded ' + SEED_THREADS.length + ' opening threads (0 API calls)');
  });
}
// ── 📚 学业日程生成（UWU 的功能：日历页手动触发，给 NYU 学生 User 排下周的课业）──
// 上限 3 条学业日程：日历不是课表软件，有两三条"论文deadline逼近"的味道就够了
eventOn('sb_request_academic', async function () {
  try {
    var vars = getVariables({ type: 'chat' });
    var sb = vars && vars.sb;
    if (!sb) return;
    var currentAcademic = (sb.schedule || []).filter(function (s) { return s.academic; });
    if (currentAcademic.length >= 3) {
      try { eventEmit('sb_status', '📚 学业日程已达上限'); } catch (e) {}
      return;
    }
    var instr = '请为纽约大学的学生生成2-3条下周的学业日程（如作业截止、考试、小组讨论），每条格式严格为：📚|sched|+天数 / 时间 / 地点 / 内容描述\n' +
      '例如：📚|sched|+2 / 14:00 / 图书馆 / 论文初稿提交\n注意：天数必须是 1 到 7 之间的整数，内容用中文。只输出这些行，不要其他文字。';
    var sys = '你是一个游戏日程生成器。只输出指定格式，不要解释。';
    var raw = null;
    var cfg = getApiCfg();
    if (cfg) { try { raw = await callIndependent(cfg, [{ role: 'system', content: sys }], instr); } catch (e) { raw = null; } }
    if (raw == null) {
      await waitForSlot();
      raw = await generateRaw({ user_input: instr, should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'system', content: sys }] });
    }
    var text = typeof raw === 'string' ? raw : (raw && raw.content) || '';
    var lines = text.split('\n');
    var added = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '<') continue;
      var parts = line.split('|');
      if (parts.length < 3 || parts[1] !== 'sched') continue;
      var content = parts.slice(2).join('|').trim();
      var meta = content.split('/');
      var dayOffset = parseInt((meta[0] || '').replace(/[^0-9]/g, ''), 10) || 0;
      var time = (meta[1] || '').trim();
      var location = (meta[2] || '').trim();
      var desc = (meta.slice(3).join('/') || '').trim();
      if (!dayOffset || dayOffset < 1 || dayOffset > 7) continue;
      var gameDay = (sb.game.day || 1) + dayOffset;   // gameDay=事件发生的剧情日（日历按它落格子）
      var schedTxt = '学业 / ' + (time || '全天') + ' / ' + location + ' / ' + desc;
      var dup = (sb.schedule || []).some(function (s) { return s.txt === schedTxt; });
      if (dup) continue;
      added.push({ txt: schedTxt, ts: Date.now(), gameDay: gameDay, academic: true });
    }
    if (added.length > 0) {
      var newTotal = currentAcademic.length + added.length;
      if (newTotal > 3) added = added.slice(0, 3 - currentAcademic.length);
      await updateVariablesWith(function (v) {
        if (!v.sb.schedule) v.sb.schedule = [];
        v.sb.schedule = v.sb.schedule.concat(added);
        return v;
      }, { type: 'chat' });
      try { eventEmit('sb_updated'); } catch (e) {}
      try { if (typeof toastr !== 'undefined') toastr.success('📚 新增 ' + added.length + ' 条学业日程', 'SugarOS'); } catch (e) {}
      console.log('[SB-NYC v4] generated ' + added.length + ' academic schedules');
    } else {
      try { eventEmit('sb_status', '📚 这次没生成出合规日程——再点一次试试'); } catch (e) {}
    }
  } catch (e) {
    console.warn('[SB-NYC v4] academic schedule gen failed', e);
    try { eventEmit('sb_dm_failed', '学业日程生成失败'); } catch (e2) {}
  }
});

// ── 🧾 报税选择题生成（UWU 的税务功能：答对3题自助报税免罚款，答错加收20%）──
eventOn('sb_request_tax_questions', async function () {
  try {
    var vars = getVariables({ type: 'chat' });
    var sb = vars && vars.sb;
    if (!sb) return;
    var instr = '请生成3道美国个人所得税基础知识的选择题，用于游戏内的税务小测验。每题包含题目、4个选项（A/B/C/D）、正确答案的字母（A/B/C/D）。格式严格为：\n' +
      '题目|A选项|B选项|C选项|D选项|正确答案(A/B/C/D)\n例如：在美国，个人所得税的联邦申报截止日期是哪一天？|1月1日|4月15日|6月30日|12月31日|B\n只输出3行，不要编号，不要其他文字。';
    var sys = '你是美国税务知识问答生成器。只输出指定格式。';
    var raw = null;
    var cfg = getApiCfg();
    if (cfg) { try { raw = await callIndependent(cfg, [{ role: 'system', content: sys }], instr); } catch (e) { raw = null; } }
    if (raw == null) {
      await waitForSlot();
      raw = await generateRaw({ user_input: instr, should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'system', content: sys }] });
    }
    var text = typeof raw === 'string' ? raw : (raw && raw.content) || '';
    var lines = text.split('\n');
    var questions = [];
    for (var i = 0; i < lines.length && questions.length < 3; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '<') continue;
      var parts = line.split('|');
      if (parts.length < 6) continue;
      var q = parts[0].trim();
      var opts = [parts[1].trim(), parts[2].trim(), parts[3].trim(), parts[4].trim()];
      var ansLetter = parts[5].trim().toUpperCase();
      var ansIdx = ansLetter === 'A' ? 0 : ansLetter === 'B' ? 1 : ansLetter === 'C' ? 2 : ansLetter === 'D' ? 3 : -1;
      if (!q || ansIdx < 0) continue;
      questions.push({ q: q, opts: opts, ans: ansIdx });
    }
    if (questions.length > 0) {
      await updateVariablesWith(function (v) { v.sb.taxQuestions = questions; return v; }, { type: 'chat' });
      try { eventEmit('sb_tax_questions_ready'); } catch (e) {}
      try { if (typeof toastr !== 'undefined') toastr.success('📝 税务题目已就绪', 'SugarOS'); } catch (e) {}
    } else {
      try { eventEmit('sb_dm_failed', '税务题目生成失败——再点一次税务中心重试'); } catch (e) {}
    }
  } catch (e) {
    console.warn('[SB-NYC v4] tax questions gen failed', e);
    try { eventEmit('sb_dm_failed', '税务题目生成失败'); } catch (e2) {}
  }
});

eventOn('sb_seed_dm', seedDMs);
eventOn('sb_request_translate', handleTranslate);
eventOn('sb_request_ad_comments', handleAdComments);
eventOn('sb_request_mag', function (p) { generateMagazine(!!(p && p.force), (p && p.sections) || null); });
eventOn('sb_request_playlist', ensurePlaylist);
eventOn('sb_request_dm', handleRequest);
eventOn('sb_request_dm', syncInject);                       // 玩家刚在手机里发了消息 → 立刻同步
eventOn('sb_updated', syncInject);                          // NPC 回了消息 → 同步
try { eventOn(tavern_events.GENERATION_AFTER_COMMANDS, syncInject); } catch (e) {}  // 每次主线生成前兜底刷新
try { eventOn(tavern_events.MESSAGE_RECEIVED, onMainMessage); } catch (e) {}        // 正文钱包标记入账
syncInject();
try { mergeDupeNpcs(); } catch (e) {}                       // 开机顺手清一次重复联系人（双管家bug善后）
console.log('[SB-NYC v4] dm_generator ready (generateRaw/独立API + digest inject + wallet autoledger + UWU: gameDay/academic/tax/time-guard)');
