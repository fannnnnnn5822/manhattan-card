// ═══════════════════════════════════════════════════════════════════
// 纸醉金迷 · 鎏金曼哈顿（Sugar Baby Simulator：NYC）© 2026 fannnnnnn（作者）
// 含 UWU 老师授权贡献（震动/壁纸/日历/流水税务/日期系统）。可读可学，
// 禁止直接搬运、改名、重新打包后公开发布；保留本署名。详见仓库 LICENSE。
// ═══════════════════════════════════════════════════════════════════
// SugarOS NYC v4 — 悬浮手机面板（脚本直挂版）
// 旧方案（正则把 ```html 手机塞进 AI 消息）已废弃：手机围栏和正文 markdown 同处一条消息，
// 渲染时被正文冲破，srcdoc 畸形、DOM 建不起来 → 永远空壳。
// 新方案：本脚本直接在酒馆主页面 (parent.document) 挂一个悬浮 📱 按钮 + 固定手机面板。
// 完全脱离聊天消息、不过 markdown 管线，主线 LLM 写什么都影响不到手机。
//
// 自包含：无 import、无 CDN、无 MVU。脚本作用域里酒馆助手 API 是全局的。

'use strict';

(function () {
  // ── iframe 沙箱铁律（PITFALLS_v3 #2）：脚本跑在 iframe 里，主页面在 parent ──
  var DOC = (typeof parent !== 'undefined' && parent.document) ? parent.document : document;

  // 私享版开关（build.py --personal 注入 PERSONAL_EDITION=true）：闺蜜群只在私享版出现
  var IS_PERSONAL = (typeof PERSONAL_EDITION !== 'undefined' && PERSONAL_EDITION);
  var GROUP_NAME = '🥂 闺蜜群';

  // ── API 包装（脚本作用域直接有全局，仍套 try/catch 防御） ──
  function toast(kind, msg) {
    try { if (typeof toastr !== 'undefined') toastr[kind](msg, 'SugarOS'); } catch (e) {}
    console.log('[SB-NYC phone] ' + msg);
  }
  function SBgetVars() {
    try { return getVariables({ type: 'chat' }) || {}; } catch (e) { return {}; }
  }
  // 写变量串行闸：updateVariablesWith 是"读→改→异步写"，两次调用贴太近时第二次可能读到第一次落账前的旧状态，
  // 把人家的写覆盖掉（理论上 debit扣款+紧跟的订阅/入橱两连写会丢扣款）。所有写排队过闸=后一笔永远等前一笔落账。
  var _updQ = Promise.resolve();
  function SBupdate(fn) {
    _updQ = _updQ.then(function () {
      return updateVariablesWith(fn, { type: 'chat' });
    }).catch(function (e) { toast('error', '写变量失败: ' + ((e && e.message) || e)); });
    return _updQ;
  }
  function SBon(ev, cb) { try { eventOn(ev, cb); } catch (e) {} }
  function SBemit(ev, data) {
    try { eventEmit(ev, data); } catch (e) { toast('error', '事件发送失败: ' + e.message); }
  }
  // 把文字填进正文输入框（不代发——玩家补充细节后自己发送，主线LLM接着写见面/体验剧情）
  // （旧的 injectEvent 隐形指令+自动触发已废弃：玩家看不见的"空消息生成"太诡异，User 拍板全部改走这条明路）
  function fillMainInput(text) {
    try {
      var ta = DOC.getElementById('send_textarea');
      if (!ta) { toast('warning', '找不到正文输入框'); return; }
      ta.value = text;
      try { ta.dispatchEvent(new VIEW.Event('input', { bubbles: true })); } catch (e) {}
      try { ta.focus(); } catch (e) {}
      toast('success', '✍️ 已填进正文输入框，补上时间地点再发送');
    } catch (e) { toast('error', '填入失败: ' + ((e && e.message) || e)); }
  }

  // ── 待发队列（outbox）：所有输入攒着，主屏一个发送键统一发给 AI —— 省 token + 符合"刷完手机才收到一波回复" ──
  // 持久化进聊天变量 sb._outbox：脚本重载/切聊天/主线出消息都不会把攒好的队列弄丢（否则再点发送=空队列没人回）
  function loadOutbox() { try { var v = SBgetVars(); return (v && v.sb && v.sb._outbox) ? v.sb._outbox : {}; } catch (e) { return {}; } }
  function saveOutbox(ob) { SBupdate(function (v) { if (v.sb) v.sb._outbox = ob; return v; }); }
  function outboxCount() { var ob = loadOutbox(), n = 0; for (var k in ob) { if (ob.hasOwnProperty(k)) n += ob[k].length; } return n; }
  function queueOutbox(name, line) {
    var ob = loadOutbox();
    if (!ob[name]) ob[name] = [];
    ob[name].push(line);
    saveOutbox(ob);
  }
  // 触发单个人回复（聊天页「发送」键）：把这人攒的消息一次性发出，别人不出现；发完从队列移除
  // 「正在输入…」气泡：生成期间显示在聊天窗口底部（灵动岛之外的第二处提示）；
  // 回复到了 sb_updated 会整页重渲染自然消失，失败时 sb_dm_failed 手动摘掉
  function showTyping(name) {
    if (currentChatName !== name) return;
    var box = chatEl.querySelector('.sb-msgs');
    if (!box || box.querySelector('.sb-typing')) return;
    box.insertAdjacentHTML('beforeend', '<div class="sb-msg them sb-typing">' + esc(name) + ' 正在输入…</div>');
    box.scrollTop = box.scrollHeight;
  }
  // 📌 黑话科普帖（论坛永久置顶 + 聊天栏🔗一键转发）：对面问"PPM是什么"这种蠢问题时甩过去让TA自己读
  var SLANG_TERMS = 'SD=金主 · SB=宝贝 · PPM=按次结算 · Allowance=月度津贴 · M&G=首次见面 · 验资=门槛费 · Salt=白嫖怪 · Splenda=假富 · Whale=巨鲸 · GFE=女友体验 · 上岸=财务自由';
  var SLANG_FORWARD = '🔗 [转发帖子]《SugarRank 置顶 · 黑话扫盲：进圈先读这篇》——' + SLANG_TERMS;
  // 列表预览统一入口（微信式）：自己发的带"你："前缀——一眼看出这个人回没回过，不会忘记自己回过没
  function lastPreview(m) {
    if (!m) return '';
    if (m.type === 'recall') return (m.sender === 'USER' ? '你：' : '') + '撤回了一条消息';
    return (m.sender === 'USER' ? '你：' : '') + ((m.type && m.type !== 'text') ? '[' + m.type + '] ' : '') + String(m.content || '').substring(0, 50);
  }
  function replyOne(name) {
    var ob = loadOutbox();
    var lines = ob[name] || [];
    if (!lines.length) { toast('info', '先说点什么再发送'); return; }
    var why = '玩家在私信里对 ' + name + ' 说了：' + lines.map(function (s) { return '「' + s + '」'; }).join('、') +
      '。只让 ' + name + ' 本人回应这些，别的角色不要出现、不要插话。';
    delete ob[name]; saveOutbox(ob);
    SBemit('sb_request_dm', { reason: why, n: '1-2' });
    setStatus('⏳ ' + name + ' 回复中…');
    showTyping(name);
  }
  // 🔄 重roll：删掉这人尾部一连串对方消息（本轮回复），基于上一句 User 的话重新单发生成
  function rerollLast(name) {
    var v0 = SBgetVars(); var npc0 = v0 && v0.sb && v0.sb.npcs && v0.sb.npcs[name];
    var hist0 = (npc0 && npc0.dm_history) || [];
    // 找最后一句 User 消息，它之后的 THEM 全删
    var lastUser = -1;
    for (var i = hist0.length - 1; i >= 0; i--) { if (hist0[i].sender === 'USER') { lastUser = i; break; } }
    var userLine = lastUser >= 0 ? hist0[lastUser] : null;
    // 回退：先收集要删的消息里的财务影响，SBupdate里一起处理
    var delMsgs = hist0.slice(lastUser + 1);   // 从最后一句User之后的所有THEM消息
    // 本地镜像先回退（变量持久化在SBupdate里另做）
    rollbackMsgEffects(name, delMsgs, (state && state.wallet) || {}, (state && state.closet) || []);
    SBupdate(function (v) {
      var n = v.sb && v.sb.npcs && v.sb.npcs[name]; if (!n || !n.dm_history) return v;
      var h = n.dm_history; var cut = h.length;
      for (var j = h.length - 1; j >= 0; j--) { if (h[j].sender === 'THEM') cut = j; else break; }
      // 变量持久化端回退（带流水记录，silent=true 避免重复 toast）
      rollbackMsgEffects(name, h.slice(cut), v.sb.wallet || {}, v.sb.closet || [], true);
      n.dm_history = h.slice(0, cut);
      var last = n.dm_history[n.dm_history.length - 1];
      n.last_message = lastPreview(last);
      n.unread = 0;
      return v;
    });
    // 本地镜像同步 + 重画
    if (npc0) { var hh = npc0.dm_history || []; var cc = hh.length; for (var k = hh.length - 1; k >= 0; k--) { if (hh[k].sender === 'THEM') cc = k; else break; } npc0.dm_history = hh.slice(0, cc); }
    if (state && state.npcs && state.npcs[name]) openChat(name, state.npcs[name]);
    var hint = userLine
      ? '玩家刚对 ' + name + ' 说的是："' + userLine.content + '"。请 ' + name + ' 换一种方式重新回应（和刚才不一样）。只让 ' + name + ' 回应，别人不要出现。'
      : '请 ' + name + ' 主动再发一条消息（换个内容）。只让 ' + name + ' 回应，别人不要出现。';
    // 链式等 SBupdate 落账后再触发重新生成（防竞态：生成器读到旧数据）
    SBupdate(function (v2) { return v2; }).then(function () {
      SBemit('sb_request_dm', { reason: hint, n: '1-2' });
      setStatus('⏳ ' + name + ' 重新回复中…');
      showTyping(name);
    });
  }
  // ── 面板内输入小窗（替代 window.prompt）──
  // 原生 prompt 在安卓会弹键盘：视口缩水的 resize 事件被模态对话框阻塞排队，对话框一关才执行，
  // 读到的还是被键盘压扁的高度 → 手机定格成半截（独立API输入框同款老bug）。
  // 这个小窗长在面板里，输入时走 typingInPanel 冻结逻辑，键盘随便弹面板纹丝不动。
  function panelPrompt(title, initVal) {
    return new Promise(function (resolve) {
      var old = panel.querySelector('.sb-pp'); if (old && old.parentNode) old.parentNode.removeChild(old);
      var box = DOC.createElement('div');
      box.className = 'sb-pp';
      box.innerHTML = '<div class="sb-pp-t"></div><textarea rows="3" autocomplete="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore></textarea>' +
        '<div class="sb-pp-b"><button class="no">取消</button><button class="ok">确定</button></div>';
      box.querySelector('.sb-pp-t').textContent = title;
      var ta = box.querySelector('textarea');
      ta.value = initVal || '';
      panel.appendChild(box);
      try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
      var done = function (val) { try { box.parentNode.removeChild(box); } catch (e) {} resolve(val); };
      box.querySelector('.ok').addEventListener('click', function () { done(ta.value); });
      box.querySelector('.no').addEventListener('click', function () { done(null); });
    });
  }

  // ✏️ 编辑自己发出的消息（记录在聊天变量里，直接改）：
  // 变量记录、待发队列(outbox)、列表预览一起改，sb_updated 让主线注入摘要同步刷新——
  // 主线下次生成看到的就是改后的版本。对方还没回时改最干净；已经回过的也能改，但TA记忆里回应的是旧话。
  function editUserMsg(name, idx) {
    var v0 = SBgetVars(); var npc0 = v0 && v0.sb && v0.sb.npcs && v0.sb.npcs[name];
    var h0 = (npc0 && npc0.dm_history) || [];
    var m0 = h0[idx];
    if (!m0 || m0.sender !== 'USER') { toast('warning', '这条消息对不上号了，重开聊天再试'); return; }
    var old = String(m0.content || '');
    panelPrompt(m0.type === 'image' ? '编辑照片描述' : '编辑这条消息', old).then(function (nv) {
      if (nv == null) return;                       // 点了取消
      nv = nv.trim();
      if (!nv || nv === old) return;
      SBupdate(function (v) {
        var n = v.sb && v.sb.npcs && v.sb.npcs[name];
        var m = n && n.dm_history && n.dm_history[idx];
        if (!m || m.sender !== 'USER') return v;
        m.content = nv; m.edited = true;
        if (idx === n.dm_history.length - 1) n.last_message = lastPreview(m);
        return v;
      });
      // 这条话还躺在待发队列里（对方没回）→ 队列一起改，真正发出去的就是新版
      var qWrap = function (s) {
        return m0.type === 'image' ? '（发了一张照片，TA能看到：' + s + '）'
          : (m0.type === 'voice' ? '（发了一段语音，TA能听到：' + s + '）' : s);
      };
      var ob = loadOutbox(); var q = ob[name];
      if (q && q.length) {
        for (var qi = q.length - 1; qi >= 0; qi--) { if (q[qi] === qWrap(old)) { q[qi] = qWrap(nv); saveOutbox(ob); break; } }
      }
      SBemit('sb_updated');   // 生成器刷新注入摘要 + 手机聊天页重渲染
      SBemit('sb_scrub_floor', { name: name });   // 楼层里的旧版文字擦掉，下次回复誊入改后版本
      toast('success', '✏️ 已修改');
    });
  }

  // 🗑 删除单条消息（长按菜单）：变量+本地镜像一起删；删的是自己攒着没发的话时，待发队列同步撤
  function deleteMsg(name, idx) {
    var v0 = SBgetVars(); var npc0 = v0 && v0.sb && v0.sb.npcs && v0.sb.npcs[name];
    var h0 = (npc0 && npc0.dm_history) || [];
    var m0 = h0[idx];
    if (!m0) { toast('warning', '这条消息对不上号了，重开聊天再试'); return; }
    // 回退这一条消息的财务影响（本地镜像 + 变量持久化双写）
    rollbackMsgEffects(name, [m0], (state && state.wallet) || {}, (state && state.closet) || []);
    SBupdate(function (v) {
      var n = v.sb && v.sb.npcs && v.sb.npcs[name];
      if (!n || !n.dm_history || !n.dm_history[idx]) return v;
      // 变量持久化端回退（带流水记录）
      rollbackMsgEffects(name, [n.dm_history[idx]], v.sb.wallet || {}, v.sb.closet || [], true);
      n.dm_history.splice(idx, 1);
      var last = n.dm_history[n.dm_history.length - 1];
      n.last_message = lastPreview(last);
      return v;
    });
    if (state && state.npcs && state.npcs[name] && state.npcs[name].dm_history) state.npcs[name].dm_history.splice(idx, 1);
    if (m0.sender === 'USER') {
      var ob = loadOutbox(); var q = ob[name];
      if (q && q.length) {
        var qv = m0.type === 'image' ? '（发了一张照片，TA能看到：' + m0.content + '）'
          : (m0.type === 'voice' ? '（发了一段语音，TA能听到：' + m0.content + '）' : m0.content);
        for (var qi = q.length - 1; qi >= 0; qi--) { if (q[qi] === qv) { q.splice(qi, 1); if (!q.length) delete ob[name]; saveOutbox(ob); break; } }
      }
    }
    toast('info', '🗑 已删除');
    SBemit('sb_updated');   // 注入摘要同步遗忘
    SBemit('sb_scrub_floor', { name: name });   // 楼层誊抄本同步擦掉这个人的段落（下次回复重誊修正版）
    // 直接刷新聊天页：不等 sb_updated → refreshView → loadState（SBupdate 异步，loadState 可能读到旧数据）
    if (state && state.npcs && state.npcs[name]) openChat(name, state.npcs[name]);
  }

  // ↩️ 撤回自己刚发的最后一条：TA那边只看得到"撤回了一条消息"，永远看不到内容（但TA知道你撤回了，会好奇）
  function recallMsg(name, idx) {
    var v0 = SBgetVars(); var npc0 = v0 && v0.sb && v0.sb.npcs && v0.sb.npcs[name];
    var h0 = (npc0 && npc0.dm_history) || [];
    var m0 = h0[idx];
    if (!m0 || m0.sender !== 'USER') { toast('warning', '这条消息对不上号了，重开聊天再试'); return; }
    SBupdate(function (v) {
      var n = v.sb && v.sb.npcs && v.sb.npcs[name];
      var m = n && n.dm_history && n.dm_history[idx];
      if (!m || m.sender !== 'USER') return v;
      m.type = 'recall';
      if (idx === n.dm_history.length - 1) n.last_message = '你：撤回了一条消息';
      return v;
    });
    if (state && state.npcs && state.npcs[name] && state.npcs[name].dm_history && state.npcs[name].dm_history[idx]) state.npcs[name].dm_history[idx].type = 'recall';
    // 还躺在待发队列里的原文撤掉——TA只会通过记录知道"她撤回了一条"，绝不会读到内容
    var ob = loadOutbox(); var q = ob[name];
    if (q && q.length) {
      var qv = m0.type === 'image' ? '（发了一张照片，TA能看到：' + m0.content + '）'
        : (m0.type === 'voice' ? '（发了一段语音，TA能听到：' + m0.content + '）' : m0.content);
      for (var qi = q.length - 1; qi >= 0; qi--) { if (q[qi] === qv) { q.splice(qi, 1); if (!q.length) delete ob[name]; saveOutbox(ob); break; } }
    }
    toast('success', '↩️ 已撤回——TA只看得到"撤回了一条消息"');
    SBemit('sb_updated');
    SBemit('sb_scrub_floor', { name: name });   // 撤回的原文如果已进楼层 → 擦掉重誊
  }

  // ── 财务回退（来自UWU）：重roll/删除消息时，消息里的转账/礼物跟着回退 ──
  // 开关存 localStorage sbnyc_rollback_enabled，默认开（"1"）
  function rollbackEnabled() {
    try { return VIEW.localStorage.getItem('sbnyc_rollback_enabled') !== '0'; } catch (e) { return true; }
  }
  // 回退一批消息的财务影响（THEM的入账转账/礼物 + USER的转出转账）
  // msgs: [{sender, type, content}] 从 dm_history 里取出的消息片段；npcName: 联系人名字
  // 只在本地 state 镜像上操作；SBupdate 回调里另调一次（变量持久化 + 本地同步双写）
  // silent=true 跳过 toast（SBupdate 内部调用时避免重复弹出）
  function rollbackMsgEffects(npcName, msgs, walletObj, closetArr, silent) {
    if (!rollbackEnabled() || !walletObj) return;
    var reversedAmt = 0;   // 正数=从余额扣回（NPC转来的钱退回去），负数=退回余额（User转出的钱还回来）
    var giftRemoved = false;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m.sender === 'THEM') {
        if (m.type === 'transfer') {
          var amt = parseFloat(String(m.content).replace(/[^0-9.]/g, '')) || 0;
          if (amt > 0) { walletObj.balance = Math.max(0, (walletObj.balance || 0) - amt); reversedAmt += amt; }
        } else if (m.type === 'gift') {
          var gm = String(m.content).match(/^(.*?)(?:—+|--)\s*\$?([\d,.]+)\s*$/);
          var gName = (gm ? gm[1] : String(m.content)).trim().slice(0, 40);
          if (closetArr) {
            for (var ci = closetArr.length - 1; ci >= 0; ci--) {
              if (closetArr[ci].name === gName && closetArr[ci].from && closetArr[ci].from.indexOf(npcName) !== -1) {
                closetArr.splice(ci, 1); giftRemoved = true; break;
              }
            }
          }
        }
      } else if (m.sender === 'USER' && m.type === 'transfer') {
        var amt2 = parseFloat(String(m.content).replace(/[^0-9.]/g, '')) || 0;
        if (amt2 > 0) { walletObj.balance = (walletObj.balance || 0) + amt2; reversedAmt -= amt2; }
      }
    }
    // 记一笔回退流水（总额，不每条刷屏）
    if (reversedAmt !== 0) {
      if (!walletObj.transactions) walletObj.transactions = [];
      walletObj.transactions.push({ direction: reversedAmt > 0 ? '-' : '+', amount: Math.abs(reversedAmt), counterparty: '消息回退 · ' + npcName, channel: '回退', note: '', time: nowT() });
      if (walletObj.transactions.length > 20) walletObj.transactions = walletObj.transactions.slice(-20);
      if (!Array.isArray(walletObj.allTransactions)) walletObj.allTransactions = [];
      walletObj.allTransactions.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        direction: reversedAmt > 0 ? '-' : '+', amount: Math.abs(reversedAmt),
        counterparty: '消息回退 · ' + npcName, channel: '回退', note: '',
        time: nowT(), gameDay: (state && state.game && state.game.day) || 1,
      });
      if (walletObj.allTransactions.length > 500) walletObj.allTransactions = walletObj.allTransactions.slice(-500);
    }
    if (giftRemoved && !silent) {
      try { if (typeof toastr !== 'undefined') toastr.info('🎁 已从衣橱移除回退的礼物', 'SugarOS'); } catch (e) {}
    }
    if (reversedAmt !== 0 && !silent) {
      var dirLabel = reversedAmt > 0 ? '退回' : '返还';
      try { if (typeof toastr !== 'undefined') toastr.info('💰 消息回退：' + dirLabel + ' ' + fmtUSD(Math.abs(reversedAmt)) + '（' + npcName + '）', 'SugarOS'); } catch (e) {}
    }
  }

  function flushOutbox() {
    var ob = loadOutbox();
    var names = Object.keys(ob);
    if (!names.length) { toast('info', '没有待发送的消息'); return; }
    var parts = [];
    for (var i = 0; i < names.length; i++) {
      parts.push('· ' + names[i] + ' 收到：' + ob[names[i]].map(function (s) { return '「' + s + '」'; }).join('、'));
    }
    // 强制点名：把每个人列清楚 + 明说"一个都不能漏"，防止一次生成只回前两个
    var reason = '玩家在手机里刚给下面这 ' + names.length + ' 个人分别发了消息，需要他们【每一个人都回复，一个都不能漏】：' + names.join('、') + '。\n' +
      parts.join('\n') + '\n' +
      '【铁律】上面点名的每个人都必须各回 1-2 条，符合各自人设；每个人只回自己收到的话，绝不替别人回、绝不把甲的话安到乙头上；没被点名的人不出现。';
    saveOutbox({});
    SBemit('sb_request_dm', { reason: reason, n: names.length + '-' + (names.length * 2), focus: names });
    setStatus('⏳ 大家陆续回复中…');
    toast('success', '📨 已发送，等回复');
    if (currentChatName && names.indexOf(currentChatName) !== -1) showTyping(currentChatName);
  }

  // 台词池：快捷键随机抽，别当复读机。
  // 基调=优雅绿茶：从不直说缺钱，只优雅地"放弃"，让对方自己心疼、自己掏。
  function pickFrom(arr) { return arr[Math.floor(Math.random() * arr.length)] || ''; }
  var QUICK_POOLS = {
    meet: [
      '最近什么时候有空？想见你了',
      '这周找一天出来吃饭吧，我知道一家新开的',
      '突然好想见你',
      '你再不约我，周五我就答应别人了哦',
      '今晚有安排吗？没有的话，现在有了',
      '路过你常去的那家店，想起你了',
      '昨晚梦到你了。细节不告诉你',
      '在喝你上次点的那支酒。没有你在，一般',
    ],
    broke: [
      '刚把看中的那条裙子放回去了。长大就是学会放弃呀',
      '这个月有点紧，把普拉提退了。走路也挺好的，当看风景',
      '在看学费账单。没事，就是突然好安静',
      '在超市把车厘子放回去了。冬天的车厘子，是给被爱的女孩吃的',
      '大家都在晒新包，我在晒太阳。也很好',
      '今天路过 Bergdorf 没进去。夸我，我很有自制力',
      '算了一下这个月的账，决定早点睡觉。晚安要说得早一点了',
      '没什么事。就是突然觉得，纽约好贵，又好美',
      '今天走路回来的。晚上的风其实还挺舒服的',
      '我这双高跟鞋的跟，今天是第三次拿去修了。修鞋师傅都认识我了，夸我念旧',
      '姐妹们在拼下个月的滑雪局，我说我怕冷。其实我不怕冷',
      '生日快到了。没什么想要的，就是随口一说',
      '橱窗里那条项链看了我三次。是它看我，不是我看它',
      '把购物车清空了。不是买了，是删了',
      '美甲掉了一角。算了，下个月一起补',
      '冰箱里还有半瓶上次开的香槟。一个人喝不完的东西真多',
      '今天试了那支口红，色号叫 Money。没买，怕它名不副实',
      '下周要降温了。我在衣柜前站了一会儿',
      '地铁上有人夸我的包好看。它听到了，它今年三岁了',
      '今天的晚饭是自己做的。厨艺进步了，掌声在哪里',
      '整理相册才发现，上一次旅行已经是很久以前的事了',
      '香水快见底了。最近喷得很省，像在跟它告别',
      '保养品都用到剪开挤了。我这么惜物，值得被奖励吧',
    ],
    selfie: [
      '刚拍的，想不想看 😘',
      '新裙子，只给你一个人看',
      '刚做完头发。好不好看，你说了算',
      '试衣间随手拍的，帮我选一件',
      '今天状态很好，奖励你一张',
      '化妆师说这个妆很衬我。你来评评',
      '今天阳光很好，顺便拍到了我',
      '所有人都夸了今天的我，还差你一个',
      '删了九张，留了这张。你的眼光负责验收',
      '今天的口红，像不像惹祸的颜色',
      '健身房镜子前拍的。教练说我进步了，你说呢',
      '睡前素颜。胆子很大地发给你一个人',
      '路人帮拍的，他手有点抖。凑合看',
      '这张是抓拍。抓拍都这么好看，过分吗',
      '猜猜我在哪。猜对了，下次带你来',
      '新耳环，就戴给镜头和你看过',
      '刚出电梯拍的。电梯里的镜子最会说好话',
      '这条裙子的拉链，只差最后两厘米。就当它拉上了',
      '今天穿了你上次说好看的那个颜色。巧了，真的是巧了',
      '拍了张背影。正面要用换的',
      '咖啡店窗边，光线太好了，不拍对不起它',
      '这是第一杯酒时候的我。第三杯的我就不给你看了',
      '刚试了礼服。老板娘说我像去领奖的。领什么奖，领你吗',
    ],
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // 内容主体算不算英文（和生成器同一把尺）：拉丁字母显著多于汉字才算——含个把英文词的中文消息不出翻译按钮
  function looksEnglish(s) {
    s = String(s || '');
    var lat = (s.match(/[a-zA-Z]/g) || []).length;
    var cjk = (s.match(/[一-鿿]/g) || []).length;
    return lat >= 6 && lat > cjk * 2;   // T.式短英文("7pm. Polo.")也要能出兜底按钮
  }
  function fmtUSD(n) { var v = Number(n) || 0; return '$' + v.toLocaleString('en-US'); }
  // 优先剧情时间（正文 [TIME:] 标记 → sb.game.time）：手机时钟和正文同步，没有才退回真实时钟
  function nowT() {
    try { var v = SBgetVars(); var gt = v && v.sb && v.sb.game && v.sb.game.time; if (gt && /^\d{1,2}:\d{2}$/.test(String(gt).trim())) return String(gt).trim(); } catch (e) {}
    var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  // ── 剧情日期换算（UWU 的日期体系）：epoch=剧情第1天的真实日期，gameDay 从 1 起算 ──
  // epoch 必须按本地时区手动拆解——new Date('2026-04-15') 是 UTC 午夜，直接用会让东西半球玩家日历各错一天
  var GAME_EPOCH_STR = '2026-04-15';   // 默认起始日=报税日（设置页可改）
  function epochDate() {
    var s = String((state && state.game && state.game.epoch) || GAME_EPOCH_STR);
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || ['', '2026', '4', '15'];
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  function gameDateOf(gd) { var d = epochDate(); d.setDate(d.getDate() + (gd || 1) - 1); return d; }
  function fmtMD(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  // gameDay → "4/16 周三"（UWU v5：日程卡片上同时显示日期+星期，不再模糊）
  function fmtMDWeekdayCN(gd) { var d = gameDateOf(gd); var WD = ['周日','周一','周二','周三','周四','周五','周六']; return fmtMD(d) + ' ' + WD[d.getDay()]; }
  // 消息时间戳带日期（UWU）："4/15 14:30"——老消息没有 gameDay 就只显示时分，不硬编
  function formatMsgTime(m) {
    var t = m.time || '';
    if (m.gameDay) t = fmtMD(gameDateOf(m.gameDay)) + ' ' + t;
    return t;
  }
  // 两条消息之间该不该插分割线（UWU 时间分割线）：跨天=显示日期，同天隔≥60分钟=显示时间；返回 null=不用插
  // 跨天直接比 gameDay，不做毫秒数学——时区在这里没有发言权
  function hhmmMin(t) { var p = String(t || '').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
  function dividerBetween(prevMsg, currMsg) {
    if (!prevMsg) return null;
    var pd = prevMsg.gameDay || 1, cd = currMsg.gameDay || 1;
    if (cd > pd) return '——— ' + fmtMD(gameDateOf(cd)) + ' ———';
    if (cd === pd && prevMsg.time && currMsg.time && hhmmMin(currMsg.time) - hhmmMin(prevMsg.time) >= 60) return '——— ' + currMsg.time + ' ———';
    return null;
  }
  function dividerHtml(txt) { return '<div class="sb-msg system" style="font-weight:500;color:var(--gold);">' + esc(txt) + '</div>'; }

  // ── 样式（全部锚在 #sbnyc-panel / #sbnyc-fab 下，不污染酒馆页面） ──
  var CSS = [
    '#sbnyc-fab{position:fixed;right:14px;bottom:120px;width:52px;height:52px;border-radius:50%;z-index:2147483600;',
    '  background:linear-gradient(135deg,#e8dfcf,#b89968);box-shadow:0 6px 20px rgba(26,42,58,.35);cursor:pointer;',
    '  display:flex;align-items:center;justify-content:center;font-size:24px;user-select:none;border:1px solid rgba(255,255,255,.4);}',
    '#sbnyc-fab:hover{transform:scale(1.06);}',
    '#sbnyc-fab .fab-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#9a1b29;color:#fff;',
    '  font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px;font-family:Georgia,serif;}',
    // 📳 悬浮球发光动画（UWU：新消息时金圈扩散三下）
    '#sbnyc-fab.glow{animation:sbfabglow 0.6s ease-out 3;}',
    '@keyframes sbfabglow{0%{box-shadow:0 6px 20px rgba(26,42,58,.35),0 0 0 0 rgba(184,153,104,.6);}50%{box-shadow:0 6px 20px rgba(26,42,58,.35),0 0 0 12px rgba(184,153,104,0);}100%{box-shadow:0 6px 20px rgba(26,42,58,.35),0 0 0 0 rgba(184,153,104,0);}}',
    // 📳 面板抖动（UWU：纯 CSS 动画，手机电脑都有"震感"）
    '@keyframes sbShake{0%{transform:translateX(0);}15%{transform:translateX(-3px);}30%{transform:translateX(3px);}45%{transform:translateX(-3px);}60%{transform:translateX(3px);}75%{transform:translateX(-2px);}100%{transform:translateX(0);}}',
    '#sbnyc-panel.sb-shake{animation:sbShake 0.2s ease-in-out;}',
    '#sbnyc-panel{position:fixed;right:10px;bottom:182px;width:min(380px,calc(100vw - 20px));height:min(660px,calc(100vh - 220px));z-index:2147483599;display:none;}',
    '#sbnyc-panel.open{display:block;}',
    '#sbnyc-panel{--ink:#1f2937;--ink-sub:#6b7280;--ink-faint:#a8acb3;--paper:#f5f3ee;--paper-2:#fbf9f4;--paper-3:#ece8dd;',
    '  --line:rgba(26,42,58,.12);--line-faint:rgba(26,42,58,.06);--gold:#b89968;--gold-soft:#d4b88a;--red:#9a1b29;--green:#4f6b5c;',
    "  --font-cn:'Source Han Serif SC','Songti SC',serif;--font-en:Georgia,'Times New Roman',serif;",
    "  --font-sans:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;font-family:var(--font-sans);}",
    // 🌙 夜间配色：只换变量，全部 UI 自动跟着变（午夜纸醉金迷·墨色底金光）
    '#sbnyc-panel.night{--ink:#ece7db;--ink-sub:#9a968c;--ink-faint:#615e57;--paper:#16181e;--paper-2:#1e212a;--paper-3:#262a34;',
    '  --line:rgba(212,184,138,.16);--line-faint:rgba(255,255,255,.05);--gold:#cba86a;--gold-soft:#d9c08a;--red:#c65a63;--green:#79a68c;}',
    '#sbnyc-panel.night .sb-phone{background:linear-gradient(180deg,#3a3d47,#26282f 45%,#1a1c22);}',
    '#sbnyc-panel.night .sb-wallet{background:linear-gradient(135deg,#22252d,#2a2418 55%,#22252d);}',
    '#sbnyc-panel.night .sb-msg.them{background:#2a2e38;}',
    // 🎁 盲盒模式：藏起所有身份标签（列表里的原型条 + 聊天页头衔），只留名字，谁是谁自己猜
    '#sbnyc-panel.blindbox .sb-dmtags,#sbnyc-panel.blindbox .sb-arche{display:none;}',
    '#sbnyc-panel *,#sbnyc-panel *::before,#sbnyc-panel *::after{margin:0;padding:0;box-sizing:border-box;}',
    '#sbnyc-panel .sb-phone{height:100%;background:linear-gradient(180deg,#e8dfcf,#cdb99a 45%,#b89968);border-radius:44px;padding:8px;',
    '  box-shadow:0 22px 60px rgba(26,42,58,.35),inset 0 0 0 1px rgba(255,255,255,.25);}',
    '#sbnyc-panel .sb-screen{height:100%;background:var(--paper);border-radius:38px;overflow:hidden;position:relative;display:flex;flex-direction:column;',
    '  background-size:cover;background-position:center;background-repeat:no-repeat;background-blend-mode:overlay;}',   // 🖼️ 壁纸铺法（UWU）：blend-mode 让纸色透出来，字还读得清
    '#sbnyc-panel .sb-screen.has-wallpaper{background-image:var(--sb-wallpaper);opacity:var(--sb-wp-opacity,0.85);}',
    '#sbnyc-panel .sb-island{min-width:96px;max-width:240px;height:24px;background:#0d0d0f;border-radius:14px;margin:6px auto 0;flex-shrink:0;display:flex;align-items:center;gap:7px;padding:0 11px;cursor:grab;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.07);}',
    '#sbnyc-panel .sb-island .cam{width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#2c3e50,#000 72%);flex-shrink:0;box-shadow:0 0 3px rgba(90,150,255,.3);}',
    '#sbnyc-panel .sb-island .itxt{font-size:9px;color:#d8cfba;letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-en);min-width:0;}',
    '#sbnyc-panel .sb-bar{display:flex;justify-content:space-between;padding:4px 24px 8px;font-size:12px;font-weight:600;color:var(--ink);flex-shrink:0;}',
    '#sbnyc-panel .sb-bar-time{font-size:13px;font-weight:700;}',
    '#sbnyc-panel .sb-main{flex:1;overflow-y:auto;padding-bottom:6px;}',
    '#sbnyc-panel .sb-status{flex-shrink:0;text-align:center;font-size:10px;color:var(--ink-faint);padding:3px 10px;letter-spacing:.5px;min-height:18px;}',
    '#sbnyc-panel .sb-home-ind{height:5px;width:110px;background:var(--ink);border-radius:3px;margin:4px auto 8px;opacity:.75;flex-shrink:0;}',
    '#sbnyc-panel .sb-wallet{margin:4px 12px 10px;background:linear-gradient(135deg,var(--paper-2),#f0e8d6 55%,var(--paper-2));border:.5px solid var(--gold);border-radius:20px;padding:14px 16px;position:relative;overflow:hidden;}',
    '#sbnyc-panel .sb-wt{font-family:var(--font-en);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);font-weight:600;}',
    '#sbnyc-panel .sb-wbal{font-family:var(--font-en);font-size:30px;font-weight:600;color:var(--ink);margin:4px 0 6px;}',
    '#sbnyc-panel .sb-wsec{font-family:var(--font-en);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin:8px 0 4px;font-weight:600;display:flex;align-items:center;gap:8px;}',
    '#sbnyc-panel .sb-wsec::after{content:"";flex:1;height:.5px;background:var(--line);}',
    '#sbnyc-panel .sb-bill{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:var(--ink-sub);border-top:.5px dashed var(--line-faint);}',
    '#sbnyc-panel .sb-bill.urgent{color:var(--red);font-weight:600;}',
    '#sbnyc-panel .sb-tx{display:flex;align-items:baseline;padding:3px 0;font-size:12px;border-top:.5px dashed var(--line-faint);}',
    '#sbnyc-panel .sb-tx-a{font-family:var(--font-en);font-weight:600;min-width:66px;}',
    '#sbnyc-panel .sb-tx-a.plus{color:var(--green);}#sbnyc-panel .sb-tx-a.minus{color:var(--red);}',
    '#sbnyc-panel .sb-tx-w{flex:1;padding:0 6px;color:var(--ink);font-weight:500;}',
    '#sbnyc-panel .sb-tx-n{color:var(--ink-sub);font-size:11px;}',
    '#sbnyc-panel .sb-actions{display:flex;gap:6px;padding:0 12px 8px;}',
    '#sbnyc-panel .sb-abtn{flex:1;background:var(--paper-2);border:.5px solid var(--line);color:var(--ink);font-family:var(--font-cn);font-size:12px;padding:7px 6px;border-radius:999px;cursor:pointer;text-align:center;letter-spacing:1px;}',
    '#sbnyc-panel .sb-abtn:hover{background:var(--ink);color:var(--paper-2);}',
    '#sbnyc-panel .sb-sec{font-family:var(--font-en);font-size:9px;letter-spacing:4px;text-transform:uppercase;color:var(--gold);margin:10px 20px 6px;font-weight:600;display:flex;align-items:center;gap:10px;}',
    '#sbnyc-panel .sb-sec::before{content:"";width:16px;height:.5px;background:var(--gold);}',
    '#sbnyc-panel .sb-sec::after{content:"";flex:1;height:.5px;background:var(--line);}',
    '#sbnyc-panel .sb-dm{margin:0 8px;}',
    '#sbnyc-panel .sb-dmrow{display:flex;align-items:center;gap:10px;padding:9px;border-radius:14px;cursor:pointer;position:relative;}',
    '#sbnyc-panel .sb-dmrow:hover{background:var(--paper-2);}',
    '#sbnyc-panel .sb-dmrow.unread::before{content:"";position:absolute;left:1px;top:50%;transform:translateY(-50%);width:6px;height:6px;border-radius:50%;background:var(--red);}',
    '#sbnyc-panel .sb-ava{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,var(--paper-3),var(--paper-2));border:.5px solid var(--gold);color:var(--gold);display:flex;align-items:center;justify-content:center;font-family:var(--font-cn);font-size:15px;}',
    '#sbnyc-panel .sb-dmbody{flex:1;min-width:0;}',
    '#sbnyc-panel .sb-dmtop{display:flex;justify-content:space-between;align-items:baseline;gap:6px;}',
    '#sbnyc-panel .sb-dmtop b{font-family:var(--font-cn);font-weight:500;font-size:14px;color:var(--ink);}',
    '#sbnyc-panel .sb-dmtop em{font-size:10px;color:var(--ink-faint);font-style:normal;font-family:var(--font-en);}',
    '#sbnyc-panel .sb-dmtags{font-family:var(--font-en);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);font-weight:600;margin:2px 0;}',
    '#sbnyc-panel .sb-dmlast{font-size:12px;color:var(--ink-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#sbnyc-panel .sb-dmrow.unread .sb-dmlast{color:var(--ink);font-weight:500;}',
    '#sbnyc-panel .sb-badge{background:var(--red);color:#fff;min-width:18px;height:18px;border-radius:9px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0;}',
    '#sbnyc-panel .sb-chat{position:absolute;top:0;left:0;right:0;bottom:0;background:transparent !important;display:flex;flex-direction:column;z-index:10;border-radius:38px;overflow:hidden;}',
    '#sbnyc-panel .sb-ch{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:.5px solid var(--line);background:linear-gradient(180deg,var(--paper-2),var(--paper-3));flex-shrink:0;}',
    '#sbnyc-panel .sb-ch-back{background:none;border:none;color:var(--gold);font-size:22px;cursor:pointer;padding:0 4px;line-height:1;}',
    '#sbnyc-panel .sb-ch-del{background:none;border:none;font-size:15px;cursor:pointer;opacity:.45;padding:0 4px;}',
    '#sbnyc-panel .sb-ch-del:hover{opacity:1;}',
    '#sbnyc-panel .sb-ch-name{flex:1;}',
    '#sbnyc-panel .sb-ch-name b{display:block;font-family:var(--font-cn);font-size:15px;color:var(--ink);}',
    '#sbnyc-panel .sb-ch-name small{font-family:var(--font-en);font-size:9px;color:var(--gold);letter-spacing:2px;text-transform:uppercase;font-weight:600;}',
    '#sbnyc-panel .sb-msgs{flex:1;overflow-y:auto;padding:12px 10px;display:flex;flex-direction:column;gap:5px;background:transparent !important;}',
    // 藐姑射仙老师的透明背景回退：关掉透明模式时恢复纸色
    '#sbnyc-panel.wp-solid .sb-msgs{background:var(--paper-2)!important;}',
    '#sbnyc-panel.wp-solid .sb-chat{background:var(--paper)!important;}',
    '#sbnyc-panel .sb-msg{max-width:78%;padding:8px 13px;border-radius:16px;font-size:13.5px;line-height:1.55;word-break:break-word;}',
    '#sbnyc-panel .sb-msg.them{align-self:flex-start;background:var(--paper-3);color:var(--ink);border-bottom-left-radius:4px;}',
    '#sbnyc-panel .sb-msg.me{align-self:flex-end;background:linear-gradient(135deg,var(--gold-soft),var(--gold));color:#fff;border-bottom-right-radius:4px;font-weight:500;}',
    '#sbnyc-panel .sb-msg .mt{display:block;font-family:var(--font-en);font-size:9px;color:var(--ink-faint);margin-top:3px;font-weight:400;}',
    '#sbnyc-panel .sb-msg.me .mt{color:rgba(255,255,255,.65);text-align:right;}',
    '#sbnyc-panel .sb-qt{border-left:2px solid var(--gold);background:rgba(26,42,58,.07);color:var(--ink-sub);font-size:11.5px;line-height:1.5;padding:4px 9px;border-radius:4px;margin-bottom:5px;max-height:52px;overflow:hidden;}',
    '#sbnyc-panel .sb-msg.me .sb-qt{border-left-color:rgba(255,255,255,.75);background:rgba(255,255,255,.18);color:rgba(255,255,255,.92);}',
    '#sbnyc-panel .sb-msg.transfer{align-self:flex-start;background:linear-gradient(135deg,#f7c774,#e89d38);color:#fff;border-radius:14px;padding:12px 14px;max-width:200px;}',
    '#sbnyc-panel .sb-msg.transfer.me{align-self:flex-end;}',
    '#sbnyc-panel .sb-msg.transfer .ta{font-family:var(--font-en);font-size:22px;font-weight:700;line-height:1.1;}',
    '#sbnyc-panel .sb-msg.transfer .tl{font-size:10px;letter-spacing:1px;opacity:.9;margin-top:2px;}',
    '#sbnyc-panel .sb-msg.media{font-style:italic;border:1px dashed var(--gold);background:var(--paper-3);color:var(--ink-sub);font-size:12px;}',
    '#sbnyc-panel .sb-msg.system{align-self:center;background:transparent;font-size:10px;color:var(--ink-faint);letter-spacing:1px;text-align:center;max-width:100%;}',
    '#sbnyc-panel .sb-quick{display:flex;gap:6px;padding:6px 12px 0;flex-wrap:wrap;flex-shrink:0;}',
    '#sbnyc-panel .sb-qbtn{background:var(--paper-3);border:.5px solid var(--line);color:var(--ink-sub);font-family:var(--font-cn);font-size:11px;padding:5px 10px;border-radius:999px;cursor:pointer;}',
    '#sbnyc-panel .sb-qbtn:hover{background:var(--gold);color:#fff;}',
    '#sbnyc-panel .sb-cbar{display:flex;gap:6px;padding:10px 12px;border-top:.5px solid var(--line);background:var(--paper);flex-shrink:0;}',
    // 聊天输入用 textarea 不用 input：安卓 autofill 不把多行框当密码/信用卡字段，输入法顶上的自动填充条就不冒了
    '#sbnyc-panel .sb-cbar input,#sbnyc-panel .sb-cbar textarea{flex:1;border:.5px solid var(--line);border-radius:999px;padding:8px 14px;font-family:var(--font-cn);font-size:13px;background:#fff;color:var(--ink);outline:none;min-width:0;resize:none;overflow:hidden;line-height:1.4;height:auto;}',
    '#sbnyc-panel .sb-cbar input:focus,#sbnyc-panel .sb-cbar textarea:focus{border-color:var(--gold);}',
    '#sbnyc-panel .sb-cbar button{background:var(--ink);color:var(--paper-2);border:none;border-radius:999px;padding:8px 12px;font-family:var(--font-cn);font-size:12px;cursor:pointer;white-space:nowrap;}',
    '#sbnyc-panel .sb-cbar .queue{background:var(--paper-3);color:var(--gold);border:.5px solid var(--gold);font-size:15px;font-weight:700;padding:8px 11px;}',
    '#sbnyc-panel .sb-cbar .queue:hover{background:var(--gold);color:#fff;}',
    '#sbnyc-panel .sb-cbar button:hover{background:var(--gold);}',
    '#sbnyc-panel .sb-toast{margin:8px 12px;padding:10px 14px;background:linear-gradient(90deg,var(--paper-2),var(--paper-3));border:.5px solid var(--gold);border-left:3px solid var(--gold);border-radius:10px;font-size:12px;color:var(--ink);line-height:1.7;}',
    '#sbnyc-panel .sb-toast-h{font-family:var(--font-en);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--gold);margin-bottom:4px;font-weight:600;}',
    '#sbnyc-panel .sb-forow{display:flex;align-items:center;gap:12px;margin:0 12px 8px;padding:13px 14px;background:var(--paper-2);border:.5px solid var(--line);border-radius:14px;}',
    '#sbnyc-panel .sb-forow .fi{font-size:20px;flex-shrink:0;}',
    '#sbnyc-panel .sb-forow .fb{flex:1;min-width:0;}',
    '#sbnyc-panel .sb-forow .fb b{display:block;font-family:var(--font-cn);font-size:13.5px;font-weight:500;color:var(--ink);}',
    '#sbnyc-panel .sb-forow .fb small{font-size:11px;color:var(--ink-sub);}',
    '#sbnyc-panel .sb-soon{font-family:var(--font-en);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);border:.5px solid var(--gold);border-radius:999px;padding:2px 8px;flex-shrink:0;}',
    '#sbnyc-panel .sb-frow{display:flex;flex-direction:column;gap:4px;margin:0 14px 10px;}',
    '#sbnyc-panel .sb-frow label{font-size:10px;color:var(--ink-sub);letter-spacing:1px;}',
    '#sbnyc-panel .sb-frow input,#sbnyc-panel .sb-frow textarea{border:.5px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12px;outline:none;background:#fff;color:var(--ink);font-family:var(--font-sans);resize:none;overflow:hidden;width:100%;box-sizing:border-box;}',
    '#sbnyc-panel .sb-frow input:focus,#sbnyc-panel .sb-frow textarea:focus{border-color:var(--gold);}',
    '#sbnyc-panel .sb-gear{cursor:pointer;opacity:.55;}#sbnyc-panel .sb-gear:hover{opacity:1;}',
    '#sbnyc-panel .sb-empty{text-align:center;font-size:11px;color:var(--ink-faint);padding:20px;font-style:italic;font-family:var(--font-en);}',
    '#sbnyc-panel .sb-wait{padding:30px 16px;font-size:12px;color:var(--ink-faint);text-align:center;line-height:1.9;}',
    // 翻译（微信式：英文消息气泡里自带"翻译"按钮，点开显示随消息一起预生成的中文，零等待零API）
    '#sbnyc-panel .sb-tr-btn{display:inline-block;margin-top:5px;font-size:9px;color:var(--gold);cursor:pointer;letter-spacing:1px;border:.5px solid var(--gold);border-radius:999px;padding:1px 8px;opacity:.75;user-select:none;}',
    '#sbnyc-panel .sb-tr-btn:hover{opacity:1;}',
    '#sbnyc-panel .sb-tr-txt{display:none;border-top:.5px dashed var(--line);margin-top:6px;padding-top:6px;font-size:12.5px;color:var(--ink-sub);font-style:normal;}',
    '#sbnyc-panel .sb-tr-txt.show{display:block;}',
    // 长按消息菜单（✏️编辑/🔄重roll/📋复制）；气泡禁选中，防长按时拉出系统的文字选择菜单
    '#sbnyc-panel .sb-msg{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}',
    '#sbnyc-panel .sb-msgmenu{position:absolute;z-index:60;background:var(--paper-2);border:.5px solid var(--line);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.22);padding:4px;min-width:150px;max-height:70%;overflow-y:auto;}',
    '#sbnyc-panel .sb-msgmenu button{display:block;width:100%;text-align:left;background:none;border:none;padding:9px 13px;font-size:12.5px;color:var(--ink);cursor:pointer;border-radius:9px;font-family:var(--font-sans);}',
    '#sbnyc-panel .sb-msgmenu button:hover{background:var(--paper-3);}',
    // 面板内输入小窗（替代 window.prompt，安卓键盘怎么弹都不压扁面板）
    '#sbnyc-panel .sb-pp{position:absolute;left:10px;right:10px;top:18%;z-index:70;background:var(--paper-2);border:.5px solid var(--gold);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.28);padding:12px;}',
    '#sbnyc-panel .sb-pp-t{font-size:12px;color:var(--ink);margin-bottom:8px;line-height:1.6;}',
    '#sbnyc-panel .sb-pp textarea{width:100%;box-sizing:border-box;border:.5px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px;font-family:var(--font-cn);background:#fff;color:var(--ink);outline:none;resize:none;}',
    '#sbnyc-panel .sb-pp textarea:focus{border-color:var(--gold);}',
    '#sbnyc-panel .sb-pp-b{display:flex;gap:8px;margin-top:8px;}',
    '#sbnyc-panel .sb-pp-b button{flex:1;border:none;border-radius:999px;padding:8px;font-size:12px;cursor:pointer;font-family:var(--font-cn);}',
    '#sbnyc-panel .sb-pp-b .ok{background:var(--gold);color:#fff;}',
    '#sbnyc-panel .sb-pp-b .no{background:var(--paper-3);color:var(--ink-sub);}',
    // 「正在输入…」气泡 + 键盘抬升的平移动画
    '#sbnyc-panel .sb-typing{font-style:italic;animation:sbtype 1.2s ease-in-out infinite;}',
    '@keyframes sbtype{0%,100%{opacity:.35;}50%{opacity:.8;}}',
    '#sbnyc-panel{transition:transform .15s ease-out;}',
    // 论坛：排行榜行 / 帖子卡 / 深渊区暗色 / 购买按钮
    '#sbnyc-panel .sb-rank{display:flex;align-items:center;gap:10px;margin:0 12px 6px;padding:10px 12px;background:var(--paper-2);border:.5px solid var(--line);border-radius:12px;}',
    '#sbnyc-panel .sb-rank .rn{font-family:var(--font-en);font-weight:700;font-size:14px;color:var(--gold);min-width:24px;text-align:center;flex-shrink:0;}',
    '#sbnyc-panel .sb-rank .rb{flex:1;min-width:0;}',
    '#sbnyc-panel .sb-rank .rb b{font-family:var(--font-cn);font-size:13px;color:var(--ink);display:block;}',
    '#sbnyc-panel .sb-rank .rb small{font-size:11px;color:var(--ink-sub);display:block;line-height:1.5;}',
    '#sbnyc-panel .sb-rank .ra{font-family:var(--font-en);font-weight:600;color:var(--green);font-size:13px;flex-shrink:0;}',
    '#sbnyc-panel .sb-rank.you{border-color:var(--gold);background:linear-gradient(135deg,var(--paper-2),#f0e8d6);}',
    '#sbnyc-panel .sb-post{margin:0 12px 10px;padding:12px 14px;background:var(--paper-2);border:.5px solid var(--line);border-radius:14px;}',
    '#sbnyc-panel .sb-post b{font-family:var(--font-cn);font-size:13px;color:var(--ink);display:block;margin-bottom:3px;font-weight:500;}',
    '#sbnyc-panel .sb-post .pb{font-size:12px;color:var(--ink-sub);line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;}',
    '#sbnyc-panel .sb-post .pm{font-size:10px;color:var(--ink-faint);margin-top:6px;font-family:var(--font-en);letter-spacing:1px;}',
    // 💬 我的自荐帖评论区：一楼一条，@昵称 金色
    '#sbnyc-panel .sb-cmt{margin-top:7px;padding:7px 10px;background:var(--paper-3);border-radius:10px;font-size:11.5px;color:var(--ink-sub);line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;}',
    '#sbnyc-panel .sb-cmt b{color:var(--gold);font-weight:600;margin-right:6px;font-family:var(--font-en);}',
    '#sbnyc-panel .sb-cmt-pull{margin-top:8px;text-align:center;font-size:10px;color:var(--gold);cursor:pointer;letter-spacing:1px;border:.5px dashed var(--gold);border-radius:999px;padding:4px 10px;opacity:.8;user-select:none;}',
    '#sbnyc-panel .sb-cmt-pull:hover{opacity:1;}',
    // ➕ 新私信：iMessage 栏标题右侧的入口
    '#sbnyc-panel .sb-newdm{font-size:10px;color:var(--gold);cursor:pointer;letter-spacing:1px;border:.5px dashed var(--gold);border-radius:999px;padding:2px 9px;user-select:none;opacity:.85;}',
    '#sbnyc-panel .sb-newdm:hover{opacity:1;}',
    // 💸 账单行内的"付"小按钮
    '#sbnyc-panel .sb-paybill{cursor:pointer;color:var(--gold);border:.5px solid var(--gold);border-radius:999px;padding:0 6px;font-size:9px;margin-left:4px;user-select:none;opacity:.85;}',
    '#sbnyc-panel .sb-paybill:hover{opacity:1;}',
    // Key 遮罩：不用 type=password（会勾出安卓密码管理器），用 CSS 圆点替代（Firefox 不支持就明文，自己的 key 无妨）
    '#sbnyc-panel input.sb-mask{-webkit-text-security:disc;}',
    // 📅 行程 todolist：⭕打勾 / 点文字编辑 / ✕删除
    '#sbnyc-panel .sb-sched{display:flex;align-items:center;gap:8px;}',
    '#sbnyc-panel .sb-schk,#sbnyc-panel .sb-sdel{cursor:pointer;flex-shrink:0;user-select:none;}',
    '#sbnyc-panel .sb-sdel{opacity:.4;padding:0 4px;}',
    '#sbnyc-panel .sb-sdel:hover{opacity:1;}',
    '#sbnyc-panel .sb-stxt{flex:1;cursor:pointer;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#sbnyc-panel .sb-sched.done .sb-stxt{text-decoration:line-through;opacity:.45;}',
    '#sbnyc-panel .sb-abyss{background:#141417;border:.5px solid #2a2a30;border-radius:14px;margin:0 12px 10px;padding:12px 14px;color:#8b93a7;font-size:12px;line-height:1.8;}',
    '#sbnyc-panel .sb-abyss .am{color:#4a4f5e;font-size:9px;letter-spacing:2px;margin-top:6px;font-family:var(--font-en);}',
    '#sbnyc-panel .sb-buy{background:var(--ink);color:var(--paper-2);border:none;border-radius:999px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:var(--font-cn);flex-shrink:0;white-space:nowrap;}',
    '#sbnyc-panel .sb-buy:hover{background:var(--gold);}',
    // 🔗 商品转发按钮（"买给我"的暗示键）：描边样式和下单区分开
    '#sbnyc-panel .sb-fwd{background:none;color:var(--gold);border:.5px solid var(--gold);border-radius:999px;padding:5px 9px;font-size:11px;cursor:pointer;flex-shrink:0;margin-right:4px;opacity:.85;}',
    '#sbnyc-panel .sb-fwd:hover{opacity:1;background:var(--gold);color:#fff;}',
    // Elite 付费墙
    '#sbnyc-panel .sb-paywall{margin:14px;padding:20px 16px;border:.5px solid var(--gold);border-radius:18px;background:linear-gradient(135deg,var(--paper-2),#f0e8d6);text-align:center;}',
    '#sbnyc-panel .sb-paywall h3{font-family:var(--font-en);font-size:16px;letter-spacing:3px;color:var(--gold);margin-bottom:6px;font-weight:600;}',
    '#sbnyc-panel .sb-paywall p{font-size:11px;color:var(--ink-sub);line-height:1.8;margin-bottom:10px;}',
    '#sbnyc-panel .sb-paywall .tier{text-align:left;font-size:12px;color:var(--ink);background:var(--paper-2);border:.5px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:8px;line-height:1.7;}',
    '#sbnyc-panel .sb-paywall .tier b{font-family:var(--font-en);color:var(--gold);}',
    // 犒赏自己橱窗卡（服务器池子拉的真图真货）+ 排行榜真人标 + 衣橱
    '#sbnyc-panel .sb-lux{margin:0 12px 10px;background:var(--paper-2);border:.5px solid var(--gold);border-radius:16px;overflow:hidden;}',
    '#sbnyc-panel .sb-lux img{width:100%;aspect-ratio:3/2;height:auto;object-fit:cover;object-position:center;display:block;background:var(--paper-3);}',
    '#sbnyc-panel .sb-lux .lb{padding:10px 12px;display:flex;align-items:center;gap:8px;}',
    '#sbnyc-panel .sb-lux .li{flex:1;min-width:0;}',
    '#sbnyc-panel .sb-lux .lbrand{font-family:var(--font-en);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);font-weight:600;display:block;}',
    '#sbnyc-panel .sb-lux .li b{font-family:var(--font-cn);font-size:13px;color:var(--ink);display:block;}',
    '#sbnyc-panel .sb-lux .li small{font-size:11px;color:var(--ink-sub);display:block;line-height:1.5;}',
    '#sbnyc-panel .sb-lux .lp{font-family:var(--font-en);font-weight:600;color:var(--ink);font-size:13px;flex-shrink:0;}',
    '#sbnyc-panel .sb-exp{border-color:var(--gold-soft);background:linear-gradient(180deg,var(--paper-2),rgba(184,153,104,.06));}',
    '#sbnyc-panel .sb-startexp{flex-shrink:0;background:var(--ink);color:var(--paper-2);border:none;border-radius:999px;padding:7px 14px;font-family:var(--font-cn);font-size:12px;cursor:pointer;white-space:nowrap;letter-spacing:1px;}',
    '#sbnyc-panel .sb-startexp:hover{background:var(--gold);color:#fff;}',
    '#sbnyc-panel .sb-live{font-family:var(--font-en);font-size:8px;letter-spacing:1px;color:#fff;background:var(--gold);border-radius:999px;padding:1px 6px;vertical-align:middle;font-weight:700;}',
    // 全局回复横条：主页顶部醒目按钮，有攒着的待发消息才出现（替代找不到的浮动胶囊）
    '#sbnyc-panel .sb-sendall{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 12px 10px;padding:12px;border-radius:14px;cursor:pointer;',
    '  background:linear-gradient(135deg,var(--ink),#2c3e50);color:var(--paper-2);box-shadow:0 4px 14px rgba(26,42,58,.3);border:.5px solid var(--gold-soft);}',
    '#sbnyc-panel .sb-sendall:hover{filter:brightness(1.1);}',
    '#sbnyc-panel .sb-sendall .sa-txt{font-family:var(--font-cn);font-size:14px;letter-spacing:2px;}',
    '#sbnyc-panel .sb-sendall .sa-badge{background:var(--gold);color:var(--ink);min-width:20px;height:20px;border-radius:10px;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;font-family:var(--font-en);}',
    // 置顶（微信式）：淡淡的底色说明这条被置顶了；📌按钮在聊天页顶栏
    '#sbnyc-panel .sb-dmrow.pinned{background:var(--paper-3);}',
    '#sbnyc-panel .sb-dmrow.pinned:hover{background:#e4dfd2;}',
    '#sbnyc-panel .sb-ch-pin{background:none;border:none;font-size:15px;cursor:pointer;opacity:.3;padding:0 4px;}',
    '#sbnyc-panel .sb-ch-pin.on{opacity:1;}',
    // SugarElite™ 专属视觉：金名 + 墨底金字头像（管家和凡人不一样）
    '#sbnyc-panel .sb-dmrow.se .sb-dmtop b{color:var(--gold);letter-spacing:.5px;}',
    '#sbnyc-panel .sb-dmrow.se .sb-ava{background:var(--ink);color:var(--gold);border-color:var(--gold);}',
    '#sbnyc-panel .sb-ch-name b.se{color:var(--gold);letter-spacing:.5px;}',
    // 🎙️ 语音条（沉浸版）：波形+秒数，点一下才展开文字（微信式）
    '#sbnyc-panel .sb-msg.voice{cursor:pointer;font-style:normal;}',
    '#sbnyc-panel .sb-msg.voice .sb-vc{display:flex;align-items:center;gap:7px;}',
    '#sbnyc-panel .sb-msg.voice .vwave{letter-spacing:2px;font-size:11px;opacity:.75;font-family:var(--font-en);}',
    '#sbnyc-panel .sb-msg.voice .vsec{font-size:10px;opacity:.85;font-family:var(--font-en);flex-shrink:0;}',
    '#sbnyc-panel .sb-msg.voice .sb-vc-txt{display:none;margin-top:6px;padding-top:6px;border-top:.5px dashed var(--line);font-size:12.5px;line-height:1.55;}',
    '#sbnyc-panel .sb-msg.voice.open .sb-vc-txt{display:block;}',
    '#sbnyc-panel .sb-msg.voice.me .sb-vc-txt{border-top-color:rgba(255,255,255,.35);}',
    // 🧾 小票样式：转发的账单/商品/帖子渲染成收据卡（虚线边框+抬头+明细）
    '#sbnyc-panel .sb-msg.sb-rcpt{background:var(--paper-2);color:var(--ink);border:1px dashed var(--gold);border-radius:8px;font-weight:400;max-width:82%;align-self:flex-end;}',
    '#sbnyc-panel .sb-msg.sb-rcpt .rc-h{font-family:var(--font-en);font-size:8px;letter-spacing:2.5px;color:var(--gold);font-weight:700;border-bottom:.5px dashed var(--line);padding-bottom:4px;margin-bottom:5px;}',
    '#sbnyc-panel .sb-msg.sb-rcpt .rc-n{font-size:13px;font-weight:600;line-height:1.5;}',
    '#sbnyc-panel .sb-msg.sb-rcpt .rc-m{font-family:var(--font-en);font-size:12px;color:var(--ink-sub);margin-top:2px;}',
    '#sbnyc-panel .sb-msg.sb-rcpt .rc-f{font-size:9px;color:var(--ink-faint);border-top:.5px dashed var(--line);margin-top:6px;padding-top:4px;letter-spacing:1px;}',
    '#sbnyc-panel .sb-msg.sb-rcpt .mt{color:var(--ink-faint);text-align:right;}',
    // 👯 群聊：气泡上方的小名字（谁在说）
    '#sbnyc-panel .sb-msg .gsp{display:block;font-size:10px;color:var(--gold);font-weight:700;margin-bottom:2px;letter-spacing:.5px;font-family:var(--font-en);}',
    // ☑️ 多选删除模式：被选中的气泡描红；底部操作条
    '#sbnyc-panel .sb-msg.sel{outline:1.5px solid var(--red);outline-offset:1px;opacity:.85;}',
    '#sbnyc-panel .sb-mselbar{position:absolute;left:10px;right:10px;bottom:12px;z-index:65;display:flex;gap:8px;background:var(--paper-2);border:.5px solid var(--gold);border-radius:14px;padding:8px;box-shadow:0 10px 26px rgba(0,0,0,.25);}',
    '#sbnyc-panel .sb-mselbar button{flex:1;border:none;border-radius:999px;padding:9px;font-size:12.5px;cursor:pointer;font-family:var(--font-cn);}',
    '#sbnyc-panel .sb-mselbar .mdel{background:var(--red);color:#fff;}',
    '#sbnyc-panel .sb-mselbar .mcancel{background:var(--paper-3);color:var(--ink-sub);}',
    // 📅 日历格子（UWU）
    '#sbnyc-panel .sb-cal-day{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-size:13px;position:relative;overflow:hidden;min-height:0;}',
    '#sbnyc-panel .sb-cal-day span{flex-shrink:0;line-height:1.2;}',
    '#sbnyc-panel .sb-cal-day:hover{filter:brightness(0.95);}',
    '#sbnyc-panel .sb-cal-day:active{transform:scale(0.95);}',
    // 🖼️ 壁纸上传/清除按钮（UWU）
    '#sbnyc-panel .sb-wp-upload{display:inline-block;cursor:pointer;color:var(--gold);border:.5px dashed var(--gold);border-radius:999px;padding:3px 10px;font-size:11px;margin-left:6px;opacity:.85;}',
    '#sbnyc-panel .sb-wp-upload:hover{opacity:1;background:var(--gold);color:#fff;}',
    '#sbnyc-panel .sb-wp-upload input{display:none;}',
    '#sbnyc-panel .sb-wp-clear{cursor:pointer;color:var(--red);border:.5px solid var(--red);border-radius:999px;padding:3px 10px;font-size:11px;margin-left:4px;opacity:.7;}',
    '#sbnyc-panel .sb-wp-clear:hover{opacity:1;}',
  ].join('\n');

  // ── 挂载（先拆旧的，脚本重载/换聊天时不留双份） ──
  var old1 = DOC.getElementById('sbnyc-style'); if (old1) old1.remove();
  var old2 = DOC.getElementById('sbnyc-fab'); if (old2) old2.remove();
  var old3 = DOC.getElementById('sbnyc-panel'); if (old3) old3.remove();

  var styleEl = DOC.createElement('style');
  styleEl.id = 'sbnyc-style';
  styleEl.textContent = CSS;
  DOC.head.appendChild(styleEl);

  var fab = DOC.createElement('div');
  fab.id = 'sbnyc-fab';
  fab.title = 'SugarOS 手机';
  fab.innerHTML = '📱<span class="fab-badge" id="sbnyc-fab-badge"></span>';
  DOC.body.appendChild(fab);

  var panel = DOC.createElement('div');
  panel.id = 'sbnyc-panel';
  panel.innerHTML =
    '<div class="sb-phone"><div class="sb-screen">' +
    '<div class="sb-island" id="sbnyc-island"><span class="cam"></span><span class="itxt" id="sbnyc-island-txt">SugarOS</span></div>' +
    '<div class="sb-bar" id="sbnyc-bar"><span>5G</span><span class="sb-bar-time">--:--</span><span>76% <span class="sb-gear" id="sbnyc-night" title="夜间/白天">🌙</span> <span class="sb-gear" id="sbnyc-gear" title="手机设置">⚙</span></span></div>' +
    '<div class="sb-main" id="sbnyc-main"></div>' +
    '<div class="sb-chat" id="sbnyc-chat" style="display:none"></div>' +
    '<div class="sb-home-ind"></div>' +
    '</div></div>';
  DOC.body.appendChild(panel);

  var root = DOC.getElementById('sbnyc-main');
  var chatEl = DOC.getElementById('sbnyc-chat');
  var barEl = DOC.getElementById('sbnyc-bar');
  var islandTxt = DOC.getElementById('sbnyc-island-txt');
  var badgeEl = DOC.getElementById('sbnyc-fab-badge');
  var screenEl = panel.querySelector('.sb-screen');

  var state = null;
  var currentChatName = null;
  var currentPage = null;   // 'forum' | 'board:xx' | 'elite' | 'settings'（chatEl 上开着的非聊天页）

  // ── 灵动岛：平时滚动 User 正在听的歌，有事件时让位给状态文字 ──
  // 歌单由 AI 生成（dm_generator 的 sb_request_playlist，存 sb.playlist，一个聊天生成一次）。
  // 下面几首只是 AI 歌单到货前的垫场。
  var PLAYLIST = [
    'Lana Del Rey — Young and Beautiful',
    'Frank Ocean — Super Rich Kids',
    'The Weeknd — Starboy',
    'JAY-Z — Empire State of Mind',
  ];
  var songIdx = Math.floor(Math.random() * PLAYLIST.length);
  var plRequested = false;
  var statusUntil = 0;
  function showIsland(t, title) {
    if (!islandTxt) return;
    islandTxt.textContent = t || '';
    islandTxt.title = title || t || '';
  }
  function setStatus(t) {
    if (!t) { statusUntil = 0; showIsland('♪ ' + PLAYLIST[songIdx]); return; }
    statusUntil = Date.now() + (t.indexOf('⚠') !== -1 ? 20000 : 8000);   // ⚠️ 多停一会
    showIsland(t, t);
  }
  setInterval(function () {
    if (Date.now() < statusUntil) return;
    songIdx = (songIdx + 1) % PLAYLIST.length;
    showIsland('♪ ' + PLAYLIST[songIdx]);
  }, 18000);
  showIsland('♪ ' + PLAYLIST[songIdx]);

  // ── 状态读取与渲染 ──
  function loadState() {
    try { var v = SBgetVars(); state = (v && v.sb) ? v.sb : null; } catch (e) { state = null; }
    if (state) {
      // UWU 日期体系补档：老存档的日程没有 gameDay → 按当前剧情日补上（只补一次，写回变量）
      if (state.schedule && state.game) {
        var needFix = false;
        for (var si = 0; si < state.schedule.length; si++) {
          if (state.schedule[si].gameDay == null) { state.schedule[si].gameDay = state.game.day || 1; needFix = true; }
        }
        if (needFix) { var fixed = state.schedule; SBupdate(function (v2) { if (v2.sb) v2.sb.schedule = fixed; return v2; }); }
      }
      if (state.game && !state.game.epoch) state.game.epoch = GAME_EPOCH_STR;
      if (state.wallet && !Array.isArray(state.wallet.allTransactions)) state.wallet.allTransactions = [];
    }
  }
  // 📳 震动+发光开关（UWU）：默认开，localStorage 记偏好（这里不能用 VIEW——它在文件更靠后才赋值）
  var vibrateEnabled = true;
  try { vibrateEnabled = (DOC.defaultView || window).localStorage.getItem('sbnyc_vibrate') !== '0'; } catch (e) {}
  function triggerVibration() {
    if (!vibrateEnabled) return;
    fab.classList.add('glow');
    setTimeout(function () { fab.classList.remove('glow'); }, 1800);
    panel.classList.add('sb-shake');
    setTimeout(function () { panel.classList.remove('sb-shake'); }, 200);
  }
  // ⏱ 时间校准（UWU）：AI 把时钟写歪时玩家点顶栏时间自己拨回来，不用等下一轮 [TIME] 标记
  // 日期字符串（月,日）→ gameDay：按 epoch 本地时区算（和 dm_generator.dateToGameDay 同逻辑，两端一致）
  function dateStrToGameDay(month, day) {
    var ep = epochDate();
    var year = ep.getFullYear();
    if (month < ep.getMonth() - 2) year++;   // 月份比 epoch 小很多=推断次年
    var d = new Date(year, month - 1, day);
    return Math.round((d.getTime() - ep.getTime()) / 86400000) + 1;
  }
  // 行程文本 → 事件发生的 gameDay：认日期(4/18)或星期(周五=接下来最近的周五)，都没有=今天。
  // 修"串时间"bug：以前 gameDay 一律记成添加日，和玩家写的"周五"打架（显示两个日子、日历落错格）
  function schedTextToGameDay(txt) {
    var s = String(txt || '');
    var today = (state && state.game && state.game.day) || 1;
    var m = s.match(/(\d{1,2})\/(\d{1,2})/) || s.match(/(\d{1,2})月(\d{1,2})日?/);
    if (m) { var gd = dateStrToGameDay(parseInt(m[1], 10), parseInt(m[2], 10)); return gd >= 1 ? gd : today; }
    var w = s.match(/(?:周|星期|礼拜)([日天一二三四五六])/);
    if (w) {
      var MAP = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
      return today + ((MAP[w[1]] - gameDateOf(today).getDay() + 7) % 7);   // 今天周三填周五=+2；填周三=就是今天
    }
    return today;
  }
  // ⏱ 校准剧情时间/日期（点顶栏时间触发）。UWU 只能调时分；这里补上"跳到任意日期"：
  // 走 MVU 变量——sb.game 本来就注入 prompt，LLM 下一轮自然读到新日期，不需要额外发 system 消息。前进时账单同步倒计时。
  function calibrateTime() {
    var g = (state && state.game) || {};
    var curStr = (g.day ? fmtMD(gameDateOf(g.day)) + ' ' : '') + (g.time || nowT());
    panelPrompt('校准时间/日期。填 14:30（改时间）｜4/16（跳到某天）｜4/16 14:30（都改）', curStr).then(function (val) {
      val = (val || '').trim();
      if (!val) return;
      var timeM = val.match(/(\d{1,2}):(\d{2})/);
      var dateM = val.match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || val.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/) || val.match(/(\d{1,2})月(\d{1,2})日?/);
      var newTime = null, targetDay = null;
      if (timeM) {
        var hh = Math.min(23, Math.max(0, parseInt(timeM[1], 10) || 0));
        var mm = Math.min(59, Math.max(0, parseInt(timeM[2], 10) || 0));
        newTime = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      }
      if (dateM) {
        var mo, dy;
        if (String(dateM[1]).length === 4) { mo = parseInt(dateM[2], 10); dy = parseInt(dateM[3], 10); }   // YYYY-MM-DD
        else { mo = parseInt(dateM[1], 10); dy = parseInt(dateM[2], 10); }                                  // M/D 或 M月D日
        targetDay = dateStrToGameDay(mo, dy);
        if (targetDay < 1) targetDay = 1;
        if (targetDay > 3650) { toast('warning', '这日期离剧情起始太远了（超过10年），确认下起始日期对不对'); return; }
      }
      if (newTime == null && targetDay == null) { toast('warning', '没认出时间或日期——例：14:30 或 4/16 或 4/16 14:30'); return; }
      SBupdate(function (v) {
        if (!v.sb || !v.sb.game) return v;
        if (newTime != null) v.sb.game.time = newTime;
        if (targetDay != null) {
          var diff = targetDay - (v.sb.game.day || 1);
          v.sb.game.day = targetDay;
          if (diff > 0 && v.sb.wallet && Array.isArray(v.sb.wallet.bills)) {   // 前进→账单倒计时同步减（和 advanceDays 一致）
            v.sb.wallet.bills.forEach(function (b) { b.days_left = (b.days_left != null ? b.days_left : 30) - diff; if (b.days_left <= 5) b.urgent = true; });
          }
        }
        return v;
      });
      if (state && state.game) { if (newTime != null) state.game.time = newTime; if (targetDay != null) state.game.day = targetDay; }
      var parts = [];
      if (targetDay != null) parts.push('📅 ' + fmtMDWeekdayCN(targetDay));
      if (newTime != null) parts.push('🕒 ' + newTime);
      toast('success', '已校准到 ' + parts.join(' ') + '（下一轮正文会读到）');
      render();
      if (currentPage === 'calendar') openCalendar();   // 从日历跳的话，刷新日历里的“今天”金格
    });
  }
  // 🖼️ 壁纸（UWU）：Base64 存本地，跟浏览器不跟聊天文件
  // 清晰度通过 CSS 变量 --sb-wp-opacity 控制（默认 0.85=柔和，1.0=完全清晰）
  // 清晰档(1.00)同时去掉 background-blend-mode overlay —— 壁纸原图直出，不叠纸色
  function applyWallpaper() {
    try {
      var wp = VIEW.localStorage.getItem('sbnyc_wallpaper');
      var scr = panel.querySelector('.sb-screen');
      if (!scr) return;
      var opacity = VIEW.localStorage.getItem('sbnyc_wallpaper_opacity') || '0.85';
      scr.style.setProperty('--sb-wp-opacity', opacity);
      // 清晰档=去掉 overlay 混合，原图直出
      scr.style.backgroundBlendMode = (opacity === '1.00') ? 'normal' : 'overlay';
      if (wp) {
        scr.style.setProperty('--sb-wallpaper', 'url(' + wp + ')');
        scr.classList.add('has-wallpaper');
      } else {
        scr.classList.remove('has-wallpaper');
        scr.style.removeProperty('--sb-wallpaper');
        scr.style.backgroundBlendMode = '';   // 没壁纸时恢复 CSS 默认
      }
    } catch (e) {}
  }
  function totalUnread() {
    if (!state || !state.npcs) return 0;
    var n = 0; for (var k in state.npcs) { if (state.npcs.hasOwnProperty(k)) n += (state.npcs[k].unread || 0); }
    return n;
  }
  function updateBadge() {
    var n = totalUnread();
    badgeEl.style.display = n > 0 ? 'flex' : 'none';
    badgeEl.textContent = n > 9 ? '9+' : String(n);
  }
  function refreshView() {
    loadState();
    updateBadge();
    applyWallpaper();
    // AI 歌单：变量里有就用，没有就请求生成一次（垫场歌单先顶着）
    if (state && Array.isArray(state.playlist) && state.playlist.length >= 4) {
      PLAYLIST = state.playlist;
    } else if (state && !plRequested) {
      plRequested = true;
      SBemit('sb_request_playlist');
    }
    fetchPool();   // 橱窗池顺手保鲜（10分钟节流，关联机则直接返回）
    if (!state) {
      root.innerHTML = '<div class="sb-wait">⏳ 等待游戏数据<br>先在开场消息里填表并提交<br><span style="font-size:10px">（提交后金主们的第一批私信会自动进来）</span></div>';
      return;
    }
    if (chatEl.style.display !== 'none' && currentChatName && state.npcs && state.npcs[currentChatName]) {
      openChat(currentChatName, state.npcs[currentChatName]);   // 聊天页开着 → 重渲染显示新回应
    } else if (chatEl.style.display !== 'none' && currentPage === 'settings') {
      // 设置页开着别重渲染——会吹掉正在输入的 API key
    } else if (chatEl.style.display !== 'none' && currentPage) {
      reopenPage();                                              // 论坛/Elite 开着 → 重渲染（钱包变了/内容到了）
    } else {
      render();
    }
  }

  function render() {
    if (!state) return;
    var game = state.game || {}; var wallet = state.wallet || {}; var npcs = state.npcs || {};
    barEl.innerHTML = '<span>5G</span><span class="sb-bar-time" id="sb-bar-time-click" style="cursor:pointer;" title="点击校准游戏时间">' + esc(game.time || nowT()) + '</span><span>76% <span class="sb-gear" id="sbnyc-night" title="夜间/白天">' + (panel.classList.contains('night') ? '☀️' : '🌙') + '</span> <span class="sb-gear" id="sbnyc-gear" title="手机设置">⚙</span></span>';   // ⏱ 时间可点校准（UWU）
    var h = '';
    h += renderWallet(wallet);
    h += renderActions();
    // 有攒着没发的消息 → 主页顶部醒目横条：一键让所有排队的人回复（替代找不到的浮动胶囊）
    var oc = outboxCount();
    if (oc > 0) h += '<div class="sb-sendall"><span class="sa-badge">' + oc + '</span><span class="sa-txt">📨 发送并让大家回复</span></div>';
    h += renderSchedule(state.schedule || []);
    h += renderDMList(npcs);
    h += renderBillAlerts(wallet);
    if (!Object.keys(npcs).length) h += '<div class="sb-empty">No messages yet. Your story is about to begin.</div>';
    root.innerHTML = h;
    bindMain(npcs);
  }

  function renderWallet(w) {
    var bal = w.balance != null ? w.balance : 0; var bills = w.bills || []; var txs = w.transactions || [];
    var h = '<div class="sb-wallet"><div class="sb-wt">💳 Wallet</div><div class="sb-wbal">' + fmtUSD(bal) + '</div>';
    if (bills.length) {
      h += '<div class="sb-wsec">Bills Due</div>';
      for (var i = 0; i < bills.length; i++) {
        var b = bills[i];
        var dl = b.days_left != null ? b.days_left : 30;
        var u = b.urgent || dl <= 5;
        var dueTxt = dl > 0 ? dl + 'd' : (dl === 0 ? '今天到期' : '逾期' + (-dl) + 'd');
        h += '<div class="sb-bill' + (u ? ' urgent' : '') + '"><span>' + esc(b.name) + '</span><span>' + fmtUSD(b.amount) + ' \xB7 ' + dueTxt + (u ? ' ⚠️' : '') + ' <span class="sb-paybill" data-bi="' + i + '" title="现在付掉这张账单，下期30天后">💸付</span></span></div>';
      }
    }
    if (txs.length) { h += '<div class="sb-wsec">Recent</div>'; var s = txs.slice(-5).reverse(); for (var j = 0; j < s.length; j++) { var t = s[j]; var c = t.direction === '+' ? 'plus' : 'minus'; h += '<div class="sb-tx"><span class="sb-tx-a ' + c + '">' + t.direction + fmtUSD(t.amount) + '</span><span class="sb-tx-w">' + esc(t.counterparty) + '</span><span class="sb-tx-n">' + esc(t.note || '') + '</span></div>'; } }
    h += '</div>'; return h;
  }
  function renderActions() {
    return '<div class="sb-actions"><button class="sb-abtn" data-act="refresh">🔄 刷新</button><button class="sb-abtn" data-act="forum">🌐 论坛</button><button class="sb-abtn" data-act="elite">✦ Elite</button><button class="sb-abtn" data-act="closet">👗 衣橱</button></div>' +
      '<div class="sb-actions"><button class="sb-abtn" data-act="calendar">📅 日历</button><button class="sb-abtn" data-act="trans">💳 流水</button></div>';   // 第二行（UWU 的两个新页面）
  }
  function renderDMList(npcs) {
    var entries = []; for (var n in npcs) { if (!npcs.hasOwnProperty(n)) continue; var npc = npcs[n]; if (!npc.unlocked && !npc.persistent && (npc.unread || 0) <= 0 && !npc.engaged) continue; if (npc.muted && !(npc.dm_history && npc.dm_history.length) && (npc.unread || 0) <= 0 && !npc.engaged) continue; entries.push(npc); }
    // ➕ 新私信常驻标题栏：不在列表里的人（David/神父这种没主动来过的）也能被你先撩
    var head = '<div class="sb-sec" style="display:flex;justify-content:space-between;align-items:center;">iMessage<span class="sb-newdm" id="sbnyc-new-dm">➕ 新私信</span></div>';
    if (!entries.length) return head;
    // 微信式：📌置顶的在最上（带淡底色），其余按最新消息排（老的时分字符串做兜底）
    entries.sort(function (a, b) {
      var pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      var ta = a.last_ts || 0, tb = b.last_ts || 0;
      if (ta !== tb) return tb - ta;
      return (b.last_contact || '').localeCompare(a.last_contact || '');
    });
    var h = head + '<div class="sb-dm">';
    for (var i = 0; i < entries.length; i++) {
      var npc = entries[i]; var seRow = npc.name === 'SugarElite™';
      var ini = seRow ? '✦' : ((npc.name.replace(/[^A-Za-z一-鿿]/g, '')[0] || '\xB7').toUpperCase());
      var ur = npc.unread > 0 ? ' unread' : '';
      h += '<div class="sb-dmrow' + ur + (seRow ? ' se' : '') + (npc.pinned ? ' pinned' : '') + '" data-name="' + esc(npc.name) + '"><span class="sb-ava">' + esc(ini) + '</span><div class="sb-dmbody"><div class="sb-dmtop"><b>' + esc(npc.name) + (npc.pinned ? ' 📌' : '') + '</b><em>' + esc(npc.last_contact || '') + '</em></div>';
      if (npc.archetype) h += '<div class="sb-dmtags">' + esc(npc.archetype) + '</div>';
      h += '<div class="sb-dmlast">' + esc(npc.last_message || '') + '</div></div>';
      if (npc.unread > 0) h += '<span class="sb-badge">' + npc.unread + '</span>';
      h += '</div>';
    }
    h += '</div>'; return h;
  }
  // 📅 行程 todolist（User 许愿的交互）：左边⭕打勾完成、点文字=编辑、右边✕=删除；私信约好的事自动进来
  function renderSchedule(sch) {
    var h = '<div class="sb-sec">Schedule · 行程</div><div style="margin:0 12px 8px;">';
    if (!sch.length) {
      h += '<div class="sb-empty" style="padding:4px 8px;">暂无行程——私信里约好的事会自动记到这里</div>';
    } else {
      for (var i = 0; i < sch.length && i < 6; i++) {
        var it = sch[i];
        h += '<div class="sb-bill sb-sched' + (it.done ? ' done' : '') + '">' +
          '<span class="sb-schk" data-si="' + i + '" title="' + (it.done ? '取消打勾' : '完成打勾') + '">' + (it.done ? '✅' : '⭕') + '</span>' +
          '<span class="sb-stxt" data-si="' + i + '" title="点击编辑">' + (it.academic ? '📚 ' : '📅 ') + esc(it.txt) + '</span>' +
          '<span class="sb-sdel" data-si="' + i + '" title="删除">✕</span></div>';
      }
      if (sch.length > 6) h += '<div class="sb-empty" style="padding:2px;">还有 ' + (sch.length - 6) + ' 条…</div>';
    }
    h += '<button class="sb-abtn" id="sbnyc-sched-add" style="width:100%;margin-top:6px;">＋ 手动加一条</button></div>';
    return h;
  }
  function schedUpdate(i, fn) {   // 变量+本地镜像一起改，改完重画
    SBupdate(function (v) { if (v.sb && Array.isArray(v.sb.schedule) && v.sb.schedule[i]) fn(v.sb.schedule, i); return v; });
    if (state && Array.isArray(state.schedule) && state.schedule[i]) fn(state.schedule, i);
    render();
  }
  function renderBillAlerts(w) {
    var bills = w.bills || []; var urgent = bills.filter(function (b) { return b.urgent || b.days_left <= 5; });
    if (!urgent.length) return '';
    var h = ''; for (var i = 0; i < urgent.length; i++) { h += '<div class="sb-toast"><div class="sb-toast-h">⚠️ Bill Alert</div>' + esc(urgent[i].name) + ' ' + fmtUSD(urgent[i].amount) + ' — ' + urgent[i].days_left + ' days left</div>'; }
    return h;
  }

  function bindMain(npcs) {
    var sa = root.querySelector('.sb-sendall');
    if (sa) sa.addEventListener('click', function () { flushOutbox(); render(); });
    var nd = root.querySelector('#sbnyc-new-dm');
    if (nd) nd.addEventListener('click', openContacts);
    // 💸 付账单：扣款 + 倒计时重置下期30天（余额不够 debit 自己会拦并提示）
    var pbs = root.querySelectorAll('.sb-paybill');
    for (var pb = 0; pb < pbs.length; pb++) {
      (function (el) {
        el.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var bi = parseInt(el.getAttribute('data-bi'), 10);
          var bill = (state && state.wallet && state.wallet.bills || [])[bi];
          if (!bill) return;
          var ok = true;
          try { ok = (DOC.defaultView || window).confirm('付掉「' + bill.name + '」 ' + fmtUSD(bill.amount) + '？\n（下期账单 30 天后再来）'); } catch (e) {}
          if (!ok) return;
          if (!debit(bill.amount, bill.name, '账单')) return;
          SBupdate(function (v) {
            var bb = v.sb && v.sb.wallet && v.sb.wallet.bills && v.sb.wallet.bills[bi];
            if (bb && bb.name === bill.name) { bb.days_left = 30; bb.urgent = false; }
            return v;
          });
          bill.days_left = 30; bill.urgent = false;
          toast('success', '🧾 ' + bill.name + ' 已付清——下期 30 天后');
          SBemit('sb_updated');
          render();
        });
      })(pbs[pb]);
    }
    var rows = root.querySelectorAll('.sb-dmrow');
    for (var i = 0; i < rows.length; i++) { (function (r) { r.addEventListener('click', function () { var n = r.getAttribute('data-name'); if (n && npcs[n]) openChat(n, npcs[n]); }); })(rows[i]); }
    var btns = root.querySelectorAll('.sb-abtn');
    for (var j = 0; j < btns.length; j++) { (function (b) { b.addEventListener('click', function () {
      var a = b.getAttribute('data-act');
      if (a === 'refresh') {
        SBemit('sb_request_dm', { reason: '玩家刷新手机，看看有没有新消息' });
        b.textContent = '⏳ 生成中…'; setStatus('⏳ 正在生成私信…');
        setTimeout(function () { b.textContent = '🔄 刷新'; }, 8000);
      }
      else if (a === 'forum') openForum();
      else if (a === 'elite') openElite();
      else if (a === 'closet') openCloset();
      else if (a === 'calendar') openCalendar();
      else if (a === 'trans') openTransactions();
    }); })(btns[j]); }
    // 行程 todolist：⭕/✅打勾切换、点文字编辑、✕直接删（都不弹确认，误删了让TA重加——手机上确认框比误删烦）
    var chks = root.querySelectorAll('.sb-schk');
    for (var ck = 0; ck < chks.length; ck++) {
      (function (el) {
        el.addEventListener('click', function () {
          schedUpdate(parseInt(el.getAttribute('data-si'), 10), function (arr, i) { arr[i].done = !arr[i].done; });
        });
      })(chks[ck]);
    }
    var stxts = root.querySelectorAll('.sb-stxt');
    for (var st = 0; st < stxts.length; st++) {
      (function (el) {
        el.addEventListener('click', function () {
          var i0 = parseInt(el.getAttribute('data-si'), 10);
          var it0 = (state.schedule || [])[i0];
          if (!it0) return;
          panelPrompt('编辑行程', it0.txt).then(function (nv) {
            nv = (nv || '').trim().slice(0, 40);
            if (!nv || nv === it0.txt) return;
            var nd = schedTextToGameDay(nv);   // 改了"周五"→"周六"这类，日期跟着挪
            schedUpdate(i0, function (arr, i) { arr[i].txt = nv; if (!arr[i].academic) arr[i].gameDay = nd; });
          });
        });
      })(stxts[st]);
    }
    var sdels = root.querySelectorAll('.sb-sdel');
    for (var sd = 0; sd < sdels.length; sd++) {
      (function (el) {
        el.addEventListener('click', function () {
          var i1 = parseInt(el.getAttribute('data-si'), 10);
          var it1 = (state.schedule || [])[i1];
          schedUpdate(i1, function (arr, i) { arr.splice(i, 1); });
          if (it1) toast('info', '🗑 已删行程：' + it1.txt);
        });
      })(sdels[sd]);
    }
    var sadd = root.querySelector('#sbnyc-sched-add');
    if (sadd) sadd.addEventListener('click', function () {
      panelPrompt('输入行程（如：4/18 / 19:00 / 地点 / 和谁·干嘛，日期也可写 周五）', '').then(function (txt) {
        txt = (txt || '').trim().slice(0, 60);
        if (!txt) return;
        var evDay = schedTextToGameDay(txt);   // 落在事件发生那天，不是添加那天（修串时间）
        SBupdate(function (v) {
          if (!v.sb) return v;
          if (!Array.isArray(v.sb.schedule)) v.sb.schedule = [];
          v.sb.schedule.push({ txt: txt, ts: Date.now(), gameDay: evDay });
          if (v.sb.schedule.length > 20) v.sb.schedule = v.sb.schedule.slice(-20);
          return v;
        });
        if (!Array.isArray(state.schedule)) state.schedule = [];
        state.schedule.push({ txt: txt, ts: Date.now(), gameDay: evDay });
        render();
      });
    });
  }

  // ── 联机层（Supabase 直连，动森同款零后端） ──
  // 隐私边界：读（橱窗池/排行榜）是匿名 GET，默认开；写只有一处 = 玩家主动点「更新我的排名」，
  // 且只上传 马甲+余额数字。私信、剧情、人设永远不上传。设置里可一键全关（全关后卡零网络请求）。
  var DEFAULT_SERVER = 'https://hieylivlsdmyznviumht.supabase.co';
  var DEFAULT_KEY = 'sb_publishable_MH80Xnlm1oHli6UXwzRpNA_EsC1DnCO';
  function onlineCfg() {
    var c = {};
    try { var raw = VIEW.localStorage.getItem('sbnyc_online'); if (raw) c = JSON.parse(raw) || {}; } catch (e) {}
    return { off: !!c.off, server: c.server || '', key: c.key || '', handle: c.handle || '', token: c.token || '', blurb: c.blurb || '' };
  }
  function saveOnlineCfg(c) { try { VIEW.localStorage.setItem('sbnyc_online', JSON.stringify(c)); } catch (e) {} }
  function normSrvUrl(u) { return String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''); }   // 动森的坑：玩家手滑贴 /rest/v1 进来
  async function srvFetch(path, opts) {
    var c = onlineCfg();
    var url = normSrvUrl(c.server) || DEFAULT_SERVER;
    var key = c.server ? (c.key || DEFAULT_KEY) : DEFAULT_KEY;
    var headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
    if (opts && opts.prefer) headers['Prefer'] = opts.prefer;
    var resp = await fetch(url + '/rest/v1/' + path, {
      method: (opts && opts.method) || 'GET',
      headers: headers,
      body: (opts && opts.body) ? JSON.stringify(opts.body) : undefined,
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var txt = await resp.text();
    return txt ? JSON.parse(txt) : null;
  }

  // 橱窗池：User 在服务器囤货，每个玩家在自己的时刻捞到（漂流瓶制，不是广播）
  var _pool = null, _poolAt = 0, _windfall = 0;
  async function fetchPool(force) {
    if (onlineCfg().off) return;
    if (!force && _pool && Date.now() - _poolAt < 10 * 60 * 1000) return;
    _poolAt = Date.now();   // 先记时间：失败也别每次刷新都重试轰炸
    try {
      var rows = await srvFetch('lux_drops?active=eq.true&order=created_at.desc&limit=60');
      if (Array.isArray(rows)) { _pool = rows; console.log('[SB-NYC v4] lux pool: ' + rows.length + ' items'); }
    } catch (e) { console.warn('[SB-NYC v4] lux pool fetch failed', e); }
  }
  // ── 奢华体验橱窗（服务器 sb_experiences 表，作者亲自填剧本种子）──
  // 和 lux_drops 同为漂流瓶制：作者往表里写体验，玩家在 Elite 页捞到、下单、点开始 → 把作者写的 seed 注入正文，主线AI对着写整段旅程
  var _exps = null, _expsAt = 0;
  async function fetchExperiences(force) {
    if (onlineCfg().off) return;
    if (!force && _exps && Date.now() - _expsAt < 10 * 60 * 1000) return;
    _expsAt = Date.now();
    try {
      var rows = await srvFetch('sb_experiences?active=eq.true&order=created_at.desc&limit=40');
      if (Array.isArray(rows)) { _exps = rows; console.log('[SB-NYC v4] experiences: ' + rows.length); }
    } catch (e) { console.warn('[SB-NYC v4] experiences fetch failed', e); }
  }
  // 服务器空/离线时的内置兜底（三条，保证功能永远能演示）——字段和服务器表一致
  var EXP_FALLBACK = [
    { id: 'f1', title: '直升机送你去 Montauk 看日出', location: 'Manhattan → Montauk', price: 6500, image_url: '',
      blurb: '天没亮就出发，螺旋桨声盖过一切', seed: '清晨四点，一辆车在楼下等，司机只说了句"先生安排好了"。直升机从曼哈顿直飞 Montauk 灯塔，你在两千英尺高空看太阳从大西洋里爬出来。落地后海边早餐已经摆好，没有别人。写这段：出发的黑暗、升空时城市在脚下缩小、日出砸进海面的那一刻、以及这是谁安排的、他为什么不亲自来。' },
    { id: 'f2', title: 'Aman 私人 Spa 闭店包场一夜', location: 'Aman New York', price: 4200, image_url: '',
      blurb: '整层楼今晚只为你一个人开灯', seed: '整个 Aman 的 spa 层今晚闭店，只留给你一个人。哈曼浴、九十分钟的四手按摩、温泉池上方是曼哈顿的夜景。芳疗师退下后，只剩水声和城市的光。写这段：空无一人的奢华、身体一寸寸被松开的过程、独处时浮上来的念头、这份安排背后没说出口的意思。' },
    { id: 'f3', title: '闭馆后的大都会博物馆私人导览', location: 'The Met', price: 8000, image_url: '',
      blurb: '五点闭馆，五点半这里只有你和一位策展人', seed: '大都会博物馆闭馆后，为你一个人开灯。一位策展人带你穿过空无一人的埃及馆、欧洲绘画厅，讲那些白天被人群挡住的细节。脚步声在大理石上回响。写这段：被清空的博物馆的寂静与特权感、某一幅画前的停留、导览员之外那个安排这一切的人的存在感。' },
  ];
  // 已体验过的行程要从橱窗消失（按 id 记本地，和 seenLux 同理）
  function seenExp() { try { var r = VIEW.localStorage.getItem('sbnyc_exp_seen'); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
  function markExpSeen(id) {
    try { var s = seenExp(); if (s.indexOf(id) === -1) s.push(id); if (s.length > 200) s = s.slice(-200); VIEW.localStorage.setItem('sbnyc_exp_seen', JSON.stringify(s)); } catch (e) {}
  }
  function expPool() {
    var all = (_exps && _exps.length) ? _exps : EXP_FALLBACK;
    var seen = seenExp();
    return all.filter(function (x) { return seen.indexOf(String(x.id)) === -1; });   // 体验过的不再出现
  }

  function seenLux() { try { var r = VIEW.localStorage.getItem('sbnyc_lux_seen'); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
  function markLuxSeen(ids) {
    try {
      var s = seenLux().concat(ids);
      if (s.length > 60) s = s.slice(-60);
      VIEW.localStorage.setItem('sbnyc_lux_seen', JSON.stringify(s));
    } catch (e) {}
  }
  function pickTreats(n) {
    if (!_pool || !_pool.length) return [];
    var cand = _pool.slice();
    // 刚有大额到账 → 优先挑"买得起但要肉疼一下"的价位（到账数字的 20%~90%）
    if (_windfall > 0) {
      var fit = cand.filter(function (x) { return x.price > 0 && x.price <= _windfall * 0.9 && x.price >= _windfall * 0.2; });
      if (fit.length >= n) cand = fit;
    }
    var seen = seenLux();
    var fresh = cand.filter(function (x) { return seen.indexOf(x.id) === -1; });
    if (fresh.length >= n) cand = fresh;
    cand = cand.slice().sort(function () { return Math.random() - 0.5; });
    return cand.slice(0, n);
  }

  // 排行榜：分数 = 脚本直接读钱包余额，没有输入框，想编都没地方编
  var _rank = null, _rankAt = 0;
  async function fetchRank(force) {
    if (onlineCfg().off) return;
    if (!force && _rank && Date.now() - _rankAt < 5 * 60 * 1000) return;
    _rankAt = Date.now();
    try {
      var rows = await srvFetch('sb_rank?order=amount.desc&limit=100');   // 群众要求加位：25 → 干脆 100（瓶颈在这，不在渲染）
      if (Array.isArray(rows)) {
        _rank = rows;
        if (currentPage === 'board:sb') openBoard('sb');   // 榜单页开着 → 真人数据到了就重画
      }
    } catch (e) { console.warn('[SB-NYC v4] rank fetch failed', e); }
  }
  // 全服姐妹楼（sb_posts 表，动森论坛同款零后端）：楼主帖 + 回帖(parent_id)，读匿名，写用马甲
  var _gposts = null, _gpostsAt = 0;
  async function fetchGlobalPosts(force) {
    if (onlineCfg().off) return;
    // 节流 20s：够短=每次开楼基本都拉到最新（原本 5min，别人发的新帖要等五分钟才看得见）；
    // 又必须 >0=拉完会回调 openBoard('gossip')，而 openBoard 又调本函数，节流就是这条回环唯一的刹车。别改成 force。
    if (!force && _gposts && Date.now() - _gpostsAt < 20 * 1000) return;
    _gpostsAt = Date.now();
    try {
      var rows = await srvFetch('sb_posts?order=created_at.desc&limit=200');   // 楼太热，60条只够顶楼10个瓜（Akuma的帖被顶没了群众有意见）
      if (Array.isArray(rows)) {
        _gposts = rows;
        if (currentPage === 'board:gossip') openBoard('gossip');   // 姐妹楼开着 → 真人帖到了就重画
      }
    } catch (e) { console.warn('[SB-NYC v4] global posts fetch failed（表没建/联机关了都会走这里，不影响本体）', e); }
  }
  function renderGlobalPosts() {
    if (onlineCfg().off) return '';
    var h = '<div class="sb-sec" style="margin:16px 20px 6px;">🌍 全服姐妹楼 · 真人</div>';
    if (!_gposts) return h + '<div class="sb-empty">📡 拉取中…（一直空着=全服楼还没开张）</div>';
    var tops = _gposts.filter(function (x) { return !x.parent_id; }).slice(0, 30);   // 顶楼 10 → 30
    if (!tops.length) return h + '<div class="sb-empty">全服楼还空着——第一个吃螃蟹的可以是你（发帖时选「全服」）</div>';
    var meTok = onlineCfg().token;
    for (var i = 0; i < tops.length; i++) {
      var p = tops[i];
      var reps = _gposts.filter(function (x) { return x.parent_id === p.id; });
      var rH = '';
      for (var j = reps.length - 1; j >= 0; j--) rH += '<div class="sb-cmt"><b>@' + esc(reps[j].handle || '???') + '</b>' + esc(reps[j].content || '') + '</div>';
      rH += '<div class="sb-cmt-pull sb-greply" data-gid="' + p.id + '">💬 回一句</div>';
      h += '<div class="sb-post"><b>🌍 @' + esc(p.handle || '???') + (p.token === meTok ? ' ✦你' : '') + '</b><div class="pb">' + esc(p.content || '') + '</div><div class="pm">全服真人 · ' + (reps.length ? reps.length + ' 条回帖' : '还没人回') + '</div>' + rH + '</div>';
    }
    return h;
  }

  async function ensureIdentity() {
    var c = onlineCfg();
    if (!c.token) c.token = 'sbtok_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    if (!c.handle) {
      var h = await panelPrompt('给自己起个 SugarRank 论坛马甲（榜上显示这个，不是你的角色名，起一次跨聊天通用）', '');
      h = (h || '').trim().slice(0, 20);
      if (!h) return null;
      c.handle = h;
    }
    saveOnlineCfg(c);
    return c;
  }
  async function reportRank() {
    if (onlineCfg().off) { toast('info', '联机已关闭（⚙ 设置里可打开）'); return; }
    var c = await ensureIdentity();
    if (!c) { toast('info', '没起马甲，先不上榜'); return; }
    var bal = Math.round((state && state.wallet && state.wallet.balance) || 0);
    // 🏝️ 开曼制度（Fan 拍板）：榜单只统计"在岸资产"，超过 10 亿的部分自动转入离岸账户——
    // 不拒绝上传、不指控任何人，用世界观完成治理。想上传多少都行，榜上封顶 10 亿。
    var ONSHORE_CAP = 1000000000;
    var offshore = 0;
    if (bal > ONSHORE_CAP) { offshore = bal - ONSHORE_CAP; bal = ONSHORE_CAP; }
    // 上榜宣言：让真人也有自己的一句话（默认沿用上次；不填就用上次的或留空）
    var blurb = c.blurb || '';
    var b = await panelPrompt('给自己写一句上榜宣言（榜上显示，可炫可自嘲，留空则沿用上次）：', blurb);
    if (b !== null) blurb = String(b).trim().slice(0, 60);
    c.blurb = blurb; saveOnlineCfg(c);
    try {
      await srvFetch('sb_rank', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { token: c.token, handle: c.handle, amount: bal, blurb: blurb } });
      if (offshore > 0) toast('info', '🏝️ 应您的税务顾问建议，超出 $1B 的 ' + fmtUSD(offshore) + ' 已自动转入您的开曼群岛离岸账户。榜单仅展示在岸资产——低调，是顶级富豪最后的奢侈品。');
      toast('success', '⬆ 已上榜：' + c.handle + ' ' + fmtUSD(bal));
      await fetchRank(true);
    } catch (e) { toast('error', '上榜失败: ' + ((e && e.message) || e)); }
  }

  // ── 论坛 SugarRank™ + SugarElite™ 会刊 ──
  // 内容来自 dm_generator 的会刊生成器（一次调用打包生成，存 sb.mag）；
  // 私信刷新后自动补货，玩家点开时内容通常已就位，不用现场等。
  var BOARD_KEY = { sb: 'sbRank', sd: 'sdRank', gossip: 'gossip', trend: 'trend', abyss: 'abyss', recruit: 'recruit' };

  function pageHeader(title, sub, showRefresh) {
    return '<div class="sb-ch"><button class="sb-ch-back">‹</button><div class="sb-ch-name"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></div>' +
      (showRefresh ? '<button class="sb-ch-del sb-pg-rf" title="刷新本期内容">🔄</button>' : '') + '</div>';
  }
  function bindPageChrome(backFn, onRefresh, sections) {
    var bk = chatEl.querySelector('.sb-ch-back'); if (bk) bk.addEventListener('click', backFn || closeChat);
    var rf = chatEl.querySelector('.sb-pg-rf');
    if (rf) rf.addEventListener('click', function () {
      rf.textContent = '⏳';                                   // 立刻给反馈——要调一次AI，不是点了没用
      setStatus(sections && sections.length ? '📰 只重烤这一版…（小调用，快）' : '📰 烤新一期中…（一次AI调用，限速时更久）');
      SBemit('sb_request_mag', { force: true, sections: sections || null });   // 带 sections=单版块重烤，不带=全刊
      if (onRefresh) onRefresh();                             // 页面自带的额外刷新（如 SB 榜强制拉服务器真人数据）
    });
  }
  function magOf() { return (state && state.mag) || null; }
  function askMag() { SBemit('sb_request_mag', {}); }
  function reopenPage() {
    if (currentPage === 'forum') openForum();
    else if (currentPage === 'elite') openElite();
    else if (currentPage === 'closet') openCloset();
    else if (currentPage === 'calendar') openCalendar();
    else if (currentPage === 'transactions') openTransactions();
    else if (currentPage && currentPage.indexOf('board:') === 0) openBoard(currentPage.slice(6));
  }
  // 系统权威扣款（买东西/订阅走这里，不靠主线 LLM 记账；主线消息里注明"已付款"防止它再补记）
  function debit(amount, what, channel) {
    var bal = (state && state.wallet && state.wallet.balance) || 0;
    if (amount > bal) { toast('warning', '💸 余额不够（' + fmtUSD(bal) + '）——先去挣'); return false; }
    SBupdate(function (v) {
      if (!v.sb) return v;
      if (!v.sb.wallet) v.sb.wallet = { balance: 0, bills: [], transactions: [] };
      var w = v.sb.wallet;
      w.balance = (w.balance || 0) - amount;
      if (!w.transactions) w.transactions = [];
      w.transactions.push({ direction: '-', amount: amount, counterparty: what, channel: channel || '', note: '', time: nowT() });
      if (w.transactions.length > 20) w.transactions = w.transactions.slice(-20);
      // 总账（UWU 流水页）：手机侧扣款也要进全量账本，不然流水页只有生成器那头的钱
      if (!Array.isArray(w.allTransactions)) w.allTransactions = [];
      w.allTransactions.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        direction: '-', amount: amount, counterparty: what, channel: channel || '', note: '',
        time: nowT(), gameDay: (v.sb.game && v.sb.game.day) || 1,
      });
      if (w.allTransactions.length > 500) w.allTransactions = w.allTransactions.slice(-500);
      return v;
    });
    // updateVariablesWith 是异步的，本地镜像同步改（openChat 清未读同款手法）
    if (state && state.wallet) {
      state.wallet.balance = (state.wallet.balance || 0) - amount;
      if (!state.wallet.transactions) state.wallet.transactions = [];
      state.wallet.transactions.push({ direction: '-', amount: amount, counterparty: what, channel: channel || '', note: '', time: nowT() });
    }
    // 消费也进「手机动态」楼层（开关关着时生成器那头会直接忽略）
    SBemit('sb_floor_log', { lines: ['💳〔' + nowT() + '〕-' + fmtUSD(amount) + ' · ' + what] });
    return true;
  }
  // 买到的东西进衣橱（sb.closet）→ 注入主线摘要，AI 写她出场时真的会穿戴用上；之后还能出二手
  function addCloset(item) {
    SBupdate(function (v) {
      if (!v.sb) return v;
      if (!Array.isArray(v.sb.closet)) v.sb.closet = [];
      v.sb.closet.push(item);
      if (v.sb.closet.length > 60) v.sb.closet = v.sb.closet.slice(-60);
      return v;
    });
    if (state) { if (!Array.isArray(state.closet)) state.closet = []; state.closet.push(item); }
  }
  // 体验类（晚餐/酒店/SPA/行程…）是消耗品，不进衣橱——不然衣橱里会出现"二手露台晚餐"
  var EXP_RE = /晚餐|午餐|早午餐|晚宴|下午茶|brunch|dinner|lunch|omakase|tasting|餐厅|酒店|套房|suite|民宿|机票|头等舱|航班|旅行|之旅|行程|度假|villa|retreat|spa|护理|按摩|理疗|医美|热玛吉|botox|水光|课程|私教|门票|演出|音乐会|秀场|前排|包厢|体验|预演|预展|派对|party|游艇|直升机|夜|芭蕾|ballet|歌剧|opera|骑马|马术|马球|polo|高尔夫|golf|网球|tennis|滑雪|ski|帆船|划船|出海|湖边|别墅|庄园|射击|击剑|动物园/i;
  function isExperience(n) { return EXP_RE.test(String(n || '')); }
  // 购物分两路（User 定稿）：实物 → 扣款直接入衣橱，不打扰主线（AI 通过衣橱摘要知道她拥有什么）；
  // 体验 → 扣款后把开头填进正文输入框，玩家补充后自己发送，AI 接着写这段体验。没有隐形空消息那回事了。
  function purchase(name, price, channel, img, forceExp) {
    var exp = forceExp || isExperience(name);
    var ok = true;
    try { ok = (DOC.defaultView || window).confirm((price > 0 ? '花 ' + fmtUSD(price) + ' ' : '') + '拿下「' + name + '」？' + (exp ? '\n（付款后填进正文输入框，补充细节发送，AI 接着写这段体验）' : '\n（付款后直接入衣橱）')); } catch (e) {}
    if (!ok) return;
    if (price > 0 && !debit(price, name, channel)) return;
    if (!exp) {
      addCloset({ name: name, price: price, from: channel, img: img || '', time: nowT() });
      toast('success', '👗 ' + name + ' 已入衣橱' + (price > 0 ? '（-' + fmtUSD(price) + '）' : ''));
    } else if (price > 0) {
      toast('success', '💳 -' + fmtUSD(price) + ' ' + name);
    }
    SBemit('sb_updated');
    if (exp) {
      fillMainInput('我去了预订好的「' + name + '」' + (price > 0 ? '（' + fmtUSD(price) + ' 已付）' : '') + '。');
      panel.classList.remove('open');
    }
  }
  // 奢华体验下单：扣钱 → 把作者写的剧本种子(seed)注入正文输入框 → 主线AI对着写整段旅程
  // 和普通体验购买(purchase)的区别：普通的只填一句"我去了X"，这个填的是作者手写的一整段场景引导
  function buyExperience(exp) {
    if (!exp) return;
    var price = parseInt(exp.price, 10) || 0;
    var ok = true;
    try { ok = (DOC.defaultView || window).confirm((price > 0 ? '花 ' + fmtUSD(price) + ' ' : '') + '开启体验「' + exp.title + '」？\n（付款后剧本会填进正文输入框，你可以补充细节再发送，AI 接着把这段旅程写出来）'); } catch (e) {}
    if (!ok) return;
    if (price > 0 && !debit(price, exp.title, 'SugarElite体验')) return;
    markExpSeen(String(exp.id));   // 体验过 → 从橱窗消失
    toast('success', '✨ 体验已开启 · ' + (price > 0 ? '-' + fmtUSD(price) : '免费'));
    SBemit('sb_updated');
    // 注入输入框（不代发）：留一个"和谁去"的空让玩家自己填——单独去/带某个金主/带闺蜜都行
    var head = '【开启预订体验】' + exp.title + (exp.location ? '（' + exp.location + '）' : '') + (price > 0 ? '，' + fmtUSD(price) + ' 已付' : '') + '。我打算和【　　】一起去（不想带人就删掉这句，写你想怎么开始）。';
    var seed = exp.seed ? ('\n' + exp.seed) : '';
    fillMainInput(head + seed);
    panel.classList.remove('open');
  }
  // 🔗 商品链接转发：圈内心照不宣的"买给我"——挑个联系人，链接进TA的待发队列，点发送看TA上不上道
  function sendProductLink(who, prodName, price) {
    var text = '🔗 [转发商品] ' + prodName + (price > 0 ? ' —— ' + fmtUSD(price) : '') + '（SugarElite 商城）';
    var t = nowT();
    SBupdate(function (v) {
      if (!v.sb || !v.sb.npcs || !v.sb.npcs[who]) return v;
      var n = v.sb.npcs[who];
      if (!n.dm_history) n.dm_history = [];
      n.dm_history.push({ sender: 'USER', time: t, ts: Date.now(), type: 'text', content: text, note: '', gameDay: (v.sb.game && v.sb.game.day) || 1 });
      if (n.dm_history.length > 400) n.dm_history = n.dm_history.slice(-400);
      n.engaged = true; n.muted = false; n.last_ts = Date.now(); n.last_contact = t;
      n.last_message = lastPreview({ sender: 'USER', type: 'text', content: text });
      return v;
    });
    var m0 = state && state.npcs && state.npcs[who];
    if (m0) {
      if (!m0.dm_history) m0.dm_history = [];
      m0.dm_history.push({ sender: 'USER', time: t, ts: Date.now(), type: 'text', content: text, note: '', gameDay: (state && state.game && state.game.day) || 1 });
      m0.engaged = true; m0.muted = false; m0.last_ts = Date.now(); m0.last_contact = t;
      m0.last_message = lastPreview({ sender: 'USER', type: 'text', content: text });
    }
    queueOutbox(who, text);
    SBemit('sb_updated');
    toast('success', '🔗 已转发给 ' + who + '——去TA的聊天页点「发送」，看TA上不上道');
  }
  // 联系人选择器（复用长按菜单样式）：按最近活跃排前10
  function pickContact(cb) {
    var npcs = (state && state.npcs) || {};
    var keys = Object.keys(npcs)
      .filter(function (k) { return npcs[k].unlocked !== false; })
      .sort(function (a, b) { return (npcs[b].last_ts || 0) - (npcs[a].last_ts || 0); })
      .slice(0, 10);
    if (!keys.length) { toast('info', '还没有联系人可以转发'); return; }
    closeMsgMenu();
    var menu = DOC.createElement('div');
    menu.className = 'sb-msgmenu';
    menu.style.left = '24px'; menu.style.right = '24px'; menu.style.top = '18%';
    var mh = '<div style="padding:8px 13px;font-size:11px;color:var(--ink-faint);letter-spacing:1px;">发给谁？（圈内都懂这是什么意思）</div>';
    for (var i = 0; i < keys.length; i++) {
      var np = npcs[keys[i]];
      mh += '<button data-pick="' + esc(np.name) + '">' + esc(np.name) + (np.archetype ? ' <span style="opacity:.5;font-size:10px;">' + esc(np.archetype) + '</span>' : '') + '</button>';
    }
    mh += '<button data-pick="">✕ 算了</button>';
    menu.innerHTML = mh;
    panel.appendChild(menu);
    menu.addEventListener('click', function (e) {
      var pk = e.target && e.target.closest && e.target.closest('[data-pick]');
      if (!pk) return;
      var who = pk.getAttribute('data-pick');
      closeMsgMenu();
      _msgMenu = null;
      if (who) cb(who);
    });
    _msgMenu = menu;
  }
  function bindFwdButtons(scopeEl) {
    var fbs = scopeEl.querySelectorAll('.sb-fwd');
    for (var i = 0; i < fbs.length; i++) {
      (function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();   // 同 🔗 菜单：拦住冒泡，防"点菜单外=收菜单"监听把刚开的选择器秒关
          var n = b.getAttribute('data-n') || '';
          var p = parseInt(b.getAttribute('data-p'), 10) || 0;
          if (n) pickContact(function (who) { sendProductLink(who, n, p); });
        });
      })(fbs[i]);
    }
  }
  function bindBuyButtons(scopeEl, channel, forceExp) {
    var btns = scopeEl.querySelectorAll('.sb-buy');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          purchase(b.getAttribute('data-n') || '', parseInt(b.getAttribute('data-p'), 10) || 0, channel, b.getAttribute('data-img') || '', !!forceExp);
        });
      })(btns[i]);
    }
  }

  function openForum() {
    currentPage = 'forum';
    var mag = magOf();
    function cnt(k) { var a = mag && mag[BOARD_KEY[k]]; return (a && a.length) ? a.length + ' 条' : '…'; }
    var h = pageHeader('SugarRank™', 'NYC underground forum', true);
    h += '<div class="sb-msgs" style="display:block;">';
    var boards = [
      ['sb', '👑', 'Sugar Baby 排行榜', '本月捞金榜 · 你也在榜上'],
      ['sd', '💼', 'Sugar Daddy 排行榜', '出手阔绰榜 · 圈内风评'],
      ['gossip', '☕', 'Community Gossip', '圈内八卦 · 避雷 · 吃瓜'],
      ['trend', '📈', '本季 Trend', '姐妹们在晒什么 · 种草即拔草'],
      ['abyss', '🕳️', '深渊区', '里 BBS · 不要问，问就是不知道'],
      ['recruit', '📋', '招聘版', 'SB/SD 互招 · 发帖自荐，会有人私信你'],
    ];
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i];
      h += '<div class="sb-forow" data-board="' + b[0] + '" style="cursor:pointer;"><span class="fi">' + b[1] + '</span><div class="fb"><b>' + b[2] + '</b><small>' + b[3] + '</small></div><span class="sb-soon">' + cnt(b[0]) + '</span></div>';
    }
    if (!mag) h += '<div class="sb-empty">📡 本期内容拉取中…第一次要等它烤好</div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(closeChat);
    if (!mag) askMag();
    var rows = chatEl.querySelectorAll('.sb-forow[data-board]');
    for (var j = 0; j < rows.length; j++) {
      (function (r) {
        r.addEventListener('click', function () {
          if (!magOf()) { setStatus('📰 内容还在生成中…'); askMag(); return; }
          openBoard(r.getAttribute('data-board'));
        });
      })(rows[j]);
    }
  }

  function openBoard(key) {
    currentPage = 'board:' + key;
    var mag = magOf() || {};
    var body = '', title = '', sub = '';
    if (key === 'sb') {
      title = '👑 Sugar Baby 榜'; sub = 'this month · SugarRank™';
      fetchRank();   // 异步拉真人榜，到货自动重画本页
      var list = (mag.sbRank || []).slice();
      var meTok = onlineCfg().token;
      var live = (_rank || []).filter(function (x) { return x.token !== meTok; });
      // 名字原样全显（User 定稿：多长都别截）；名字列里混进宣言那是数据的事，显示不背锅
      for (var li = 0; li < live.length; li++) list.push({ name: live[li].handle || '???', amount: live[li].amount || 0, blurb: (live[li].blurb && String(live[li].blurb).trim()) ? live[li].blurb : '全服玩家 · 真的在捞', live: true });
      var meName = (state && state.profile && (state.profile.name_en || state.profile.name_cn)) || 'You';
      // 本地"你"这行和「更新我的排名」上传的是同一个数：钱包余额（别用流水合计，两个数对不上=看起来永远没更新）
      // 自己的宣言自己也要看得到（bug：这行以前写死占位文案，别人在榜上看得到你的宣言，你自己反而看不到）
      var myBlurb = String(onlineCfg().blurb || '').trim();
      var myBal = Math.round((state && state.wallet && state.wallet.balance) || 0);
      list.push({ name: meName, amount: myBal, blurb: myBlurb || '—— 就是你。数字是真的。', you: true });
      // Akuma 的榜单身家用影子分数（和你余额可比 → 能超过、能被反超）；本地临时估一份免得没初始化时她消失
      var akAmt = (state && state.akumaRank) || Math.max(120000, myBal * 4);
      var akFound = false;
      for (var ak = 0; ak < list.length; ak++) { if (/akuma/i.test(list[ak].name)) { list[ak].amount = akAmt; list[ak].akuma = true; akFound = true; } }
      if (!akFound) list.push({ name: 'Akuma', amount: akAmt, blurb: '论坛人气王 · 常年霸榜', akuma: true });
      list.sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); });
      body += '<div style="display:flex;margin:0 12px 10px;"><button class="sb-abtn" id="sbnyc-rank-up" style="flex:1;">⬆ 更新我的排名（读取余额上榜）</button></div>';
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        body += '<div class="sb-rank' + (r.you ? ' you' : '') + '"><span class="rn">' + (i === 0 ? '👑' : (i + 1)) + '</span><div class="rb"><b>' + esc(r.name) + (r.you ? ' ✦' : '') + (r.akuma ? ' 👯‍♀️' : '') + (r.live ? ' <span class="sb-live">LIVE</span>' : '') + '</b><small>' + esc(r.blurb || '') + '</small></div><span class="ra">' + fmtUSD(r.amount || 0) + '</span></div>';
      }
    } else if (key === 'sd') {
      title = '💼 Sugar Daddy 榜'; sub = 'generosity · allegedly verified';
      var l2 = mag.sdRank || [];
      for (var i2 = 0; i2 < l2.length; i2++) {
        var d = l2[i2];
        body += '<div class="sb-rank"><span class="rn">' + (i2 === 0 ? '🥇' : (i2 + 1)) + '</span><div class="rb"><b>' + esc(d.name) + '</b><small>' + esc(d.blurb || '') + '</small></div><span class="ra" style="color:var(--gold);font-size:11px;">' + esc(d.style || '') + '</span></div>';
      }
    } else if (key === 'gossip') {
      title = '☕ Community Gossip'; sub = 'spill it · SugarRank™';
      fetchGlobalPosts();   // 异步拉全服姐妹楼，到货自动重画本页
      // ✍️ 发帖吐槽（User 许愿：我也要骂男人）
      body += '<div style="display:flex;margin:0 12px 10px;"><button class="sb-abtn" id="sbnyc-gossip-post" style="flex:1;">✍️ 发帖吐槽（男人 / 遭遇 / 今天的怨气）</button></div>';
      // 永久置顶：黑话扫盲（不吃AI生成，永远在）——聊天栏🔗按钮转发的就是这篇
      body += '<div class="sb-post" style="border-color:var(--gold);"><b>📌 黑话扫盲：进圈先读这篇</b><div class="pb">' + esc(SLANG_TERMS) + '</div><div class="pm">@SugarRank官方 · 永久置顶 · 聊天页输入栏点 🔗 可一键甩给不懂行话的人</div></div>';
      // 我的吐槽帖（可删；评论区可反复钓）
      var mineG = (state && state.myPosts) || [];
      for (var gm2 = mineG.length - 1; gm2 >= 0; gm2--) {
        var gp = mineG[gm2];
        var gcms = gp.comments || [];
        var gH = '';
        for (var gj = 0; gj < gcms.length; gj++) gH += '<div class="sb-cmt"><b>@' + esc(gcms[gj].n) + '</b>' + esc(gcms[gj].t) + '</div>';
        gH += '<div class="sb-cmt-pull sb-gpull" data-ts="' + gp.ts + '">💬 ' + (gcms.length ? '再钓一波评论' : '引一波围观') + '</div>';
        body += '<div class="sb-post" style="border-color:var(--gold);"><b>🗣️ 我的吐槽帖' + (gp.global ? ' <span class="sb-live">全服</span>' : '') + '</b><div class="pb">' + esc(gp.text) + '</div>' +
          '<div class="pm">@你的马甲 · ' + (gcms.length ? gcms.length + ' 条评论' : '刚挂出去') + ' · <span class="sb-postdel" data-ts="' + gp.ts + '" style="cursor:pointer;color:var(--red);">🗑 删帖</span></div>' + gH + '</div>';
      }
      var l3 = mag.gossip || [];
      for (var i3 = 0; i3 < l3.length; i3++) {
        var g = l3[i3];
        body += '<div class="sb-post"><b>' + esc(g.title) + '</b><div class="pb">' + esc(g.body) + '</div><div class="pm">@' + esc(g.author) + ' · ' + (9 + i3 * 17) + ' replies</div></div>';
      }
      body += renderGlobalPosts();
    } else if (key === 'trend') {
      title = '📈 本季 Trend'; sub = 'what the girls are flexing';
      var l4 = mag.trend || [];
      for (var i4 = 0; i4 < l4.length; i4++) {
        var t4 = l4[i4];
        body += '<div class="sb-rank"><div class="rb"><b>' + esc(t4.name) + '</b><small>' + esc(t4.blurb || '') + '</small></div>' +
          (t4.price > 0 ? '<span class="ra">' + fmtUSD(t4.price) + '</span><button class="sb-fwd" data-n="' + esc(t4.name) + '" data-p="' + t4.price + '" title="转发给联系人——圈内都懂的暗示">🔗</button><button class="sb-buy" data-n="' + esc(t4.name) + '" data-p="' + t4.price + '">拔草</button>' : '') + '</div>';
      }
      body += '<div class="sb-empty">看到什么就买什么。这是本版版规。</div>';
    } else if (key === 'abyss') {
      title = '🕳️ 深渊区'; sub = 'no names. no questions.';
      var l5 = mag.abyss || [];
      for (var i5 = 0; i5 < l5.length; i5++) {
        body += '<div class="sb-abyss">' + esc(l5[i5].body) + '<div class="am">anonymous · 0' + (2 + i5) + ':' + (17 + i5 * 21) % 60 + ' AM</div></div>';
      }
    } else if (key === 'recruit') {
      title = '📋 招聘版'; sub = 'SB/SD 互招 · 挂个牌，等人上钩';
      body += '<div style="display:flex;margin:0 12px 10px;"><button class="sb-abtn" id="sbnyc-recruit-post" style="flex:1;">✍️ 发帖自荐（挂出去，等人私信你）</button></div>';
      var mine = (state && state.myAds) || [];
      for (var rm = mine.length - 1; rm >= 0; rm--) {
        var ad = mine[rm];
        var cms = ad.comments || [];
        var cH = '';
        for (var cj = 0; cj < cms.length; cj++) cH += '<div class="sb-cmt"><b>@' + esc(cms[cj].n) + '</b>' + esc(cms[cj].t) + '</div>';
        // 💬 拉评论：没评论=引一波围观；有了=再钓一波新的（每次都是现生成，不会重复老梗）
        cH += '<div class="sb-cmt-pull" data-ts="' + ad.ts + '">💬 ' + (cms.length ? '再钓一波评论' : '引一波围观') + '</div>';
        body += '<div class="sb-post" style="border-color:var(--gold);"><b>🌸 我的自荐帖</b><div class="pb">' + esc(ad.text) + '</div><div class="pm">@你 · 已挂出 · ' + (cms.length ? cms.length + ' 条评论' : '等有缘人私信') + ' · <span class="sb-addel" data-ts="' + ad.ts + '" style="cursor:pointer;color:var(--red);">🗑 删帖</span></div>' + cH + '</div>';
      }
      var l6 = mag.recruit || [];
      for (var i6 = 0; i6 < l6.length; i6++) {
        var rp = l6[i6];
        var isSD = rp.side === 'SD';
        body += '<div class="sb-post"><b>' + esc((isSD ? '💼 ' : '🌸 ') + (rp.title || '')) + '</b><div class="pb">' + esc(rp.body || '') + '</div><div class="pm">@' + esc(rp.author || '匿名') + ' · ' + (isSD ? '金主招人' : '宝贝自荐') + ' · ' + (3 + i6 * 11) + ' 私信</div>' +
          '<div class="sb-cmt-pull sb-apply" data-ri="' + i6 + '">' + (isSD ? '💬 私信应聘' : '💬 私信搭话') + '</div></div>';
      }
      if (!l6.length && !mine.length) body += '<div class="sb-empty">本版还没帖子——你可以第一个挂出去</div>';
    }
    if (!body) body = '<div class="sb-empty">本期这个版是空的，点右上 🔄 重新生成</div>';
    var h = pageHeader(title, sub, true) + '<div class="sb-msgs" style="display:block;padding-top:12px;">' + body + '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    // 每个版块的 🔄 只重烤自己这版（玩家投诉全刊重烤太慢）；SB 榜还额外强制拉一次服务器真人榜
    var SEC_OF = { sb: ['SB'], sd: ['SD'], gossip: ['GOSSIP'], trend: ['TREND'], abyss: ['ABYSS'], recruit: ['RECRUIT'] };
    bindPageChrome(openForum, key === 'sb' ? function () { fetchRank(true); } : null, SEC_OF[key] || null);
    var rup = chatEl.querySelector('#sbnyc-rank-up');
    if (rup) rup.addEventListener('click', function () {
      rup.textContent = '⏳ 上传中…';
      Promise.resolve(reportRank()).then(function () { if (currentPage === 'board:sb') openBoard('sb'); });
    });
    var rpost = chatEl.querySelector('#sbnyc-recruit-post');
    if (rpost) rpost.addEventListener('click', openRecruitCompose);
    var gpost = chatEl.querySelector('#sbnyc-gossip-post');
    if (gpost) gpost.addEventListener('click', openGossipCompose);
    // 💬 拉评论按钮（我的自荐帖下面；:not 把八卦版和全服楼的同类按钮让出去，各归各的处理器）
    var pulls = chatEl.querySelectorAll('.sb-cmt-pull:not(.sb-apply):not(.sb-gpull):not(.sb-greply)');
    for (var pk = 0; pk < pulls.length; pk++) {
      (function (b) {
        b.addEventListener('click', function () {
          var ts = parseInt(b.getAttribute('data-ts'), 10);
          var ads = (state && state.myAds) || [];
          for (var ai = 0; ai < ads.length; ai++) {
            if (ads[ai].ts === ts) {
              b.textContent = '⏳ 围观群众赶来中…';
              SBemit('sb_request_ad_comments', { ts: ts, text: ads[ai].text });
              return;
            }
          }
        });
      })(pulls[pk]);
    }
    // 💬 拉评论（我的吐槽帖）：走 gossip 生态的评论区
    var gpulls = chatEl.querySelectorAll('.sb-gpull');
    for (var gk = 0; gk < gpulls.length; gk++) {
      (function (b) {
        b.addEventListener('click', function () {
          var ts = parseInt(b.getAttribute('data-ts'), 10);
          var ps = (state && state.myPosts) || [];
          for (var pi2 = 0; pi2 < ps.length; pi2++) {
            if (ps[pi2].ts === ts) {
              b.textContent = '⏳ 吃瓜群众赶来中…';
              SBemit('sb_request_ad_comments', { ts: ts, text: ps[pi2].text, kind: 'gossip' });
              return;
            }
          }
        });
      })(gpulls[gk]);
    }
    // 🗑 删我的吐槽帖（本体立即删；发过全服的服务器那份不追删——覆水难收，发帖页有预告）
    var pdels = chatEl.querySelectorAll('.sb-postdel');
    for (var pd = 0; pd < pdels.length; pd++) {
      (function (b) {
        b.addEventListener('click', function () {
          var ts = parseInt(b.getAttribute('data-ts'), 10);
          SBupdate(function (v) {
            if (v.sb && Array.isArray(v.sb.myPosts)) v.sb.myPosts = v.sb.myPosts.filter(function (p) { return p.ts !== ts; });
            return v;
          });
          if (state && Array.isArray(state.myPosts)) state.myPosts = state.myPosts.filter(function (p) { return p.ts !== ts; });
          toast('info', '🗑 帖子删了，评论一起火化');
          SBemit('sb_updated');   // 注入摘要同步遗忘这条帖子
          openBoard('gossip');
        });
      })(pdels[pd]);
    }
    // 🗑 删我的自荐帖
    var adels = chatEl.querySelectorAll('.sb-addel');
    for (var ad2 = 0; ad2 < adels.length; ad2++) {
      (function (b) {
        b.addEventListener('click', function () {
          var ts = parseInt(b.getAttribute('data-ts'), 10);
          SBupdate(function (v) {
            if (v.sb && Array.isArray(v.sb.myAds)) v.sb.myAds = v.sb.myAds.filter(function (p) { return p.ts !== ts; });
            return v;
          });
          if (state && Array.isArray(state.myAds)) state.myAds = state.myAds.filter(function (p) { return p.ts !== ts; });
          toast('info', '🗑 自荐帖已撤下');
          SBemit('sb_updated');
          openBoard('recruit');
        });
      })(adels[ad2]);
    }
    // 💬 回全服帖（真人姐妹楼）：署你的排行榜马甲
    var greps = chatEl.querySelectorAll('.sb-greply');
    for (var gr = 0; gr < greps.length; gr++) {
      (function (b) {
        b.addEventListener('click', function () {
          var gid = parseInt(b.getAttribute('data-gid'), 10);
          if (!(gid > 0)) return;
          Promise.resolve(ensureIdentity()).then(function (c) {
            if (!c) { toast('info', '没起马甲，先不回帖'); return; }
            panelPrompt('回一句（署名 @' + c.handle + '，全服可见）：', '').then(function (txt) {
              txt = (txt || '').trim().slice(0, 200);
              if (!txt) return;
              b.textContent = '⏳ 发送中…';
              srvFetch('sb_posts', { method: 'POST', body: { token: c.token, handle: c.handle, content: txt, parent_id: gid } })
                .then(function () { toast('success', '💬 回上了'); fetchGlobalPosts(true); })
                .catch(function (e) { toast('error', '回帖失败: ' + ((e && e.message) || e)); b.textContent = '💬 回一句'; });
            });
          });
        });
      })(greps[gr]);
    }
    // 💬 私信应聘/搭话（别人挂的招聘帖）：楼主变成手机联系人，直接开聊
    var applies = chatEl.querySelectorAll('.sb-apply');
    for (var ak = 0; ak < applies.length; ak++) {
      (function (b) {
        b.addEventListener('click', function () {
          var ri = parseInt(b.getAttribute('data-ri'), 10);
          var list = (magOf() && magOf().recruit) || [];
          if (list[ri]) contactFromRecruit(list[ri]);
        });
      })(applies[ak]);
    }
    bindBuyButtons(chatEl, 'Trend拔草');
    bindFwdButtons(chatEl);
  }

  // ── ➕ 新私信：固定NPC没主动来过消息（David/神父这种）玩家就没入口先撩TA——这页解决这个 ──
  // 名单要和生成器的 VOICES 对齐（名字对得上生成器才认识TA）；L. 故意不在名单里：他没有联系方式，只单方面写信。
  var FIXED_ROSTER = [
    ['T.', '巨鲸·老钱', '对冲基金巨鲸。话少，事密，从不寒暄'],
    ['Marco Rossi', '假富·话痨', '话痨装逼男。G-Wagen 是租的'],
    ['David Pemberton', '邻居·已婚律师', '隔壁的已婚合伙人。谨慎到只写便条'],
    ['Hudson Park', '战友·男公关', '高端男公关。你的战友，不收你钱'],
    ['Cole Marlowe', '乐队·反向要钱', 'Bushwick 主唱。会反过来跟你要钱'],
    ['Father Dan', '神父·禁忌', '耶稣会神父。只用 Signal'],
    ['Akuma', '闺蜜·圈内人气王', '你闺蜜。论坛人气王'],
    ['上夜班的人', '？·论坛私信', '论坛上私信过你的匿名账号'],
  ];
  // 私享版专属：S. + Akuma + 你的三人小群（公开版没有这行，也没有这个人）
  if (IS_PERSONAL) FIXED_ROSTER.push([GROUP_NAME, '私享·三人小群', 'S. 和 Akuma。他们互相看不顺眼，你看戏']);
  function openContacts() {
    currentPage = 'contacts';
    var npcs = (state && state.npcs) || {};
    var h = pageHeader('➕ 新私信', '想找谁，直接开口', false);
    h += '<div class="sb-msgs" style="display:block;padding-top:12px;">';
    var missing = [];
    var randomOnly = !!(state && state.game && state.game.random_only);   // 陌生人专场：固定名单不进通讯录（白名单 Akuma 除外）
    for (var i = 0; i < FIXED_ROSTER.length; i++) {
      if (randomOnly && FIXED_ROSTER[i][0] !== 'Akuma') continue;
      // 没聊过（不存在）or 被冷处理清空过（muted+空记录）→ 都当"还没聊过的"重新可开聊，别让删过的固定NPC卡在首页空窗口里回不来
      var exFx = npcs[FIXED_ROSTER[i][0]];
      if (!exFx || (exFx.muted && !(exFx.dm_history && exFx.dm_history.length))) missing.push(FIXED_ROSTER[i]);
    }
    if (missing.length) {
      h += '<div class="sb-sec">通讯录里还没聊过的</div>';
      for (var j = 0; j < missing.length; j++) {
        var f = missing[j];
        var ini = (f[0].replace(/[^A-Za-z一-鿿]/g, '')[0] || '\xB7').toUpperCase();
        h += '<div class="sb-forow sb-contact" data-fixed="' + j + '" style="cursor:pointer;"><span class="fi">' + esc(ini) + '</span><div class="fb"><b>' + esc(f[0]) + '</b><small>' + esc(f[1] + ' · ' + f[2]) + '</small></div><span class="sb-soon">开聊 ›</span></div>';
      }
    } else {
      h += '<div class="sb-empty">通讯录里的人都已经在消息列表里了</div>';
    }
    h += '<div class="sb-sec" style="margin-top:14px;">新面孔</div>';
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-contact-new" style="flex:1;">✍️ 输入名字，新建一个聊天</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:6px 16px;">给谁发都行——名字随你起（备注名也行，比如"Dr.Levine_UWS"）。号码怎么来的这种事，你自己心里有数。' + (randomOnly ? '' : '<br><br>找不到 L.？他没有联系方式——只会单方面给你写信。') + ((state && state.sugarelite && state.sugarelite.subscribed) ? '' : '<br>SugarElite™ 的管家要订阅后才会出现（去 ✦ Elite）。') + '</div>';
    h += '<div class="sb-sec" style="margin-top:14px;">旧识</div>';
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-contact-import" style="flex:1;">📥 从别的故事里请一个人过来</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:6px 16px;">你在别的世界书里认识的人也能进这部手机——搜TA的世界书，平台做一次背调，TA就带着自己的脾气出现在通讯录里。</div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(closeChat);
    var rows = chatEl.querySelectorAll('.sb-contact');
    for (var k = 0; k < rows.length; k++) {
      (function (r) {
        r.addEventListener('click', function () {
          var f = missing[parseInt(r.getAttribute('data-fixed'), 10)];
          if (f) contactFromFixed(f[0], f[1]);
        });
      })(rows[k]);
    }
    var nbtn = chatEl.querySelector('#sbnyc-contact-new');
    if (nbtn) nbtn.addEventListener('click', newCustomContact);
    var impbtn = chatEl.querySelector('#sbnyc-contact-import');
    if (impbtn) impbtn.addEventListener('click', openImportContact);
  }
  // 固定NPC：persistent=true（不会被自动清理），声音卡生成器里本来就有，建好直接聊
  function contactFromFixed(name, tag) {
    var fresh = {
      name: name, archetype: tag, persistent: true, engaged: false,
      total_transfers: 0, relationship: 0, unlocked: true,
      last_contact: nowT(), last_ts: Date.now(), unread: 0, last_message: '', dm_history: [],
    };
    SBupdate(function (v) {
      if (!v.sb) return v; if (!v.sb.npcs) v.sb.npcs = {};
      if (!v.sb.npcs[name]) v.sb.npcs[name] = fresh;
      else if (v.sb.npcs[name].muted) v.sb.npcs[name].muted = false;   // 冷处理过的固定NPC从通讯录重新开聊=解冻（User 主动开口）
      return v;
    });
    if (state) {
      if (!state.npcs) state.npcs = {};
      if (!state.npcs[name]) state.npcs[name] = fresh;
      else if (state.npcs[name].muted) state.npcs[name].muted = false;
    }
    openChat(name, state.npcs[name]);
  }
  // 自定义新面孔：名字随便起，可以顺手给一句"TA是谁"存成bio（生成器照这个演），留空=让TA自己长出来
  function newCustomContact() {
    panelPrompt('TA叫什么？（备注名也行，比如 Dr.Levine_UWS / 那个画廊主）', '').then(function (name) {
      name = (name || '').trim().slice(0, 24);
      if (!name) return;
      if (state && state.npcs && state.npcs[name]) { openChat(name, state.npcs[name]); return; }   // 已存在=直接进
      panelPrompt('TA是谁？一句话（比如"52岁上东区画廊主，说话夹法语"）。留空=让TA接到消息时自己长出来', '').then(function (who) {
        who = (who || '').trim();
        var fresh = {
          name: name, archetype: '', persistent: false, engaged: false,
          total_transfers: 0, relationship: 0, unlocked: true,
          last_contact: nowT(), last_ts: Date.now(), unread: 0, last_message: '', dm_history: [],
        };
        if (who) fresh.bio = who.slice(0, 200);
        SBupdate(function (v) {
          if (!v.sb) return v; if (!v.sb.npcs) v.sb.npcs = {};
          if (!v.sb.npcs[name]) v.sb.npcs[name] = fresh;
          return v;
        });
        if (state) { if (!state.npcs) state.npcs = {}; if (!state.npcs[name]) state.npcs[name] = fresh; }
        openChat(name, state.npcs[name]);
      });
    });
  }

  // ── 📥 旧识导入：搜玩家酒馆里的世界书 → 填两句话 → 发给生成器做AI背调（蒸馏成档案+声音卡）→ TA主动来打招呼 ──
  // 搜索是双查：世界书名直接匹配 + 角色卡名匹配后反查TA绑定的世界书。结果只存下标，名字里的引号弄不坏 attribute。
  var _impResults = [];
  function openImportContact() {
    currentPage = 'import';
    _impResults = [];
    var inputStyle = 'border:.5px solid var(--line);border-radius:12px;padding:10px 12px;font-size:13px;background:var(--paper-2);color:var(--ink);font-family:var(--font-sans);';
    var taStyle = 'width:100%;' + inputStyle + 'line-height:1.7;resize:vertical;';
    var h = pageHeader('📥 请旧识过来', '搜世界书 · 背调 · 入通讯录', false);
    h += '<div class="sb-msgs" style="display:block;padding-top:12px;">';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:2px 16px 8px;">你在别的故事里认识的人，也能进这部手机。输入TA的名字或TA所在的世界书名——搜的是你酒馆里装的所有世界书。</div>';
    h += '<div style="display:flex;gap:8px;margin:0 14px;"><input id="sbnyc-imp-q" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="角色名 / 世界书名 / 角色卡名" style="flex:1;min-width:0;' + inputStyle + '"><button class="sb-abtn" id="sbnyc-imp-go" style="flex:none;padding:0 16px;">搜索</button></div>';
    h += '<div id="sbnyc-imp-results"></div>';
    h += '<div id="sbnyc-imp-form" style="display:none;">';
    h += '<div class="sb-sec" style="margin-top:14px;">背调登记 · <span id="sbnyc-imp-wbname"></span></div>';
    h += '<div class="sb-frow" style="margin:0 14px 8px;"><input id="sbnyc-imp-name" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="TA的名字（照世界书里的写法）" style="width:100%;' + inputStyle + '"></div>';
    h += '<div class="sb-frow" style="margin:0 14px 8px;"><textarea id="sbnyc-imp-who" rows="2" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="TA在纽约是什么身份？例：Chelsea画廊主 / 对冲基金分析师。留空=按TA原本的气质安排" style="' + taStyle + '"></textarea></div>';
    h += '<div class="sb-frow" style="margin:0 14px 8px;"><textarea id="sbnyc-imp-rel" rows="2" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="TA认识你吗，怎么认识的？例：上个月慈善晚宴认识 / 还不认识，TA刚要到你的号。留空=让TA自己找上门" style="' + taStyle + '"></textarea></div>';
    h += '<div style="display:flex;margin:8px 14px;"><button class="sb-abtn" id="sbnyc-imp-btn" style="flex:1;">🕵️ 开始背调</button></div>';
    h += '<div class="sb-empty" id="sbnyc-imp-status" style="font-style:normal;text-align:left;padding:4px 16px;"></div>';
    h += '</div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(openContacts);
    var qEl = chatEl.querySelector('#sbnyc-imp-q');
    var goBtn = chatEl.querySelector('#sbnyc-imp-go');
    if (goBtn) goBtn.addEventListener('click', impSearch);
    if (qEl) qEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); impSearch(); } });
    var ibtn = chatEl.querySelector('#sbnyc-imp-btn');
    if (ibtn) ibtn.addEventListener('click', impSubmit);
  }
  function impSearch() {
    var qEl = chatEl.querySelector('#sbnyc-imp-q');
    var box = chatEl.querySelector('#sbnyc-imp-results');
    var q = ((qEl && qEl.value) || '').trim();
    if (!box) return;
    if (!q) { toast('info', '先输入TA的名字或世界书名'); return; }
    var ql = q.toLowerCase();
    function scoreOf(s) { s = String(s || '').toLowerCase(); return s === ql ? 3 : s.indexOf(ql) === 0 ? 2 : s.indexOf(ql) !== -1 ? 1 : 0; }
    var byWb = {};
    var wbs = []; try { wbs = getWorldbookNames() || []; } catch (e) {}
    for (var i = 0; i < wbs.length; i++) {
      var s1 = scoreOf(wbs[i]);
      if (s1) byWb[wbs[i]] = { wb: wbs[i], via: '', score: s1 + 0.5 };   // 书名直接命中比"经角色卡摸到"略优先
    }
    var chars = []; try { chars = getCharacterNames() || []; } catch (e) {}
    for (var c = 0; c < chars.length; c++) {
      var s2 = scoreOf(chars[c]);
      if (!s2) continue;
      var bound = null; try { bound = getCharWorldbookNames(chars[c]); } catch (e) { continue; }
      var books = [].concat((bound && bound.primary) || []).concat((bound && bound.additional) || []);
      for (var b = 0; b < books.length; b++) {
        if (!books[b]) continue;
        var prev = byWb[books[b]];
        if (!prev || prev.score < s2) byWb[books[b]] = { wb: books[b], via: chars[c], score: s2 };
      }
    }
    _impResults = [];
    for (var k in byWb) { if (byWb.hasOwnProperty(k)) _impResults.push(byWb[k]); }
    _impResults.sort(function (a, b) { return b.score - a.score; });
    _impResults = _impResults.slice(0, 8);
    if (!_impResults.length) { box.innerHTML = '<div class="sb-empty">没搜到。试试世界书名的一部分，或TA所在角色卡的卡名。</div>'; return; }
    var rh = '<div class="sb-sec" style="margin-top:12px;">选TA所在的世界书</div>';
    for (var r = 0; r < _impResults.length; r++) {
      var it = _impResults[r];
      var ini = (it.wb.replace(/[^A-Za-z一-鿿]/g, '')[0] || '书').toUpperCase();
      rh += '<div class="sb-forow sb-contact" data-imp="' + r + '" style="cursor:pointer;"><span class="fi">' + esc(ini) + '</span><div class="fb"><b>' + esc(it.wb) + '</b><small>' + esc(it.via ? '绑定在「' + it.via + '」' : '世界书') + '</small></div><span class="sb-soon">选TA ›</span></div>';
    }
    box.innerHTML = rh;
    var rows = box.querySelectorAll('.sb-contact');
    for (var x = 0; x < rows.length; x++) {
      (function (row) {
        row.addEventListener('click', function () {
          var it = _impResults[parseInt(row.getAttribute('data-imp'), 10)];
          if (it) impPick(it, q);
        });
      })(rows[x]);
    }
  }
  function impPick(it, q) {
    var form = chatEl.querySelector('#sbnyc-imp-form');
    var wbEl = chatEl.querySelector('#sbnyc-imp-wbname');
    var nmEl = chatEl.querySelector('#sbnyc-imp-name');
    if (!form || !wbEl) return;
    form.setAttribute('data-wb', it.wb);
    wbEl.textContent = it.wb;
    // 搜索词多半就是TA的名字（搜的是书名时不预填，别把书名当人名）
    if (nmEl && !nmEl.value && q !== it.wb) nmEl.value = q.slice(0, 24);
    form.style.display = 'block';
    try { form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }
  function impSubmit() {
    var form = chatEl.querySelector('#sbnyc-imp-form');
    var wb = (form && form.getAttribute('data-wb')) || '';
    if (!wb) { toast('info', '先从搜索结果里选一本世界书'); return; }
    var nmEl = chatEl.querySelector('#sbnyc-imp-name');
    var name = ((nmEl && nmEl.value) || '').trim().slice(0, 24);
    if (!name) { toast('warning', '得有名字——照世界书里的写法填'); return; }
    var ex = state && state.npcs && state.npcs[name];
    if (ex && ex.dm_history && ex.dm_history.length) { toast('info', '通讯录里已经有 ' + name + ' 了'); openChat(name, ex); return; }
    var whoEl = chatEl.querySelector('#sbnyc-imp-who');
    var relEl = chatEl.querySelector('#sbnyc-imp-rel');
    var btn = chatEl.querySelector('#sbnyc-imp-btn');
    if (btn) { btn.disabled = true; btn.textContent = '🕵️ 背调中…'; }
    var st = chatEl.querySelector('#sbnyc-imp-status');
    if (st) st.textContent = '平台正在通读TA的档案写调查报告——十几秒到一分钟，办完TA会自己来打招呼。';
    SBemit('sb_request_import', {
      worldbook: wb, name: name,
      identity: ((whoEl && whoEl.value) || '').trim().slice(0, 120),
      relation: ((relEl && relEl.value) || '').trim().slice(0, 200),
    });
    setStatus('🕵️ 背调 ' + name + ' 中…');
  }

  // ── 💬 从招聘帖开私信：把楼主建成联系人（帖子原文存成TA的bio=人设简历，生成器照着回话），直接进聊天页 ──
  function contactFromRecruit(rp) {
    var name = String(rp.author || '匿名').trim().slice(0, 24) || '匿名';
    var isSD = rp.side === 'SD';
    var bio = (String(rp.title || '') + '。' + String(rp.body || '')).slice(0, 400);
    var fresh = {
      name: name, archetype: isSD ? '招聘·金主' : '同行·SB', persistent: false, engaged: false,
      total_transfers: 0, relationship: 0, unlocked: true,
      last_contact: nowT(), last_ts: Date.now(), unread: 0, last_message: '', dm_history: [], bio: bio,
    };
    SBupdate(function (v) {
      if (!v.sb) return v; if (!v.sb.npcs) v.sb.npcs = {};
      if (!v.sb.npcs[name]) v.sb.npcs[name] = fresh;
      else if (!v.sb.npcs[name].bio) v.sb.npcs[name].bio = bio;   // 重名的已有联系人：不动TA的记录，只补简历
      return v;
    });
    if (state) {
      if (!state.npcs) state.npcs = {};
      if (!state.npcs[name]) state.npcs[name] = fresh;
      else if (!state.npcs[name].bio) state.npcs[name].bio = bio;
    }
    toast('info', isSD ? '💬 去应聘——把你的条件甩给TA' : '💬 去搭话——同行也是人脉');
    openChat(name, state.npcs[name]);
  }

  // ── 📋 发帖自荐：写一条挂到招聘版，挂完触发一个"冲着广告来的"陌生金主私信（复用陌生人专场生成） ──
  function openRecruitCompose() {
    currentPage = 'recruit-compose';
    var h = pageHeader('✍️ 发帖自荐', '挂上招聘版 · 会有人私信你', true);
    h += '<div class="sb-msgs" style="display:block;padding-top:14px;">';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px 10px;">写你自己：谁、什么条件（外形/语言/才艺/时间）、想找什么样的 daddy、期望（PPM 单次还是月度 allowance、起步数字、要不要验资）。写得越具体，上钩的人越对味。别用真名，用个昵称。</div>';
    h += '<div class="sb-frow" style="margin:0 14px;"><textarea id="sbnyc-recruit-text" rows="7" name="sbnyc-ad" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="例：昵称 Kiki，23，NYU 艺术史，会弹琴、法语流利，身高175。平日课排满，只有周末和假期有空。想找懂生活、不查岗、愿意带我见世面的成熟先生。月度 allowance 起步 8k，先验资再见面，不接受 PPM。" style="width:100%;border:.5px solid var(--line);border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.7;background:var(--paper-2);color:var(--ink);font-family:var(--font-sans);resize:vertical;"></textarea></div>';
    h += '<div style="display:flex;margin:8px 14px;"><button class="sb-abtn" id="sbnyc-recruit-submit" style="flex:1;">📤 挂出去</button></div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(function () { openBoard('recruit'); });
    var sbtn = chatEl.querySelector('#sbnyc-recruit-submit');
    if (sbtn) sbtn.addEventListener('click', function () {
      var ta = chatEl.querySelector('#sbnyc-recruit-text');
      var txt = ((ta && ta.value) || '').trim();
      if (txt.length < 10) { toast('warning', '写详细点——至少把条件和期望写清楚'); return; }
      txt = txt.slice(0, 500);
      var adTs = Date.now();   // 帖子唯一标识：变量、本地镜像、评论回写都认它
      SBupdate(function (v) {
        if (v.sb) { if (!Array.isArray(v.sb.myAds)) v.sb.myAds = []; v.sb.myAds.push({ text: txt, ts: adTs, comments: [] }); if (v.sb.myAds.length > 5) v.sb.myAds = v.sb.myAds.slice(-5); }
        return v;
      });
      if (state) { if (!Array.isArray(state.myAds)) state.myAds = []; state.myAds.push({ text: txt, ts: adTs, comments: [] }); }
      var oneLine = txt.replace(/\s+/g, ' ');
      SBemit('sb_request_dm', { reason: '有金主在招聘版看到了 User 挂出的自荐帖，主动私信找上门——只生成 1 个全新陌生金主的开场，他的开场白要直接呼应帖子内容、点出他被哪一句/哪个条件吸引，像真的读过这条广告。她的帖子原文：「' + oneLine + '」。不要让任何已有联系人出现、不要续接任何已有对话', n: '1' });
      SBemit('sb_request_ad_comments', { ts: adTs, text: txt });   // 评论区同步开盖：发完帖过一会儿就有人来围观起哄
      toast('success', '📋 挂出去了——评论和私信马上就来');
      openBoard('recruit');
    });
  }

  // ── 🗣️ 发帖吐槽（八卦版）：匿名马甲发牢骚 → 评论区自动开盖 + 注入正文（圈内人可能刷到）；可选同步全服 ──
  function openGossipCompose() {
    currentPage = 'gossip-compose';
    var h = pageHeader('✍️ 发帖吐槽', '匿名马甲 · 想骂谁骂谁', false);
    h += '<div class="sb-msgs" style="display:block;padding-top:14px;">';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px 10px;">吐槽男人、避雷、求助、炫耀都行。马甲发布——正文里的人可能刷到这条帖子并对号入座，但没人能确定是你（除非你自己认）。发出去以后评论区自动开盖。</div>';
    h += '<div class="sb-frow" style="margin:0 14px;"><textarea id="sbnyc-gossip-text" rows="6" name="sbnyc-gossip" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="例：😡 见面只肯给500车马费还想牵手，让他滚了。姐妹们避雷 UES 某自称 PE 合伙人的秃头，表是真的，人是假的。" style="width:100%;border:.5px solid var(--line);border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.7;background:var(--paper-2);color:var(--ink);font-family:var(--font-sans);resize:vertical;"></textarea></div>';
    h += '<div style="display:flex;gap:8px;margin:8px 14px;"><button class="sb-abtn" id="sbnyc-gossip-local" style="flex:1;">📤 发出去（仅本体）</button><button class="sb-abtn" id="sbnyc-gossip-global" style="flex:1;">🌍 发出去 + 全服可见</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">「仅本体」＝只存在你的游戏里，NPC 来评论。「全服」＝同时挂到官方服的姐妹楼，其他玩家看得到、能回你（署你的排行榜马甲）。⚠️ 全服帖覆水难收：本体的删帖只删你这边，服务器那份删不掉，骂真人请三思。</div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(function () { openBoard('gossip'); });
    function submitGossip(isGlobal) {
      var ta = chatEl.querySelector('#sbnyc-gossip-text');
      var txt = ((ta && ta.value) || '').trim();
      if (txt.length < 5) { toast('warning', '多写两句——怨气要具体才有人接'); return; }
      txt = txt.slice(0, 400);
      var pTs = Date.now();
      SBupdate(function (v) {
        if (v.sb) {
          if (!Array.isArray(v.sb.myPosts)) v.sb.myPosts = [];
          v.sb.myPosts.push({ text: txt, ts: pTs, comments: [], global: !!isGlobal });
          if (v.sb.myPosts.length > 5) v.sb.myPosts = v.sb.myPosts.slice(-5);
        }
        return v;
      });
      if (state) { if (!Array.isArray(state.myPosts)) state.myPosts = []; state.myPosts.push({ text: txt, ts: pTs, comments: [], global: !!isGlobal }); }
      SBemit('sb_request_ad_comments', { ts: pTs, text: txt, kind: 'gossip' });   // 评论区开盖（吃瓜生态）
      SBemit('sb_updated');   // 生成器 syncInject 会把帖子注进正文——圈内人下一轮就可能"刷到"
      if (isGlobal) {
        Promise.resolve(ensureIdentity()).then(function (c) {
          if (!c) { toast('info', '没起马甲——这条只发了本体'); return; }
          srvFetch('sb_posts', { method: 'POST', body: { token: c.token, handle: c.handle, content: txt } })
            .then(function () { toast('success', '🌍 已同步全服姐妹楼'); fetchGlobalPosts(true); })
            .catch(function (e) { toast('error', '全服没发出去（本体已发）: ' + ((e && e.message) || e)); });
        });
      }
      toast('success', '🗣️ 挂出去了——吃瓜群众马上就来');
      openBoard('gossip');
    }
    var gl = chatEl.querySelector('#sbnyc-gossip-local');
    if (gl) gl.addEventListener('click', function () { submitGossip(false); });
    var gg = chatEl.querySelector('#sbnyc-gossip-global');
    if (gg) gg.addEventListener('click', function () { submitGossip(true); });
  }

  // ── 👗 衣橱：买过的都在这，随时可以出二手（回收价=原价18%–35%，入手价/回收价并排标出，不加戏） ──
  function openCloset() {
    currentPage = 'closet';
    var cl = (state && state.closet) || [];
    var h = pageHeader('👗 衣橱', 'everything you own', false);
    h += '<div class="sb-msgs" style="display:block;padding-top:12px;">';
    if (!cl.length) {
      h += '<div class="sb-empty">衣橱还空着。<br>去 Elite 犒赏一下自己？</div>';
    } else {
      // 回收价在渲染时就算好并显示（原价和卖出价摆在一起就够了，数字自己会说话）
      for (var i = cl.length - 1; i >= 0; i--) {
        var c2 = cl[i];
        var paid0 = Number(c2.price) || 0;
        var offer0 = paid0 > 0 ? resellOffer(c2.name, paid0) : 0;
        var meta0 = paid0 > 0 ? (esc(c2.from || '') + ' · 入手 ' + fmtUSD(paid0) + ' · 回收价 ' + fmtUSD(offer0)) : (esc(c2.from || '') + ' · 入手价没记——点出二手补个市价');
        h += '<div class="sb-rank"><div class="rb"><b>' + esc(c2.name) + '</b><small>' + meta0 + '</small></div><button class="sb-buy" data-i="' + i + '" data-o="' + offer0 + '">出二手</button></div>';
      }
    }
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(closeChat);
    var btns = chatEl.querySelectorAll('.sb-buy');
    for (var k = 0; k < btns.length; k++) { (function (b) { b.addEventListener('click', function () { resellItem(parseInt(b.getAttribute('data-i'), 10), parseInt(b.getAttribute('data-o'), 10)); }); })(btns[k]); }
  }
  // 二手回收率按品类（玩家考据的市场规律）：纯金不跌破金价、硬奢珠宝/爱马仕保值、表和大牌包中游、鞋和衣服血亏
  function resellRate(name) {
    var s = String(name || '').toLowerCase();
    if (/纯金|金条|金饰|足金|24k|999/.test(s)) return [0.85, 0.95];                                     // 黄金有底价
    if (/hermès|hermes|爱马仕|birkin|kelly|铂金包|康康/.test(s)) return [0.7, 0.95];                     // 爱马仕玄学，行情好近乎原价
    if (/van cleef|vca|梵克雅宝|四叶草|cartier|卡地亚|love手镯|bulgari|宝格丽|tiffany|蒂芙尼|harry winston|graff|珠宝|钻石|钻戒|18k/.test(s)) return [0.6, 0.8];   // 硬奢珠宝保值
    if (/rolex|劳力士|patek|百达翡丽|audemars|皇家橡树|richard mille|理查德米勒|omega|欧米茄|腕表|手表|表\b/.test(s)) return [0.5, 0.75];
    if (/chanel|香奈儿|louis vuitton|\blv\b|dior|迪奥|gucci|古驰|prada|celine|思琳|loewe|罗意威|goyard|bag|手袋|包/.test(s)) return [0.35, 0.6];
    if (/鞋|高跟|heel|boot|sneaker|louboutin|红底|jimmy choo|amina|manolo/.test(s)) return [0.15, 0.3];
    if (/裙|大衣|外套|风衣|针织|衬衫|套装|羽绒|皮衣|coat|dress|jacket|couture/.test(s)) return [0.08, 0.2];   // 衣服=穿一次的烟花
    return [0.18, 0.35];   // 认不出的照旧
  }
  function resellOffer(name, paid) {
    var r = resellRate(name);
    return Math.max(1, Math.round((Number(paid) || 0) * (r[0] + Math.random() * (r[1] - r[0]))));
  }
  function resellItem(idx, offerShown) {
    var cl = (state && state.closet) || [];
    var it = cl[idx]; if (!it) return;
    var paid = Number(it.price) || 0;
    // 正文里进来的老物件没记价格（0元购时代的遗产）→ 问一句市价、补录进档案，再走正常流程
    if (!(paid > 0)) {
      panelPrompt('「' + it.name + '」入橱时没记价格——它市价大概多少？（只填数字，补录后按品类折旧）', '').then(function (d) {
        var pv = Math.round(parseFloat(String(d || '').replace(/[^0-9.]/g, ''))) || 0;
        if (pv <= 0) return;
        SBupdate(function (v) { var c0 = v.sb && v.sb.closet && v.sb.closet[idx]; if (c0 && c0.name === it.name) c0.price = pv; return v; });
        it.price = pv;
        resellItem(idx, 0);
      });
      return;
    }
    var offer = offerShown > 0 ? offerShown : resellOffer(it.name, paid);
    var ok = true;
    try { ok = (DOC.defaultView || window).confirm('出掉「' + it.name + '」？\n入手 ' + fmtUSD(paid) + ' → 回收 ' + fmtUSD(offer)); } catch (e) {}
    if (!ok) return;
    SBupdate(function (v) {
      if (!v.sb || !Array.isArray(v.sb.closet) || !v.sb.closet[idx]) return v;
      v.sb.closet.splice(idx, 1);
      if (!v.sb.wallet) v.sb.wallet = { balance: 0, bills: [], transactions: [] };
      var w = v.sb.wallet;
      w.balance = (w.balance || 0) + offer;
      if (!w.transactions) w.transactions = [];
      w.transactions.push({ direction: '+', amount: offer, counterparty: '二奢回收 · ' + it.name, channel: '二手', note: '', time: nowT() });
      if (w.transactions.length > 20) w.transactions = w.transactions.slice(-20);
      return v;
    });
    if (state) {
      state.closet.splice(idx, 1);
      if (state.wallet) state.wallet.balance = (state.wallet.balance || 0) + offer;
    }
    toast('info', '👗 ' + it.name + ' 已出：+' + fmtUSD(offer));
    SBemit('sb_floor_log', { lines: ['💰〔' + nowT() + '〕出掉「' + it.name + '」 +' + fmtUSD(offer)] });
    SBemit('sb_updated');   // 转卖是静默系统事件：钱包和衣橱变了，主线通过摘要自然知道，不打扰正文
    openCloset();
  }

  // ── SugarElite™：未订阅 = 付费墙；订阅后 = 本期会刊（讲解/专栏/目录/代订/情报） ──
  function openElite() {
    var se = (state && state.sugarelite) || {};
    if (!se.subscribed) return openPaywall();
    currentPage = 'elite';
    fetchPool();   // 池子保鲜（本次没到货下次开就有）
    fetchExperiences();   // 体验橱窗保鲜（服务器 sb_experiences）
    var mag = magOf();
    var h = pageHeader('SugarElite™', 'member', true);
    h += '<div class="sb-msgs" style="display:block;">';
    if (!mag) {
      h += '<div class="sb-empty">📡 本期会刊生成中…</div>';
    } else {
      var i, g;
      // 犒赏自己：服务器橱窗池抽3件（真图真货真当季，User当全服买手）；大额到账后价位贴着到账数字挑
      var treats = pickTreats(3);
      if (treats.length) {
        h += '<div class="sb-sec">Treat Yourself · 犒赏自己</div>';
        if (_windfall > 0) h += '<div class="sb-empty" style="padding:2px 16px 8px;">S.: 刚到账 ' + fmtUSD(_windfall) + '。今天值得。</div>';
        for (i = 0; i < treats.length; i++) {
          g = treats[i];
          var luxName = (g.brand ? g.brand + ' ' : '') + (g.name || '');
          h += '<div class="sb-lux">' +
            (g.image_url ? '<img src="' + esc(g.image_url) + '" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
            '<div class="lb"><div class="li"><span class="lbrand">' + esc(g.brand || 'curated') + '</span><b>' + esc(g.name || '') + '</b><small>' + esc(g.blurb || '') + '</small></div>' +
            '<span class="lp">' + fmtUSD(g.price || 0) + '</span>' +
            '<button class="sb-fwd" data-n="' + esc(luxName) + '" data-p="' + (g.price || 0) + '" title="转发给联系人——圈内都懂的暗示">🔗</button><button class="sb-buy" data-kind="lux" data-n="' + esc(luxName) + '" data-p="' + (g.price || 0) + '" data-img="' + esc(g.image_url || '') + '">下单</button></div></div>';
        }
        markLuxSeen(treats.map(function (x) { return x.id; }));
      }
      // ✨ 奢华体验橱窗（作者填的剧本种子，下单即注入正文让主线写整段旅程）
      var exps = expPool();
      if (exps.length) {
        h += '<div class="sb-sec">✨ Signature Experiences · 奢华体验</div>';
        for (i = 0; i < exps.length; i++) {
          g = exps[i];
          h += '<div class="sb-lux sb-exp">' +
            (g.image_url ? '<img src="' + esc(g.image_url) + '" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
            '<div class="lb"><div class="li"><span class="lbrand">experience</span><b>' + esc(g.title || '') + '</b><small>' + esc((g.location ? g.location + ' · ' : '') + (g.blurb || '')) + '</small></div>' +
            (g.price > 0 ? '<span class="lp">' + fmtUSD(g.price) + '</span>' : '') +
            '<button class="sb-startexp" data-i="' + i + '">✨ 开启</button></div></div>';
        }
      }
      h += '<div class="sb-sec">City Guide · 本期讲解</div>';
      var gd = mag.guide || [];
      for (i = 0; i < gd.length; i++) h += '<div class="sb-post"><b>' + esc(gd[i].title) + '</b><div class="pb">' + esc(gd[i].body) + '</div></div>';
      h += '<div class="sb-sec">Column · S. 的专栏</div>';
      var te = mag.tea || [];
      for (i = 0; i < te.length; i++) h += '<div class="sb-post"><b>' + esc(te[i].title) + '</b><div class="pb">' + esc(te[i].body) + '</div><div class="pm">— S.</div></div>';
      h += '<div class="sb-sec">Catalog · 本季目录</div>';
      var ca = mag.catalog || [];
      for (i = 0; i < ca.length; i++) {
        g = ca[i];
        h += '<div class="sb-rank"><div class="rb"><b>' + esc(g.name) + '</b><small>' + esc(g.cat || '') + ' · ' + esc(g.blurb || '') + '</small></div><span class="ra">' + fmtUSD(g.price) + '</span><button class="sb-fwd" data-n="' + esc(g.name) + '" data-p="' + g.price + '" title="转发给联系人——圈内都懂的暗示">🔗</button><button class="sb-buy" data-kind="cat" data-n="' + esc(g.name) + '" data-p="' + g.price + '">下单</button></div>';
      }
      h += '<div class="sb-sec">Concierge · 可代订</div>';
      var iv = mag.invites || [];
      for (i = 0; i < iv.length; i++) {
        g = iv[i];
        h += '<div class="sb-rank"><div class="rb"><b>' + esc(g.title) + '</b><small>' + esc(g.kind || '') + ' · ' + esc(g.blurb || '') + '</small></div>' + (g.price > 0 ? '<span class="ra">' + fmtUSD(g.price) + '</span>' : '') + '<button class="sb-fwd" data-n="' + esc(g.title) + '" data-p="' + (g.price || 0) + '" title="转发给联系人——想去这个，懂？">🔗</button><button class="sb-buy" data-kind="inv" data-n="' + esc(g.title) + '" data-p="' + (g.price || 0) + '">📅 预约</button></div>';
      }
      h += '<div class="sb-sec">Intel · 私密情报</div>';
      var it = mag.intel || [];
      for (i = 0; i < it.length; i++) h += '<div class="sb-post"><div class="pb">🔒 ' + esc(it[i].body) + '</div><div class="pm">intel · burn after reading</div></div>';
    }
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(closeChat, null, ['GUIDE', 'TEA', 'CAT', 'INVITE', 'INTEL']);   // Elite 的 🔄 只重烤会刊五版，不碰论坛
    if (!mag) { askMag(); return; }
    var scope = chatEl;
    var btns = scope.querySelectorAll('.sb-buy');
    for (var k = 0; k < btns.length; k++) {
      (function (b) {
        b.addEventListener('click', function () {
          var n = b.getAttribute('data-n') || '';
          var p = parseInt(b.getAttribute('data-p'), 10) || 0;
          var kind = b.getAttribute('data-kind');
          if (kind === 'lux') _windfall = 0;
          // 代订(inv)一律按体验走——哪怕标题没命中体验关键词
          purchase(n, p, kind === 'inv' ? 'SugarElite代订' : (kind === 'lux' ? '犒赏自己' : 'SugarElite目录'), b.getAttribute('data-img') || '', kind === 'inv');
        });
      })(btns[k]);
    }
    bindFwdButtons(scope);
    // ✨ 奢华体验的开启按钮（下单即注入剧本种子）
    var ebtns = scope.querySelectorAll('.sb-startexp');
    var expsNow = expPool();
    for (var e2 = 0; e2 < ebtns.length; e2++) {
      (function (b) {
        b.addEventListener('click', function () {
          var idx = parseInt(b.getAttribute('data-i'), 10);
          if (!isNaN(idx) && expsNow[idx]) buyExperience(expsNow[idx]);
        });
      })(ebtns[e2]);
    }
  }

  function openPaywall() {
    currentPage = 'elite';
    var h = pageHeader('SugarElite™', 'members only', false);
    h += '<div class="sb-msgs" style="display:block;">';
    h += '<div class="sb-paywall"><h3>SUGARELITE™</h3><p>会员制管家。知道所有你该去的地方，<br>和所有你不该问的事。</p>' +
      '<div class="tier"><b>MEMBERSHIP — $3,000/月</b><br>本期会刊 · 上流讲解 · 精选目录 · 管家代订 · 私密情报<br><small>一价全包，没有更贵的档——你要的他全知道</small></div>' +
      '<div style="margin-top:8px;"><button class="sb-abtn" id="sbnyc-sub" style="width:100%;">订阅 SugarElite™</button></div></div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    bindPageChrome(closeChat);
    chatEl.querySelector('#sbnyc-sub').addEventListener('click', function () { subscribeElite(3000); });
  }

  function subscribeElite(price) {
    var ok = true;
    try { ok = (DOC.defaultView || window).confirm('订阅 SugarElite™（' + fmtUSD(price) + '/月，本月费用现在扣）？'); } catch (e) {}
    if (!ok) return;
    if (!debit(price, 'SugarElite 月费', 'SugarElite')) return;
    SBupdate(function (v) {
      if (!v.sb) return v;
      v.sb.sugarelite = { subscribed: true };
      if (!v.sb.npcs) v.sb.npcs = {};
      if (!v.sb.npcs['SugarElite™']) v.sb.npcs['SugarElite™'] = { name: 'SugarElite™', archetype: '管家', persistent: true, engaged: true, total_transfers: 0, relationship: 0, unlocked: true, last_contact: nowT(), last_ts: Date.now(), unread: 0, last_message: '', dm_history: [] };
      var n = v.sb.npcs['SugarElite™'];
      n.dm_history.push({ sender: 'THEM', time: nowT(), ts: Date.now(), type: 'text', content: 'Welcome to SugarElite. — S.', note: '', zh: '欢迎加入 SugarElite。— S.', gameDay: (v.sb.game && v.sb.game.day) || 1 });
      n.unread = (n.unread || 0) + 1; n.last_message = 'Welcome to SugarElite…'; n.last_contact = nowT(); n.last_ts = Date.now();
      return v;
    });
    if (state) {
      state.sugarelite = { subscribed: true };
      if (!state.npcs) state.npcs = {};
      if (!state.npcs['SugarElite™']) state.npcs['SugarElite™'] = { name: 'SugarElite™', archetype: '管家', persistent: true, engaged: true, unlocked: true, last_contact: nowT(), unread: 1, last_message: 'Welcome to SugarElite…', dm_history: [] };
    }
    toast('success', '✦ SugarElite™ 已开通');
    SBemit('sb_updated');
    SBemit('sb_request_dm', { reason: 'User 刚订阅了 SugarElite，让管家 S.(SugarElite™) 发来第一条正式问候：专业、干燥幽默、附一条马上能用的建议', n: '1-2' });
    openElite();
  }

  // ── 手机设置（独立 API：手机私信走自己的小模型，不占主 API 限额） ──
  // ── 📅 日历（UWU 的功能）：日程落格子 + 点日期看当天安排 + 📚手动生成学业日程 ──
  // 日期数学全走 epochDate/gameDateOf（本地时区解析），格子号=剧情第几天（gameDay，1起算）
  var _calMonthOffset = 0;   // 翻月偏移只是浏览状态，不进 sb 变量
  function openCalendar() {
    currentPage = 'calendar';
    currentChatName = null;
    if (!state) return;
    if (!state.game) state.game = {};
    var epoch = epochDate();
    var todayDate = gameDateOf(state.game.day || 1);
    var displayDate = new Date(todayDate.getFullYear(), todayDate.getMonth() + _calMonthOffset, 1);
    var viewYear = displayDate.getFullYear(), viewMonth = displayDate.getMonth();
    var h = '<div class="sb-ch"><button class="sb-ch-back">‹</button><div class="sb-ch-name"><b>日历</b><small>' + viewYear + '年 ' + (viewMonth + 1) + '月</small></div>' +
      '<button class="sb-ch-del" id="sb-cal-academic" title="生成学业日程（NYU 的 deadline 不会放过你）" style="opacity:.8;">📚</button></div>';
    h += '<div class="sb-msgs" id="sb-cal-wrap" style="display:block;padding:10px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
      '<button class="sb-abtn cal-prev" style="flex:0 0 auto;">◀</button>' +
      '<span style="font-weight:600;color:var(--ink);">' + viewYear + '年 ' + (viewMonth + 1) + '月</span>' +
      '<button class="sb-abtn cal-next" style="flex:0 0 auto;">▶</button></div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;font-size:11px;color:var(--ink-sub);margin-bottom:6px;">';
    ['日', '一', '二', '三', '四', '五', '六'].forEach(function (d) { h += '<div>' + d + '</div>'; });
    h += '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;background:var(--paper-2);border-radius:12px;padding:4px;">';
    var firstDay = new Date(viewYear, viewMonth, 1).getDay();
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    var cells = [];
    for (var e0 = 0; e0 < firstDay; e0++) cells.push(null);
    for (var d0 = 1; d0 <= daysInMonth; d0++) {
      var date0 = new Date(viewYear, viewMonth, d0);
      var cellGd = Math.round((date0.getTime() - epoch.getTime()) / 86400000) + 1;   // 本地午夜相减，round 吃掉夏令时的±1小时
      var evs = (state.schedule || []).filter(function (s) { return (s.gameDay || 1) === cellGd; });
      var emoji = evs.length ? (evs.some(function (s) { return s.academic; }) ? '📚' : '🗓️') : '';
      cells.push({ day: d0, emoji: emoji, gameDay: cellGd });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    for (var ci = 0; ci < cells.length; ci++) {
      var c0 = cells[ci];
      if (!c0) { h += '<div style="aspect-ratio:1;background:var(--paper-3);border-radius:6px;"></div>'; continue; }
      var isToday = c0.gameDay === (state.game.day || 1);
      h += '<div class="sb-cal-day" data-gd="' + c0.gameDay + '" style="background:' + (isToday ? 'var(--gold-soft)' : 'var(--paper)') + ';border-radius:6px;">' +
        '<span style="font-weight:500;">' + c0.day + '</span>' +
        (c0.emoji ? '<span style="font-size:14px;">' + c0.emoji + '</span>' : '') + '</div>';
    }
    h += '</div>';
    h += '<div id="sb-cal-detail" style="margin-top:10px;padding:10px;background:var(--paper-3);border-radius:12px;display:none;max-height:120px;overflow-y:auto;font-size:12px;color:var(--ink);"></div>';
    h += '<button class="sb-abtn" id="sb-cal-jump" style="width:calc(100% - 8px);margin:12px 4px 2px;">⏱ 校准时间 / 跳到某天</button>';
    h += '<div class="sb-empty" style="font-style:normal;padding:8px 4px 2px;">今天=金色格子（剧情第 ' + (state.game.day || 1) + ' 天）。点 ⏱ 校准时间或跳日期，点 📚 排课业。</div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    chatEl.querySelector('.sb-ch-back').addEventListener('click', closeChat);
    chatEl.querySelector('.cal-prev').addEventListener('click', function () { _calMonthOffset--; openCalendar(); });
    chatEl.querySelector('.cal-next').addEventListener('click', function () { _calMonthOffset++; openCalendar(); });
    var jumpBtn = chatEl.querySelector('#sb-cal-jump');
    if (jumpBtn) jumpBtn.addEventListener('click', function () { calibrateTime(); });   // 顶栏时间被拖动handle吞了点击，改从这个按钮进
    var acadBtn = chatEl.querySelector('#sb-cal-academic');
    if (acadBtn) acadBtn.addEventListener('click', function () {
      var academicCount = ((state && state.schedule) || []).filter(function (s) { return s.academic; }).length;
      if (academicCount >= 3) { toast('info', '📚 学业日程已经排满了（最多3条）——先把手头的deadline熬过去'); return; }
      SBemit('sb_request_academic');
      toast('info', '📚 正在生成学业日程…（一次AI调用）');
      acadBtn.textContent = '⏳';
      setTimeout(function () { acadBtn.textContent = '📚'; }, 3000);
    });
    var wrap = chatEl.querySelector('#sb-cal-wrap');
    var detailDiv = chatEl.querySelector('#sb-cal-detail');
    var selectedDay = null;
    // 点日期开详情，点同一天/点空白处收起——监听挂在本页的 wrap 上，换页即销毁不积攒
    wrap.addEventListener('click', function (ev) {
      var dayEl = ev.target && ev.target.closest && ev.target.closest('.sb-cal-day');
      if (!dayEl) {
        if (!(ev.target.closest && ev.target.closest('#sb-cal-detail'))) { detailDiv.style.display = 'none'; selectedDay = null; }
        return;
      }
      ev.stopPropagation();
      var gd = parseInt(dayEl.getAttribute('data-gd'), 10);
      if (selectedDay === gd) { detailDiv.style.display = 'none'; selectedDay = null; return; }
      selectedDay = gd;
      var events = ((state && state.schedule) || []).filter(function (s) { return (s.gameDay || 1) === gd; });
      var html = '';
      if (!events.length) html = '<div style="color:var(--ink-faint);text-align:center;">当天无安排</div>';
      else events.forEach(function (ev2) {
        html += '<div style="margin-bottom:6px;border-bottom:1px dashed var(--line);padding-bottom:4px;">' + (ev2.academic ? '📚' : '🗓️') + ' ' + esc(ev2.txt) + '</div>';
      });
      detailDiv.innerHTML = html; detailDiv.style.display = 'block';
    });
  }

  // ── 💳 流水（UWU 的功能）：全部交易带日期，🧾税务中心藏在右上角（设置里开了才出现）──
  var _onTaxReady = null;   // 税务题目生成完的回调钩子（全局只注册一次监听，见文件尾 SBon）
  function openTransactions() {
    currentPage = 'transactions';
    currentChatName = null;
    if (!state) return;
    var allTx = ((state.wallet && state.wallet.allTransactions) || []).slice().reverse();
    var taxEnabled = false;
    try { taxEnabled = VIEW.localStorage.getItem('sbnyc_tax_enabled') === '1'; } catch (e) {}
    var h = '<div class="sb-ch"><button class="sb-ch-back">‹</button><div class="sb-ch-name"><b>全部流水</b><small>Statement</small></div>' +
      (taxEnabled ? '<button class="sb-ch-del" id="sb-tax-btn" title="税务中心" style="opacity:.8;">🧾</button>' : '') + '</div>';
    h += '<div class="sb-msgs" id="sb-tx-list" style="display:block;padding-top:8px;">';
    if (!allTx.length) h += '<div class="sb-empty">还没有流水——先去挣，或者先去花</div>';
    else allTx.forEach(function (tx) {
      var minus = tx.direction === '-';
      var dateStr = tx.gameDay ? fmtMD(gameDateOf(tx.gameDay)) : '';
      h += '<div style="padding:9px 14px;border-bottom:.5px dashed var(--line-faint);display:flex;justify-content:space-between;align-items:baseline;gap:8px;">' +
        '<div style="min-width:0;"><b class="sb-tx-a ' + (minus ? 'minus' : 'plus') + '">' + tx.direction + fmtUSD(tx.amount) + '</b> ' +
        '<span style="font-size:11px;color:var(--ink-sub);">' + esc(tx.counterparty || '') + '</span></div>' +
        '<div style="font-size:10px;color:var(--ink-faint);flex-shrink:0;">' + dateStr + (tx.time ? ' ' + esc(tx.time) : '') + (tx.channel ? ' · ' + esc(tx.channel) : '') + '</div></div>';
    });
    h += '</div>';
    h += '<div id="sb-tax-panel" style="display:none;flex:1;overflow-y:auto;padding:12px;"></div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    chatEl.querySelector('.sb-ch-back').addEventListener('click', closeChat);
    var taxPanel = chatEl.querySelector('#sb-tax-panel');
    var txList = chatEl.querySelector('#sb-tx-list');
    var taxBtn = chatEl.querySelector('#sb-tax-btn');
    if (taxBtn) taxBtn.addEventListener('click', function (ev) { ev.stopPropagation(); openTaxPanel(); });
    function openTaxPanel() {
      if (taxPanel.style.display === 'block') { taxPanel.style.display = 'none'; txList.style.display = 'block'; _onTaxReady = null; return; }
      txList.style.display = 'none'; taxPanel.style.display = 'block';
      if (!state.taxQuestions || !state.taxQuestions.length) {
        taxPanel.innerHTML = '<div class="sb-empty">⏳ 正在生成税务题目…（一次AI调用）</div>';
        _onTaxReady = function () { if (currentPage === 'transactions' && taxPanel.style.display === 'block') renderTaxPanel(); };
        SBemit('sb_request_tax_questions');
        return;
      }
      renderTaxPanel();
    }
    function renderTaxPanel() {
      var taxData = (state && state.taxQuestions) || [];
      if (!taxData.length) { taxPanel.innerHTML = '<div class="sb-empty">题目还没到——稍等或重开本页</div>'; return; }
      var totalIncome = 0;
      var all2 = (state.wallet && state.wallet.allTransactions) || [];
      for (var i = 0; i < all2.length; i++) { if (all2[i].direction === '+') totalIncome += all2[i].amount || 0; }
      var taxOwed = Math.round(totalIncome * 0.15);
      var h2 = '<div style="padding:10px;background:var(--paper-2);border-radius:12px;margin-bottom:10px;">';
      h2 += '<b style="color:var(--gold);">🧾 IRS 税务中心</b>';
      h2 += '<div style="font-size:12px;color:var(--ink-sub);margin-top:6px;line-height:1.7;">在美国，所有收入（包括 Sugar Baby 收到的赠与、转账、礼物折算）都可能需要申报并缴纳联邦所得税和州税。<br>' +
        '本年度截至目前，你的总收入约为：<b>' + fmtUSD(totalIncome) + '</b><br>' +
        '预估应缴税额（15%）：<b style="color:var(--red);">' + fmtUSD(taxOwed) + '</b><br>' +
        '申报截止日期：<b>4月15日</b>（逾期将产生罚款）</div></div>';
      h2 += '<div style="padding:10px;background:var(--paper-2);border-radius:12px;margin-bottom:10px;">';
      h2 += '<b style="color:var(--ink);font-size:12px;">📝 税务知识测试（自助报税需答对 3 题，答不对也能报，但加收 20% 罚款）</b>';
      for (var qi = 0; qi < taxData.length; qi++) {
        var q = taxData[qi];
        h2 += '<div style="margin-top:10px;font-size:12px;color:var(--ink);">' + (qi + 1) + '. ' + esc(q.q) + '</div>';
        for (var oj = 0; oj < q.opts.length; oj++) h2 += '<label style="display:block;margin-left:10px;font-size:11px;cursor:pointer;color:var(--ink-sub);"><input type="radio" name="taxq' + qi + '" value="' + oj + '"> ' + esc(q.opts[oj]) + '</label>';
      }
      h2 += '</div>';
      h2 += '<div style="display:flex;gap:8px;margin-bottom:10px;"><button class="sb-abtn" id="sb-tax-self" style="flex:1;">📝 自助报税（答对3题免罚款）</button><button class="sb-abtn" id="sb-tax-agent" style="flex:1;">💼 请人报税（额外 $100）</button></div>';
      taxPanel.innerHTML = h2;
      function processPayment(amount, method) {
        if (amount <= 0) { toast('info', '无需缴税——IRS 今天对你没兴趣'); return; }
        var ok = true;
        try { ok = (DOC.defaultView || window).confirm(method + '，需要支付 ' + fmtUSD(amount) + '（余额 ' + fmtUSD((state && state.wallet && state.wallet.balance) || 0) + '），确认？'); } catch (e) {}
        if (!ok) return;
        if (!debit(amount, method, '税务')) return;
        toast('success', '🧾 已支付 ' + fmtUSD(amount) + '（' + method + '）——一个守法的甜心宝贝');
        state.taxQuestions = null;
        SBupdate(function (v) { if (v.sb) v.sb.taxQuestions = null; return v; });
        SBemit('sb_updated');
        openTransactions();
      }
      taxPanel.querySelector('#sb-tax-self').addEventListener('click', function () {
        var correct = 0;
        for (var i2 = 0; i2 < taxData.length; i2++) {
          var sel = taxPanel.querySelector('input[name="taxq' + i2 + '"]:checked');
          if (sel && parseInt(sel.value, 10) === taxData[i2].ans) correct++;
        }
        var finalTax = taxOwed;
        if (correct < 3) { finalTax = Math.round(taxOwed * 1.2); toast('warning', '只答对 ' + correct + ' 题——IRS 加收 20% 罚款'); }
        else toast('success', '答对全部 3 题，无罚款——比一半美国人强');
        processPayment(finalTax, '自助报税');
      });
      taxPanel.querySelector('#sb-tax-agent').addEventListener('click', function () { processPayment(taxOwed + 100, '请人报税'); });
    }
  }

  function openSettings() {
    currentPage = 'settings';
    currentChatName = null;
    var cfg = {};
    try { var raw = VIEW.localStorage.getItem('sbnyc_api_cfg'); if (raw) cfg = JSON.parse(raw) || {}; } catch (e) {}
    var h = '<div class="sb-ch"><button class="sb-ch-back">‹</button><div class="sb-ch-name"><b>手机设置</b><small>independent API</small></div></div>';
    h += '<div class="sb-msgs" style="display:block;padding-top:16px;">';
    h += '<div class="sb-frow"><label>API 地址（OpenAI 兼容，留空 = 走主 API）</label><textarea id="sbnyc-cfg-url" rows="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore placeholder="https://api.xxx.com/v1">' + esc(cfg.url || '') + '</textarea></div>';
    // type=password 会勾出安卓输入法的密码管理器（玩家投诉）——改 text + CSS 圆点遮罩 + 各家密码管理器忽略标记 + readonly到聚焦（安卓 autofill 最认这招）
    h += '<div class="sb-frow"><label>API Key</label><input id="sbnyc-cfg-key" type="text" class="sb-mask" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" readonly data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="sk-..." value="' + esc(cfg.key || '') + '"></div>';
    h += '<div class="sb-frow"><label>模型名（🔄 拉取后下面出下拉可选）</label><input id="sbnyc-cfg-model" list="sbnyc-cfg-models" placeholder="gpt-4o-mini" value="' + esc(cfg.model || '') + '"><datalist id="sbnyc-cfg-models"></datalist>' +
      '<select id="sbnyc-cfg-modelsel" style="display:none;margin-top:4px;border:.5px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12px;background:#fff;color:var(--ink);"></select></div>';
    h += '<div style="display:flex;gap:8px;margin:4px 14px 10px;">' +
      '<button class="sb-abtn" id="sbnyc-cfg-fetch" style="flex:1;">🔄 拉取模型</button>' +
      '<button class="sb-abtn" id="sbnyc-cfg-save" style="flex:1;">💾 保存</button>' +
      '<button class="sb-abtn" id="sbnyc-cfg-clear" style="flex:1;">🗑️ 清除</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">填了独立 API 后，私信生成完全不占主 API 的每分钟限额，也不再限速排队。Key 只存这台浏览器本地，不进聊天文件。</div>';
    // 显示偏好：盲盒模式（藏标签）
    var blindOn = panel.classList.contains('blindbox');
    h += '<div class="sb-sec" style="margin-top:16px;">显示 · Display</div>';
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-blind-toggle" style="flex:1;">' + (blindOn ? '🎁 盲盒模式已开（点我显示身份标签）' : '🏷️ 身份标签已显示（点我开盲盒）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">盲盒模式：藏起所有人的身份标签（「巨鲸·阔绰」这种），只留名字，谁是谁、什么来路自己从聊天里猜。</div>';
    // 手机对话写进正文：两个独立开关（可同时开），都默认关
    var tailOn = false, layerOn = false;
    try { tailOn = VIEW.localStorage.getItem('sbnyc_floorlog') === '1'; } catch (e) {}
    try { layerOn = VIEW.localStorage.getItem('sbnyc_floorlog2') === '1'; } catch (e) {}
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-floor-toggle" style="flex:1;">📄 私信摘要贴正文楼尾：' + (tailOn ? '开（点我关）' : '关（点我开）') + '</button></div>';
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-floor2-toggle" style="flex:1;">📱 手机动态独立折叠层：' + (layerOn ? '开（点我关）' : '关（点我开）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">两种"写进正文"随你挑（也可以都开）：<b>📄 贴正文楼尾</b>=每轮私信压成小引用块，接在剧情正文最后一楼的尾巴上（最早那版）；<b>📱 独立动态层</b>=专门一层记手机上的一切（私信/买东西/卖二手/付账单），平时折叠点开才看，你没发言前都更新在同一层。两种都<b>只记你回复过的对话</b>：你一回复，TA之前的搭讪+你的回复+TA的回应整段进正文；从头到尾没搭理的人一个字不占正文。两种正文 AI 都读得到。<b>都关着也不影响正文「知道」手机内容</b>——后台另有隐形记忆在同步。默认都关。</div>';
    // 🧠 AI 记忆的私信条数：60/150/300 三档循环
    var memN = 150; try { memN = parseInt(VIEW.localStorage.getItem('sbnyc_dm_mem'), 10) || 150; } catch (e) {}
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-mem-toggle" style="flex:1;">🧠 AI 记忆的私信条数：' + memN + ' 条（点我换挡）</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">正文 AI 每次生成能"记得"的手机私信总条数（正在聊的前3人分大头，其余每人8条）。嫌 AI 对手机上的事失忆就调大（最高300），嫌费 token 就调小。默认 150。</div>';
    // 📖 反方向：手机读正文的楼层数（4/8/16/24 循环）——决定私信 NPC 对线下剧情知道多少
    var plotN = 8; try { plotN = parseInt(VIEW.localStorage.getItem('sbnyc_plot_n'), 10) || 8; } catch (e) {}
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-plot-toggle" style="flex:1;">📖 手机读正文的楼层数：' + plotN + ' 层（点我换挡）</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">生成私信时，手机能"看见"的最近正文层数——决定线上的人知不知道你线下干了什么（比如你已经在 T. 家过夜了，S. 的推送该不该心里有数）。调大=私信更贴剧情但更费 token。默认 8 层。</div>';
    // 剧情起始日期（UWU 日期体系：日历/消息日期/流水日期都从这天起算）
    h += '<div class="sb-sec" style="margin-top:16px;">剧情 · Story</div>';
    var currentEpoch = (state && state.game && state.game.epoch) || GAME_EPOCH_STR;
    h += '<div class="sb-frow"><label>游戏起始日期（YYYY-MM-DD，影响日历和消息日期 · 来自UWU）</label><input id="sbnyc-epoch-input" type="text" placeholder="' + GAME_EPOCH_STR + '" value="' + esc(currentEpoch) + '"></div>';
    // 当前剧情日期（UWU v5：一目了然，不用心算）
    var gdNow = (state && state.game && state.game.day) || 1;
    h += '<div style="margin:2px 14px;font-size:12px;color:var(--ink);">📅 当前剧情日期：<b>' + esc(fmtMDWeekdayCN(gdNow)) + '</b> · 第 <b>' + gdNow + '</b> 天' +
      ((state && state.game && state.game.epochLocked) ? ' · <span style="color:var(--gold);">🔒 已从正文自动捕获</span>' : ' · <span style="color:var(--ink-faint);">等待正文首次输出 TIME 后自动设定</span>') + '</div>';
    h += '<div style="display:flex;margin:4px 14px 10px;"><button class="sb-abtn" id="sbnyc-epoch-save" style="flex:1;">💾 保存起始日期</button></div>';
    // 功能开关（UWU）
    h += '<div class="sb-sec" style="margin-top:16px;">功能 · Features</div>';
    var taxOn = false;
    try { taxOn = VIEW.localStorage.getItem('sbnyc_tax_enabled') === '1'; } catch (e) {}
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-tax-toggle" style="flex:1;">🧾 税务功能（来自UWU）：' + (taxOn ? '开（点我关）' : '关（点我开）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">开启后「💳 流水」页右上角出现 🧾 税务中心——阿美莉卡的钱不是白挣的，IRS 会来找你聊聊。默认关闭。</div>';
    // 消息回退开关（来自UWU：重roll/删除消息时转账和礼物自动回退）
    var rbOn = rollbackEnabled();
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-rollback-toggle" style="flex:1;">💰 消息回退（来自UWU）：' + (rbOn ? '开（点我关）' : '关（点我开）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">重roll或删除消息时，消息里的转账自动退钱、礼物从衣橱回收。适合想要财务记录保持严谨的玩家。默认开启。</div>';
    // 感官反馈（UWU：震动发光 + 壁纸）
    h += '<div class="sb-sec" style="margin-top:16px;">感官 · Sensory</div>';
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-vibrate-toggle" style="flex:1;">📳 消息震动+发光（来自UWU）：' + (vibrateEnabled ? '开（点我关）' : '关（点我开）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">有新消息时悬浮球闪金光 + 手机面板轻抖一下（纯CSS动画，手机电脑都有效）。</div>';
    var hasWp = false;
    try { hasWp = !!VIEW.localStorage.getItem('sbnyc_wallpaper'); } catch (e) {}
    h += '<div style="margin:8px 14px 4px;display:flex;align-items:center;gap:8px;"><span style="font-size:12px;color:var(--ink);">🖼️ 手机壁纸：</span>' +
      '<label class="sb-wp-upload"><span id="sbnyc-wp-label">' + (hasWp ? '更换图片' : '上传图片') + '</span><input type="file" id="sbnyc-wp-input" accept="image/*"></label>' +
      (hasWp ? '<span class="sb-wp-clear" id="sbnyc-wp-clear">清除壁纸</span>' : '') + '</div>';
    // 壁纸清晰度（UWU：用户反馈不清晰→自定义透明度）
    var wpOp = '0.85';
    try { wpOp = VIEW.localStorage.getItem('sbnyc_wallpaper_opacity') || '0.85'; } catch (e) {}
    var wpopLabel = { '0.60': '极柔和', '0.85': '标准', '1.00': '完全清晰' };
    h += '<div style="margin:4px 14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      '<span style="font-size:11px;color:var(--ink-sub);">清晰度：</span>' +
      '<button class="sb-abtn sb-wpop-btn" data-op="0.60" style="flex:0 0 auto;' + (wpOp === '0.60' ? 'background:var(--gold);color:#fff;' : '') + '">柔和</button>' +
      '<button class="sb-abtn sb-wpop-btn" data-op="0.85" style="flex:0 0 auto;' + (wpOp === '0.85' ? 'background:var(--gold);color:#fff;' : '') + '">标准</button>' +
      '<button class="sb-abtn sb-wpop-btn" data-op="1.00" style="flex:0 0 auto;' + (wpOp === '1.00' ? 'background:var(--gold);color:#fff;' : '') + '">清晰</button>' +
      '<span style="font-size:10px;color:var(--ink-faint);margin-left:4px;">当前：' + (wpopLabel[wpOp] || '自定义') + '</span></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:2px 16px 6px;">支持 JPG/PNG/GIF。清晰度越高壁纸越鲜明，但可能影响文字阅读——按自己舒服来。</div>';
    // 藐姑射仙老师的透明背景模式（UWU：壁纸全透，聊天和消息区底色透明让壁纸整个露出来）
    var wpSolid = false;
    try { wpSolid = VIEW.localStorage.getItem('sbnyc_wp_solid') === '1'; } catch (e) {}
    if (wpSolid) panel.classList.add('wp-solid');
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-wp-solid-toggle" style="flex:1;">❤️ 爱来自藐姑射仙老师：' + (wpSolid ? '透明已关（点我开）' : '透明已开（点我关）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:2px 16px 6px;">透明背景模式：聊天页和消息列表的底色变为透明，壁纸完整可见。默认开启——这是藐姑射仙老师的心意。</div>';
    // 🎨 AI生图画风预设（UWU）：localStorage sbnyc_img_style（'0'=不开 '1'=厚涂 '2'=平涂）
    var imgSty = imgStylePreset();
    h += '<div style="margin:8px 14px 4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      '<span style="font-size:12px;color:var(--ink);">🎨 AI生图画风（来自UWU）：</span>' +
      '<button class="sb-abtn sb-imgsty-btn" data-sty="0" style="flex:0 0 auto;' + (imgSty === '0' ? 'background:var(--gold);color:#fff;' : '') + '">不加</button>' +
      '<button class="sb-abtn sb-imgsty-btn" data-sty="1" style="flex:0 0 auto;' + (imgSty === '1' ? 'background:var(--gold);color:#fff;' : '') + '">厚涂油画</button>' +
      '<button class="sb-abtn sb-imgsty-btn" data-sty="2" style="flex:0 0 auto;' + (imgSty === '2' ? 'background:var(--gold);color:#fff;' : '') + '">平涂插画</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:2px 16px 6px;">聊天 ➕ 菜单里的「🎨 AI生图」会自动拼上所选画风。预设不含人物描述——适合场景/氛围/静物/光影，不适合生成人物。</div>';
    // 联机区块（SugarRank 排行榜 + 全服橱窗）
    var oc = onlineCfg();
    h += '<div class="sb-sec" style="margin-top:16px;">Online · 联机</div>';
    h += '<div class="sb-frow"><label>排行榜名字（就填这个 · 上榜显示的马甲，跨聊天通用）</label><textarea id="sbnyc-on-handle" rows="1" maxlength="20" autocomplete="off" data-lpignore="true" data-1p-ignore placeholder="起个名字就能上榜">' + esc(oc.handle) + '</textarea></div>';
    // 服务器/Key 是自建服的高级选项，收进折叠里——用官方服的玩家根本不用碰（留空即官方服）
    var advOpen = (oc.server || oc.key) ? ' open' : '';
    h += '<details' + advOpen + ' style="margin:0 14px 6px;"><summary style="font-size:11px;color:var(--ink-faint);cursor:pointer;padding:4px 2px;list-style:none;">⚙ 高级 · 自建服务器（用官方服的不用点开）</summary>';
    h += '<div class="sb-frow" style="margin-left:0;"><label>联机服务器（留空 = 官方服）</label><textarea id="sbnyc-on-server" rows="1" autocomplete="off" data-lpignore="true" data-1p-ignore placeholder="https://xxx.supabase.co">' + esc(oc.server) + '</textarea></div>';
    h += '<div class="sb-frow"><label>服务器 Key（用官方服留空）</label><input id="sbnyc-on-key" autocomplete="off" readonly data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="sb_publishable_..." value="' + esc(oc.key) + '"></div></details>';
    h += '<div style="display:flex;margin:4px 14px 10px;"><button class="sb-abtn" id="sbnyc-on-toggle" style="flex:1;">' + (oc.off ? '🔌 联机已全关（点我打开）' : '🌐 联机已开（点我全关）') + '</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">起个排行榜名字，点「更新我的排名」就能上全服榜。联机只做两件事：拉全服橱窗上新、你主动点更新时上传 名字+余额数字。私信、剧情、人设永远不上传。全关后本卡零网络请求。</div>';
    // 数据导入导出 + 回档（来自 UWU 老师：换聊天/开新档时迁移记录用）
    // 硬化点（合并时加）：import/reset 的 SBupdate 保留整个变量根 v、只改 v.sb，绝不用 {sb:X} 整替——防误删别的扩展存的顶层聊天变量
    h += '<div class="sb-sec" style="margin-top:16px;">数据 · Data</div>';
    h += '<div style="display:flex;margin:4px 14px 6px;gap:8px;"><button class="sb-abtn" id="sbnyc-export" style="flex:1;">📤 导出全部数据</button><button class="sb-abtn" id="sbnyc-import" style="flex:1;">📥 导入数据</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">导出 = 把全部手机数据（联系人/钱包/衣橱/日程/私信记录/设置）下载为一个 .json 文件。导入 = 选之前导出的文件覆盖当前数据。<b>导入不可逆，建议先导出一份备份。</b></div>';
    h += '<div style="display:flex;margin:4px 14px 6px;"><button class="sb-abtn" id="sbnyc-reset" style="flex:1;color:var(--red);">🔄 初始化聊天（回档到 Day 1）</button></div>';
    h += '<div class="sb-empty" style="font-style:normal;text-align:left;padding:4px 16px;">重置所有联系人和私信记录，游戏日回到第 1 天，钱包/日程清空——但保留你的个人档案（名字/年龄/签证/学校）。需<b>连续确认三次</b>才会执行，防止误触。</div>';
    // 二创致谢（Fan 拍板的署名规则：有开关的写在开关上，没开关的列在这里）
    h += '<div class="sb-empty" style="padding:14px 16px 18px;">🎁 📅日历 · 💳流水 · 🖼️壁纸 · ⏱点时间校准 · 消息带日期与时间分割线 —— 来自 UWU 老师的二创贡献<br>❤️ 透明背景模式 —— 来自藐姑射仙老师，爱来自藐姑射仙</div>';
    h += '</div>';
    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    chatEl.querySelector('.sb-ch-back').addEventListener('click', closeChat);
    // 🔄 拉取模型：也是连通性测试——拉得到 = 地址/Key/CORS 都通，私信生成基本就能用
    var fbtn = chatEl.querySelector('#sbnyc-cfg-fetch');
    fbtn.addEventListener('click', async function () {
      var u = chatEl.querySelector('#sbnyc-cfg-url').value.trim();
      var k = chatEl.querySelector('#sbnyc-cfg-key').value.trim();
      if (!u || !k) { toast('warning', '先填 API 地址和 Key'); return; }
      fbtn.textContent = '⏳ 拉取中…';
      try {
        var mu = u.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
        mu = /\/v\d+$/.test(mu) ? mu + '/models' : mu + '/v1/models';
        var resp = await fetch(mu, { headers: { 'Authorization': 'Bearer ' + k } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var j = await resp.json();
        var ids = (j.data || j.models || []).map(function (m) { return (m && (m.id || m.name)) || m; }).filter(function (x) { return typeof x === 'string'; });
        if (!ids.length) throw new Error('返回里没有模型列表');
        chatEl.querySelector('#sbnyc-cfg-models').innerHTML = ids.map(function (id) { return '<option value="' + esc(id) + '">'; }).join('');
        // 安卓不支持 datalist → 同时给一个真 <select>（选中自动填进输入框）
        var sel = chatEl.querySelector('#sbnyc-cfg-modelsel');
        sel.innerHTML = '<option value="">— 从 ' + ids.length + ' 个模型里选 —</option>' + ids.map(function (id) { return '<option value="' + esc(id) + '">' + esc(id) + '</option>'; }).join('');
        sel.style.display = 'block';
        sel.onchange = function () { if (sel.value) chatEl.querySelector('#sbnyc-cfg-model').value = sel.value; };
        var mi = chatEl.querySelector('#sbnyc-cfg-model');
        if (!mi.value.trim()) mi.value = ids[0];
        toast('success', '📡 拉到 ' + ids.length + ' 个模型——连通性OK，选一个再保存');
        fbtn.textContent = '🔄 拉取模型 (' + ids.length + ')';
      } catch (e) {
        toast('error', '拉取失败: ' + ((e && e.message) || e) + '。多半是地址不对 / Key 无效 / 该服务不允许浏览器直连(CORS)');
        fbtn.textContent = '🔄 拉取模型';
      }
    });
    // Key 框 readonly 到聚焦才解锁：安卓 autofill 只认这招，真点进去照常能输入（两个 key 框都套）
    var kIn = chatEl.querySelector('#sbnyc-cfg-key');
    if (kIn) kIn.addEventListener('focus', function () { kIn.removeAttribute('readonly'); });
    var kIn2 = chatEl.querySelector('#sbnyc-on-key');
    if (kIn2) kIn2.addEventListener('focus', function () { kIn2.removeAttribute('readonly'); });
    var blindBtn = chatEl.querySelector('#sbnyc-blind-toggle');
    if (blindBtn) blindBtn.addEventListener('click', function () { applyBlind(!panel.classList.contains('blindbox')); openSettings(); });
    var floorBtn = chatEl.querySelector('#sbnyc-floor-toggle');
    if (floorBtn) floorBtn.addEventListener('click', function () {
      var cur = false; try { cur = VIEW.localStorage.getItem('sbnyc_floorlog') === '1'; } catch (e) {}
      try { VIEW.localStorage.setItem('sbnyc_floorlog', cur ? '0' : '1'); } catch (e) {}
      toast('info', cur ? '📄 私信摘要不再贴正文楼尾' : '📄 私信摘要会贴在正文楼尾');
      openSettings();
    });
    var floor2Btn = chatEl.querySelector('#sbnyc-floor2-toggle');
    if (floor2Btn) floor2Btn.addEventListener('click', function () {
      var cur2 = false; try { cur2 = VIEW.localStorage.getItem('sbnyc_floorlog2') === '1'; } catch (e) {}
      try { VIEW.localStorage.setItem('sbnyc_floorlog2', cur2 ? '0' : '1'); } catch (e) {}
      toast('info', cur2 ? '📱 手机动态层已关' : '📱 手机动态会记进独立折叠层');
      openSettings();
    });
    var memBtn = chatEl.querySelector('#sbnyc-mem-toggle');
    if (memBtn) memBtn.addEventListener('click', function () {
      var cur3 = 150; try { cur3 = parseInt(VIEW.localStorage.getItem('sbnyc_dm_mem'), 10) || 150; } catch (e) {}
      var next3 = cur3 === 60 ? 150 : (cur3 === 150 ? 300 : 60);   // 60 → 150 → 300 → 60
      try { VIEW.localStorage.setItem('sbnyc_dm_mem', String(next3)); } catch (e) {}
      toast('info', '🧠 AI 现在记最近 ' + next3 + ' 条私信');
      SBemit('sb_updated');   // 立刻按新档位重算注入
      openSettings();
    });
    var plotBtn = chatEl.querySelector('#sbnyc-plot-toggle');
    if (plotBtn) plotBtn.addEventListener('click', function () {
      var cur4 = 8; try { cur4 = parseInt(VIEW.localStorage.getItem('sbnyc_plot_n'), 10) || 8; } catch (e) {}
      var next4 = cur4 === 4 ? 8 : (cur4 === 8 ? 16 : (cur4 === 16 ? 24 : 4));   // 4 → 8 → 16 → 24 → 4
      try { VIEW.localStorage.setItem('sbnyc_plot_n', String(next4)); } catch (e) {}
      toast('info', '📖 手机现在读最近 ' + next4 + ' 层正文');
      openSettings();
    });
    // 起始日期保存（UWU）
    var epochInput = chatEl.querySelector('#sbnyc-epoch-input');
    var epochSave = chatEl.querySelector('#sbnyc-epoch-save');
    if (epochInput && epochSave) epochSave.addEventListener('click', function () {
      var val = (epochInput.value || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) { toast('warning', '格式错误——要 YYYY-MM-DD，比如 ' + GAME_EPOCH_STR); return; }
      SBupdate(function (v) { if (v.sb && v.sb.game) { v.sb.game.epoch = val; v.sb.game.epochLocked = true; } return v; });
      if (state && state.game) { state.game.epoch = val; state.game.epochLocked = true; }
      toast('success', '📅 起始日期已更新为 ' + val + '（已锁定）');
    });
    // 税务开关（UWU）
    var taxToggle = chatEl.querySelector('#sbnyc-tax-toggle');
    if (taxToggle) taxToggle.addEventListener('click', function () {
      var curT = false;
      try { curT = VIEW.localStorage.getItem('sbnyc_tax_enabled') === '1'; } catch (e) {}
      try { VIEW.localStorage.setItem('sbnyc_tax_enabled', curT ? '0' : '1'); } catch (e) {}
      toast('info', curT ? '🧾 税务功能已关闭——IRS 假装没看见你' : '🧾 税务功能已开启——去「💳 流水」页右上角报税');
      openSettings();
    });
    // 消息回退开关（来自UWU）
    var rollbackToggle = chatEl.querySelector('#sbnyc-rollback-toggle');
    if (rollbackToggle) rollbackToggle.addEventListener('click', function () {
      var curR = rollbackEnabled();
      try { VIEW.localStorage.setItem('sbnyc_rollback_enabled', curR ? '0' : '1'); } catch (e) {}
      toast('info', curR ? '💰 消息回退已关闭——删消息不退款，收两次钱也很开心' : '💰 消息回退已开启——重roll和删除消息时转账/礼物自动回退');
      openSettings();
    });
    // 震动开关（UWU）
    var vibBtn = chatEl.querySelector('#sbnyc-vibrate-toggle');
    if (vibBtn) vibBtn.addEventListener('click', function () {
      vibrateEnabled = !vibrateEnabled;
      try { VIEW.localStorage.setItem('sbnyc_vibrate', vibrateEnabled ? '1' : '0'); } catch (e) {}
      toast('info', vibrateEnabled ? '📳 震动+发光已开启' : '🔇 震动+发光已关闭');
      openSettings();
    });
    // 壁纸上传/清除（UWU）
    var wpInput = chatEl.querySelector('#sbnyc-wp-input');
    if (wpInput) wpInput.addEventListener('change', function () {
      var file = wpInput.files && wpInput.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { toast('warning', '图片太大——请用 8MB 以下的文件'); return; }
      var reader = new FileReader();
      reader.onload = function (e2) {
        try { VIEW.localStorage.setItem('sbnyc_wallpaper', e2.target.result); } catch (e3) { toast('error', '存储失败，可能空间不足——换张小点的图'); return; }
        applyWallpaper();
        toast('success', '🖼️ 壁纸已更新');
        openSettings();
      };
      reader.onerror = function () { toast('error', '图片读取失败——换一张试试'); };
      reader.readAsDataURL(file);
    });
    var wpClear = chatEl.querySelector('#sbnyc-wp-clear');
    if (wpClear) wpClear.addEventListener('click', function () {
      try { VIEW.localStorage.removeItem('sbnyc_wallpaper'); } catch (e) {}
      applyWallpaper();
      toast('info', '壁纸已清除');
      openSettings();
    });
    // 壁纸清晰度按钮
    var wpopBtns = chatEl.querySelectorAll('.sb-wpop-btn');
    for (var wpi = 0; wpi < wpopBtns.length; wpi++) {
      (function (b) {
        b.addEventListener('click', function () {
          try { VIEW.localStorage.setItem('sbnyc_wallpaper_opacity', b.getAttribute('data-op')); } catch (e) {}
          applyWallpaper();
          openSettings();
        });
      })(wpopBtns[wpi]);
    }
    // 🎨 AI生图画风预设按钮（UWU）
    var imgStyBtns = chatEl.querySelectorAll('.sb-imgsty-btn');
    for (var isi = 0; isi < imgStyBtns.length; isi++) {
      (function (b) {
        b.addEventListener('click', function () {
          try { VIEW.localStorage.setItem('sbnyc_img_style', b.getAttribute('data-sty')); } catch (e) {}
          openSettings();
        });
      })(imgStyBtns[isi]);
    }
    // 藐姑射仙老师的透明背景切换
    var wpSolidBtn = chatEl.querySelector('#sbnyc-wp-solid-toggle');
    if (wpSolidBtn) wpSolidBtn.addEventListener('click', function () {
      var cur = panel.classList.contains('wp-solid');
      if (cur) { panel.classList.remove('wp-solid'); try { VIEW.localStorage.setItem('sbnyc_wp_solid', '0'); } catch (e) {} }
      else { panel.classList.add('wp-solid'); try { VIEW.localStorage.setItem('sbnyc_wp_solid', '1'); } catch (e) {} }
      openSettings();
    });
    // 📤 导出全部 sb 数据
    var exportBtn = chatEl.querySelector('#sbnyc-export');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      try {
        var data = SBgetVars();
        var json = JSON.stringify(data.sb || data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = DOC.createElement('a');
        a.href = url;
        a.download = 'SugarOS_backup_' + new Date().toISOString().slice(0, 10) + '.json';
        DOC.body.appendChild(a); a.click(); DOC.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('success', '📤 已导出备份文件');
      } catch (e) { toast('error', '导出失败: ' + ((e && e.message) || e)); }
    });
    // 📥 导入数据
    var importBtn = chatEl.querySelector('#sbnyc-import');
    if (importBtn) importBtn.addEventListener('click', function () {
      var input = DOC.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e2) {
          try {
            var imported = JSON.parse(e2.target.result);
            var sb = imported.sb || imported;
            if (!sb || typeof sb !== 'object') throw new Error('格式不对——找不到 sb 数据');
            SBupdate(function (v) { if (!v) v = {}; v.sb = sb; return v; });
            if (state) { state = sb; }
            toast('success', '📥 数据已导入——手机将刷新');
            SBemit('sb_updated');
            closeChat();
          } catch (e3) { toast('error', '导入失败: ' + ((e3 && e3.message) || e3) + '。请确认是 .json 备份文件。'); }
        };
        reader.onerror = function () { toast('error', '文件读取失败'); };
        reader.readAsText(file);
      });
      input.click();
    });
    // 🔄 初始化聊天（三次确认）
    var resetBtn = chatEl.querySelector('#sbnyc-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      var step = 0;
      var prompts = [
        '确定要初始化聊天吗？所有联系人、私信、钱包记录都会被清空——但你的个人档案会保留。这是第一次确认。',
        '再确认一次：初始化后游戏日回到第 1 天，日程清空，钱包归零。个人档案（名字/年龄/签证/学校/外形/家庭背景）保留。这是第二次确认。',
        '最后一次确认：初始化不可逆。你之前导出的备份可以导入恢复。确认要执行吗？'
      ];
      function askNext() {
        if (step >= 3) {
          // 执行初始化——保留 profile，其余回档
          var savedProfile = (state && state.profile) ? JSON.parse(JSON.stringify(state.profile)) : {};
          SBupdate(function (v) {
            var fresh = {
              profile: savedProfile,
              wallet: { balance: 0, bills: [], transactions: [], allTransactions: [] },
              npcs: {},
              beauty: { charm: 50, treatments: [] },
              lifestyle: { apartment: 'studio', monthly_burn: 0 },
              schedule: [],
              sugarelite: { subscribed: false, tier: 'none' },
              game: { day: 1, time: '', date: '', nsfw: true, epoch: (v.sb && v.sb.game && v.sb.game.epoch) || GAME_EPOCH_STR, epochLocked: !!(v.sb && v.sb.game && v.sb.game.epochLocked) },
              taxQuestions: null,
              akumaRank: 0,
            };
            if (!v) v = {}; v.sb = fresh; return v;
          });
          if (state) {
            state = {
              profile: savedProfile,
              wallet: { balance: 0, bills: [], transactions: [], allTransactions: [] },
              npcs: {}, beauty: { charm: 50, treatments: [] },
              lifestyle: { apartment: 'studio', monthly_burn: 0 }, schedule: [],
              sugarelite: { subscribed: false, tier: 'none' },
              game: { day: 1, time: '', date: '', nsfw: true, epoch: (state.game && state.game.epoch) || GAME_EPOCH_STR, epochLocked: !!(state.game && state.game.epochLocked) },
              taxQuestions: null, akumaRank: 0,
            };
          }
          toast('success', '🔄 已初始化——回到 Day 1。个人档案已保留。');
          SBemit('sb_updated');
          closeChat();
          return;
        }
        var ok = (DOC.defaultView || window).confirm(prompts[step]);
        if (ok) { step++; askNext(); }
      }
      askNext();
    });
    chatEl.querySelector('#sbnyc-on-toggle').addEventListener('click', function () {
      var c2 = onlineCfg(); c2.off = !c2.off; saveOnlineCfg(c2);
      toast('info', c2.off ? '🔌 联机已全关，零网络请求' : '🌐 联机已打开');
      openSettings();
    });
    chatEl.querySelector('#sbnyc-cfg-save').addEventListener('click', function () {
      var c = {
        url: chatEl.querySelector('#sbnyc-cfg-url').value.trim(),
        key: chatEl.querySelector('#sbnyc-cfg-key').value.trim(),
        model: chatEl.querySelector('#sbnyc-cfg-model').value.trim(),
      };
      try { VIEW.localStorage.setItem('sbnyc_api_cfg', JSON.stringify(c)); } catch (e) { toast('error', '保存失败: ' + e.message); return; }
      var oc2 = onlineCfg();
      oc2.handle = chatEl.querySelector('#sbnyc-on-handle').value.trim().slice(0, 20);
      oc2.server = chatEl.querySelector('#sbnyc-on-server').value.trim();
      oc2.key = chatEl.querySelector('#sbnyc-on-key').value.trim();
      saveOnlineCfg(oc2);
      _pool = null; _poolAt = 0; _rank = null; _rankAt = 0;   // 换了服就清缓存
      toast('success', c.url && c.key ? '🔌 独立API已启用' : '已保存');
      setStatus(c.url && c.key ? '🔌 独立API已启用' : '🏠 走主API');
      closeChat();
    });
    chatEl.querySelector('#sbnyc-cfg-clear').addEventListener('click', function () {
      try { VIEW.localStorage.removeItem('sbnyc_api_cfg'); } catch (e) {}
      toast('info', '已清除，私信回到主API（带限速）');
      setStatus('🏠 走主API');
      closeChat();
    });
  }

  function openChat(name, npc) {
    currentChatName = name;
    currentPage = null;
    _msel = null;   // 重渲染会把选中态和底部条一起冲掉，模式标记也必须归零（不然点什么都变勾选）
    npc.unread = 0;
    SBupdate(function (v) { if (v.sb && v.sb.npcs && v.sb.npcs[name]) v.sb.npcs[name].unread = 0; return v; });
    updateBadge();
    var isSE = name === 'SugarElite™';
    var hist = npc.dm_history || [];
    var h = '<div class="sb-ch"><button class="sb-ch-back">‹</button><div class="sb-ch-name"><b' + (isSE ? ' class="se"' : '') + '>' + esc(name) + '</b><small class="sb-arche">' + esc(npc.archetype || '') + '</small></div>' +
      '<button class="sb-ch-pin' + (npc.pinned ? ' on' : '') + '" title="置顶/取消置顶（置顶的联系人不会被自动清理）">📌</button>' +
      '<button class="sb-ch-del" title="删除聊天记录">🗑️</button></div>';
    h += '<div class="sb-msgs">';
    if (!hist.length) h += '<div class="sb-empty">No messages yet</div>';
    else {
      var lastThemIdx = -1;
      for (var li = hist.length - 1; li >= 0; li--) { if (hist[li].sender === 'THEM') { lastThemIdx = li; break; } }
      var prevMsg = null;   // 时间分割线（UWU）：跨天插日期条，同天隔1小时+插时间条
      for (var i = 0; i < hist.length; i++) {
        var dv = dividerBetween(prevMsg, hist[i]);
        if (dv) h += dividerHtml(dv);
        var autoTr = !!(_pendingTrs[name + '|' + i] && hist[i].zh);
        if (autoTr) delete _pendingTrs[name + '|' + i];   // 刚才点了兜底翻译的那条：翻好自动展开（字典各销各的账）
        h += renderOneMsg(hist[i], name, i, autoTr, i === lastThemIdx, i === hist.length - 1);   // 对方最后一条挂 reroll；自己的最后一条挂撤回
        prevMsg = hist[i];
      }
    }
    h += '</div>';
    // 所有动作收进输入栏左边的 ➕（User 定稿：按钮太散，收在一起）——快捷键/照片/语音/定位/转账/发链接全在里面
    h += '<div class="sb-cbar"><button class="plus" title="更多动作：照片/语音/定位/转账/链接…">➕</button><textarea rows="1" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="回车攒消息，可连打几条…"></textarea><button class="send" title="让 ' + esc(name) + ' 回复">发送</button></div>';

    chatEl.innerHTML = h; chatEl.style.display = 'flex'; root.style.display = 'none';
    var me = chatEl.querySelector('.sb-msgs'); if (me) me.scrollTop = me.scrollHeight;

    chatEl.querySelector('.sb-ch-back').addEventListener('click', closeChat);
    var pinBtn = chatEl.querySelector('.sb-ch-pin');
    pinBtn.addEventListener('click', function () {
      var now = !npc.pinned;
      npc.pinned = now;
      SBupdate(function (v) { if (v.sb && v.sb.npcs && v.sb.npcs[name]) v.sb.npcs[name].pinned = now; return v; });
      pinBtn.classList.toggle('on', now);
      toast('info', now ? '📌 已置顶 ' + name + '（不会被自动清理）' : '已取消置顶 ' + name);
    });
    chatEl.querySelector('.sb-ch-del').addEventListener('click', function () {
      var ok = true;
      try { ok = (DOC.defaultView || window).confirm('删除与 ' + name + ' 的全部聊天记录' + (npc.persistent ? '？（固定联系人：清空记录并让TA安静——直到你主动再发消息给TA）' : '？（联系人也会一起移除）')); } catch (e) {}
      if (!ok) return;
      // 回退全部消息的财务影响（删整段聊天 = 这段关系在账面上归档）
      rollbackMsgEffects(name, hist, (state && state.wallet) || {}, (state && state.closet) || []);
      SBupdate(function (v) {
        if (!v.sb || !v.sb.npcs || !v.sb.npcs[name]) return v;
        // 变量持久化端回退（带流水记录）
        rollbackMsgEffects(name, v.sb.npcs[name].dm_history || [], v.sb.wallet || {}, v.sb.closet || [], true);
        // 固定NPC删记录=冷处理：muted 后生成器和硬闸都禁止TA再发（L. 也不例外），User 主动发消息才解除
        if (npc.persistent) { var n = v.sb.npcs[name]; n.dm_history = []; n.last_message = ''; n.unread = 0; n.engaged = false; n.muted = true; }
        else delete v.sb.npcs[name];
        return v;
      });
      if (npc.persistent) { npc.dm_history = []; npc.last_message = ''; npc.unread = 0; npc.engaged = false; npc.muted = true; }
      else if (state && state.npcs) delete state.npcs[name];
      SBemit('sb_updated');   // 让注入摘要也同步刷新（被删的对话不再回灌主线）
      SBemit('sb_scrub_floor', { name: name });   // 整段聊天删了 → 楼层里TA的誊抄段落全部擦掉
      closeChat();
    });
    var input = chatEl.querySelector('.sb-cbar textarea');
    var sendBtn = chatEl.querySelector('.sb-cbar .send');

    // 新交互：回车=攒消息（可连打几条），发送键=让 TA 回复（学两个用户的建议，统一简单）
    // queueMsg 只把消息记下+显示，不触发生成；replyOne(发送键)才让这个人一次性回应攒的全部
    function queueMsg(txt, mtype, extra) {   // extra：调用方塞额外字段（如 imgUrl），不改原有调用（UWU）
      var text = txt || input.value.trim(); if (!text) return;
      var t = nowT(); var ty = mtype || 'text';
      var gDay = (state && state.game && state.game.day) || 1;
      npc.engaged = true;
      if (!npc.dm_history) npc.dm_history = [];
      var prevQ = npc.dm_history.length ? npc.dm_history[npc.dm_history.length - 1] : null;   // 分割线要看上一条
      var msgObj = { sender: 'USER', time: t, ts: Date.now(), type: ty, content: text, note: '', gameDay: gDay };
      if (extra) { for (var ek in extra) { if (extra.hasOwnProperty(ek)) msgObj[ek] = extra[ek]; } }
      npc.dm_history.push(msgObj);
      if (npc.dm_history.length > 400) npc.dm_history = npc.dm_history.slice(-400);
      SBupdate(function (v) {
        if (!v.sb) return v; if (!v.sb.npcs) v.sb.npcs = {};
        var n = v.sb.npcs[name]; if (!n) return v;
        if (!n.dm_history) n.dm_history = [];
        var vObj = { sender: 'USER', time: t, ts: Date.now(), type: ty, content: text, note: '', gameDay: gDay };
        if (extra) { for (var ek2 in extra) { if (extra.hasOwnProperty(ek2)) vObj[ek2] = extra[ek2]; } }
        n.dm_history.push(vObj);
        if (n.dm_history.length > 400) n.dm_history = n.dm_history.slice(-400);
        n.engaged = true; n.unread = 0; n.last_ts = Date.now(); n.last_contact = t; n.muted = false;
        n.last_message = lastPreview({ sender: 'USER', type: ty, content: text });   // 列表显示"你：xxx"——一眼知道回过没
        return v;
      });
      npc.muted = false;   // User 主动开口 = 解除冷处理
      npc.last_message = lastPreview({ sender: 'USER', type: ty, content: text });
      var obLine = text;
      if (ty === 'image') obLine = '（发了一张照片，TA能看到：' + text + '）';
      else if (ty === 'voice') obLine = '（发了一段语音，TA能听到：' + text + '）';
      else if (ty === 'transfer') obLine = '（转账 $' + text + ' 给TA）';
      queueOutbox(name, obLine);
      input.value = '';
      var box = chatEl.querySelector('.sb-msgs');
      if (box) {
        var dvq = dividerBetween(prevQ, msgObj);   // 局部插入也补分割线（UWU）——不然重开聊天才出现；msgObj 已含 extra 字段
        if (dvq) box.insertAdjacentHTML('beforeend', dividerHtml(dvq));
        box.insertAdjacentHTML('beforeend', renderOneMsg(msgObj, name, npc.dm_history.length - 1, false, false, true));
        box.scrollTop = box.scrollHeight;
      }
    }
    // 「发送」键：先把输入框里没发的也攒进去，再让这个人一次性回复攒的全部
    function sendReply() {
      var typed = input.value.trim();
      if (typed) queueMsg(typed, 'text');
      replyOne(name);
    }
    sendBtn.addEventListener('click', sendReply);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); queueMsg(); } });   // 回车=攒
    // 📷 发照片（输入描述=对方看到的图）：输入框有字=直接当描述，空=弹小窗写
    function askPhoto() {
      var desc = input.value.trim();
      if (desc) { input.value = ''; queueMsg(desc.slice(0, 120), 'image'); return; }
      panelPrompt('描述你要发的照片（对方会"看到"这张图）。例：镜子里的新裙子，只拍到锁骨以下', '').then(function (d) {
        d = (d || '').trim();
        if (d) queueMsg(d.slice(0, 120), 'image');
      });
    }
    // 🔗 发链接子菜单：科普帖（TA问蠢问题时）/ 我的账单（哭穷）/ 商城商品（发链接=买给我）
    function openLinkMenu() {
      var mag = magOf() || {};
      var prods = [];
      (mag.trend || []).forEach(function (x) { if (x.name && x.price > 0) prods.push({ n: x.name, p: x.price }); });
      (mag.catalog || []).forEach(function (x) { if (x.name && x.price > 0) prods.push({ n: x.name, p: x.price }); });
      (mag.invites || []).forEach(function (x) { if (x.title) prods.push({ n: x.title, p: x.price || 0 }); });
      closeMsgMenu();
      var menu = DOC.createElement('div');
      menu.className = 'sb-msgmenu';
      menu.style.left = '24px'; menu.style.right = '24px'; menu.style.top = '10%';
      var mh = '<div style="padding:8px 13px;font-size:11px;color:var(--ink-faint);letter-spacing:1px;">发什么链接给 ' + esc(name) + '？</div>';
      mh += '<button data-lk="slang">📌 黑话科普帖（TA问蠢问题时甩这个）</button>';
      // 🧾 我的账单：发给TA=明示求救；TA真愿意的话会直接替你交（账单进入下期）或转账让你自己交
      var bills0 = (state && state.wallet && state.wallet.bills) || [];
      if (bills0.length) {
        mh += '<div style="padding:6px 13px 2px;font-size:10px;color:var(--ink-faint);">— 我的账单 · 哭穷神器 —</div>';
        for (var bi = 0; bi < bills0.length; bi++) {
          var bl0 = bills0[bi]; var dl0 = bl0.days_left != null ? bl0.days_left : 30;
          mh += '<button data-lk="b' + bi + '">🧾 ' + esc(bl0.name) + ' — ' + fmtUSD(bl0.amount) + ' · ' + (dl0 > 0 ? dl0 + 'd' : '逾期') + '</button>';
        }
      }
      if (prods.length) {
        mh += '<div style="padding:6px 13px 2px;font-size:10px;color:var(--ink-faint);">— 商城 · 发链接=买给我，TA懂的 —</div>';
        for (var pi = 0; pi < prods.length && pi < 12; pi++) mh += '<button data-lk="p' + pi + '">🛍️ ' + esc(prods[pi].n) + (prods[pi].p > 0 ? ' — ' + fmtUSD(prods[pi].p) : '') + '</button>';
      } else {
        mh += '<div style="padding:6px 13px;font-size:10px;color:var(--ink-faint);">商城还没上货——去论坛/Elite 点🔄烤一期就有了</div>';
      }
      mh += '<button data-lk="">✕ 算了</button>';
      menu.innerHTML = mh;
      panel.appendChild(menu);
      menu.addEventListener('click', function (e) {
        var pk = e.target && e.target.closest && e.target.closest('[data-lk]');
        if (!pk) return;
        var v = pk.getAttribute('data-lk');
        closeMsgMenu(); _msgMenu = null;
        if (!v) return;
        if (v === 'slang') {
          queueMsg(SLANG_FORWARD, 'text');
          toast('success', '🔗 科普帖已进待发——点发送，让TA自己读');
        } else if (v.charAt(0) === 'b') {
          var bx = bills0[parseInt(v.slice(1), 10)];
          if (bx) {
            var dlx = bx.days_left != null ? bx.days_left : 30;
            queueMsg('🧾 [转发账单] ' + bx.name + ' —— ' + fmtUSD(bx.amount) + '，' + (dlx > 0 ? '还有 ' + dlx + ' 天到期' : '已经逾期了') + '（SugarOS 账单分享）', 'text');
            toast('success', '🧾 账单已进待发——哭穷要哭得具体');
          }
        } else {
          var it = prods[parseInt(v.slice(1), 10)];
          if (it) {
            queueMsg('🔗 [转发商品] ' + it.n + (it.p > 0 ? ' —— ' + fmtUSD(it.p) : '') + '（SugarElite 商城）', 'text');
            toast('success', '🔗 链接已进待发——点发送，看TA上不上道');
          }
        }
      });
      _msgMenu = menu;
    }

    // ➕ 动作菜单：普通联系人和管家 S. 各一套；一键类（哭穷/自拍/使唤管家）发完立刻让TA回，
    // 描述类（照片/语音/定位/转账）走面板小窗，攒进待发由玩家点发送
    var plusBtn = chatEl.querySelector('.sb-cbar .plus');
    if (plusBtn) plusBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();   // 老规矩：不拦冒泡，"点菜单外=收菜单"会把刚开的菜单当场关掉
      closeMsgMenu();
      var menu = DOC.createElement('div');
      menu.className = 'sb-msgmenu';
      menu.style.left = '24px'; menu.style.right = '24px'; menu.style.top = '14%';
      var mh = '';
      if (isSE) {
        mh += '<button data-pa="q0">📋 今日行程</button>' +
          '<button data-pa="q1">🍽️ 帮我订位</button>' +
          '<button data-pa="q2">🕵️ 查个人</button>' +
          '<button data-pa="photo">📷 发照片（自己描述）</button>' +
          '<button data-pa="img">🎨 AI生图</button>' +
          '<button data-pa="link">🔗 发链接（科普帖/账单/商品）</button>';
      } else {
        mh += '<button data-pa="meet">☕ 约见面（开正文剧情）</button>' +
          '<button data-pa="broke">🥺 哭穷（一键）</button>' +
          '<button data-pa="selfie">🤳 快捷自拍（一键）</button>' +
          '<button data-pa="photo">📷 发照片（自己描述）</button>' +
          '<button data-pa="img">🎨 AI生图</button>' +
          '<button data-pa="voice">🎙️ 发语音（自己描述）</button>' +
          '<button data-pa="loc">📍 发定位</button>' +
          '<button data-pa="pay">💸 转账给TA（从你钱包扣）</button>' +
          '<button data-pa="link">🔗 发链接（科普帖/账单/商品）</button>';
      }
      mh += '<button data-pa="">✕ 算了</button>';
      menu.innerHTML = mh;
      panel.appendChild(menu);
      var SE_Q = ['今天有什么安排？帮我把行程排一下', '这周末帮我订个好位置，你来挑', '最近撩我的这个人，帮我查查靠不靠谱'];
      menu.addEventListener('click', function (e) {
        var pk = e.target && e.target.closest && e.target.closest('[data-pa]');
        if (!pk) return;
        var act = pk.getAttribute('data-pa');
        closeMsgMenu(); _msgMenu = null;
        if (!act) return;
        if (act === 'meet') {
          // 约见面 = 开正文剧情：填进主输入框（可编辑），收起手机，玩家补完时间地点自己发
          fillMainInput('我和 ' + name + ' 约好了见面。');
          panel.classList.remove('open');
        }
        else if (act === 'broke') { queueMsg(pickFrom(QUICK_POOLS.broke), 'text'); replyOne(name); }
        else if (act === 'selfie') { queueMsg(pickFrom(QUICK_POOLS.selfie), 'image'); replyOne(name); }
        else if (act.charAt(0) === 'q') { queueMsg(SE_Q[parseInt(act.slice(1), 10)], 'text'); replyOne(name); }
        else if (act === 'photo') askPhoto();
        else if (act === 'voice') {
          panelPrompt('这段语音你说了什么？（对方会"听到"，语气喘息也可以写进去）', '').then(function (d) {
            d = (d || '').trim();
            if (d) queueMsg(d.slice(0, 200), 'voice');
          });
        }
        else if (act === 'loc') {
          panelPrompt('发哪里的位置？（留空 = 你现在的位置）', '').then(function (d) {
            if (d == null) return;   // 点了取消
            d = d.trim();
            queueMsg('📍 [发送了位置：' + (d || '我现在的位置') + ']', 'text');
            toast('success', '📍 位置已进待发——点发送');
          });
        }
        else if (act === 'pay') {
          panelPrompt('转多少给 ' + name + '？只填数字（从你钱包扣，余额 ' + fmtUSD((state && state.wallet && state.wallet.balance) || 0) + '）', '').then(function (d) {
            var amt = Math.round(parseFloat(String(d || '').replace(/[^0-9.]/g, ''))) || 0;
            if (amt <= 0) return;
            if (!debit(amt, '转给 ' + name, '转账')) return;   // 余额不够 debit 自己会拦
            queueMsg(String(amt), 'transfer');
            toast('success', '💸 已转 ' + fmtUSD(amt) + ' 给 ' + name + '——点发送让TA看到');
          });
        }
        else if (act === 'img') {
          // 🎨 AI生图（UWU）：Pollinations.ai 免费生图，零 API Key 零配置
          // 流程：弹 prompt → 插随机等待文案气泡 → Image 探测 → 成功入待发 / 失败重试一次
          var WAIT_MSGS = [
            '正在调教画笔…画笔发出一声娇吟 ✨', 'AI 在翻你的 mood board，稍等 🎨',
            '画师正在请神上身…再等一下下 💫', '画师正在喝咖啡提神...咖啡撒了，好在只是emoji ☕',
            '正在申请访问FBI数据库寻找参考...访问失败，我们只找到了纽约的阳光 🌇', '在众多色彩里挑最适合你的那个...十二星座决定你的幸运色 🎯',
            '光影、构图、氛围…对画师来说一样都不能少...熬夜、饮食不规律、精神状态抽象也是 🖌️', 'AI 正在与啃数据线的仓鼠搏斗...%#@￥%...吱吱，吱吱吱 ',
            '已经在生成啦，真的，没骗你 🫣', '正在生成一只鸽子成为画奴...鸽子飞向了自由的远方 ',
          ];
          panelPrompt('🎨 描述你要生成的画面（中英文都行）', '一个在纽约街头散步的优雅女人，金色阳光，电影感').then(function (prompt) {
            prompt = (prompt || '').trim();
            if (!prompt) return;
            var sp = imgStylePrompt();   // 画风预设（UWU）：设置页可选厚涂/平涂，不开=原样
            var finalPrompt = sp ? (sp.pos + ', ' + prompt + ' --- NOT: ' + sp.neg) : prompt;
            var imgUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(finalPrompt);
            setStatus('🎨 AI 正在画…');
            // 插入假消息气泡（sb-typing 呼吸动画），完事无论成败都摘掉
            var box = chatEl.querySelector('.sb-msgs');
            var waitBubble = null;
            if (box) {
              var waitMsg = WAIT_MSGS[Math.floor(Math.random() * WAIT_MSGS.length)];
              box.insertAdjacentHTML('beforeend', '<div class="sb-msg me sb-typing" style="max-width:82%;">' + esc(waitMsg) + '</div>');
              waitBubble = box.lastElementChild;
              box.scrollTop = box.scrollHeight;
            }
            var done = function () {
              setStatus('');
              try { if (waitBubble && waitBubble.parentNode) waitBubble.parentNode.removeChild(waitBubble); } catch (e) {}
            };
            var ok = function () {
              done();
              queueMsg('（AI 生成的画面：' + prompt.slice(0, 200) + '）', 'image', { imgUrl: imgUrl });
              toast('success', '🎨 AI 生图已进待发——点发送让TA看到');
            };
            var probe = new Image();   // 用 Image 对象探测 Pollinations 是否生成完毕
            probe.onload = ok;
            probe.onerror = function () {
              setTimeout(function () {   // Pollinations 冷启动可能慢，3秒后重试一次
                var retry = new Image();
                retry.onload = ok;
                retry.onerror = function () { done(); toast('error', '生图失败——换个描述试试，英文效果通常更好'); };
                retry.src = imgUrl;
              }, 3000);
            };
            probe.src = imgUrl;
          });
        }
        else if (act === 'link') openLinkMenu();
      });
      _msgMenu = menu;
    });
  }

  function closeChat() { currentChatName = null; currentPage = null; _msel = null; chatEl.style.display = 'none'; root.style.display = ''; render(); }

  // ── 🎨 AI生图画风预设（UWU · 2026-07-17）──
  // '0'=不开 '1'=厚涂油画 '2'=平涂插画；提示词不含人物描述——适合场景/氛围/静物/光影
  function imgStylePreset() {
    try { return VIEW.localStorage.getItem('sbnyc_img_style') || '0'; } catch (e) { return '0'; }
  }
  function imgStylePrompt() {
    var s = imgStylePreset();
    if (s === '1') return {
      pos: 'classical oil painting style, clear composition structure, fine delicate brushstrokes, soft shadow, Rembrandt lighting, painterly digital illustration, thick textured brushstrokes, soft oil painting texture, warm painterly rendering, subtle canvas grain, blended soft shading, loose expressive brushwork',
      neg: 'anime, cartoon, cel shading, flat colors, 3d render, plastic texture, smooth airbrushed, ugly, blurry, lowres, deformed, harsh neon colors, comic halftone, pixel art',
    };
    if (s === '2') return {
      pos: '2D anime style illustration, delicate sharp clean line art, soft semi-cel shading, rich vibrant colors, clean clear color blocks, detailed crisp background, translucent watercolor wash texture mixed with digital painting, subtle brush texture, elegant soft ink wash edge, glossy fabric highlight, soft warm diffused indoor light, gentle rim light, pale warm pastel tone, soft glowing highlights, low contrast soft shadow, luminous hazy light bloom, gentle warm color grading',
      neg: 'photorealistic, oil painting, rough thick brushstrokes, 3d render, clay, ugly, blurry, lowres, deformed, messy rough lines, heavy cel shading, harsh black shadow, saturated neon color, western comic, pixel art',
    };
    return null;
  }

  function renderOneMsg(m, trName, trIdx, autoShow, canReroll, isLast) {
    var isU = m.sender === 'USER'; var cls = isU ? 'me' : 'them'; var type = (m.type || 'text').toLowerCase();
    var c = m.content || ''; var t = formatMsgTime(m); var n = m.note || '';   // 时间戳带日期（UWU）："4/16 09:20"，AI 和玩家都不再犯日期糊涂
    if (m.edited) t = (t ? t + ' · ' : '') + '已编辑';
    var tH = t ? '<span class="mt">' + esc(t) + '</span>' : '';
    // 群聊气泡：内容开头的「S.：」/「Akuma：」拆成气泡上方的小名字
    var gsp = '';
    if (!isU && trName === GROUP_NAME) {
      var gm = String(c).match(/^\s*(S\.|Akuma)\s*[:：]\s*/);
      if (gm) { gsp = '<span class="gsp">' + gm[1] + '</span>'; c = String(c).slice(gm[0].length); }
    }
    // 长按菜单：定位属性(nm/mi)现在**每种气泡都挂**（多选删除要能选中转账/礼物/撤回存根），
    // 但编辑/撤回/重roll 等动作属性只给原来那几类——转账钱已走账、礼物已入橱，删的只是消息本身。
    var dataA = '';
    if (trName != null && trIdx != null) {
      dataA = ' data-owner="' + (isU ? 'me' : 'them') + '" data-nm="' + esc(trName) + '" data-mi="' + trIdx + '"';
      if (type !== 'transfer' && type !== 'recall' && type !== 'system' && type !== 'gift') {
        if (canReroll && !isU) dataA += ' data-rr="1"';
        if (isU && (type === 'text' || type === 'image' || type === 'voice')) {
          dataA += ' data-ed="1"';
          if (isLast) dataA += ' data-rc="1"';   // 只有自己发的最后一条能撤回（转账不能撤——钱已经走了）
        }
      }
    }
    // 翻译按钮统一入口：有预生成翻译(m.zh)→点了秒开；生成时漏了翻译的英文消息→同一个按钮，点了现场翻这一条
    var trH = '';
    if (!isU && m.zh) {
      trH = '<span class="sb-tr-btn">🌐 翻译</span><div class="sb-tr-txt' + (autoShow ? ' show' : '') + '">' + esc(m.zh) + '</div>';
    } else if (!isU && trName != null && looksEnglish(c) && (type === 'text' || type === 'image' || type === 'voice')) {
      trH = '<span class="sb-tr-btn need" data-n="' + esc(trName) + '" data-i="' + trIdx + '">🌐 翻译</span>';
    }
    if (type === 'transfer') return '<div class="sb-msg transfer' + (isU ? ' me' : '') + '"' + dataA + ' data-tp="transfer"><div class="tl">' + (isU ? 'You sent' : 'Received') + '</div><div class="ta">' + fmtUSD(c) + '</div>' + (n ? '<div class="tl">' + esc(n) + '</div>' : '') + tH + '</div>';
    if (type === 'gift') return '<div class="sb-msg transfer"' + dataA + ' data-tp="gift"><div class="tl">Gift · 已入衣橱</div><div class="ta" style="font-size:16px;">🎁 ' + esc(c) + '</div>' + tH + '</div>';
    if (type === 'image') {
      // 消息带 imgUrl（🎨 AI生图）→ 渲染真实 <img>；否则保持旧文字样式（UWU）
      if (m.imgUrl) {
        return '<div class="sb-msg ' + cls + '"' + dataA + ' style="max-width:88%;padding:4px;background:transparent;">' +
          '<img src="' + esc(m.imgUrl) + '" style="max-width:100%;max-height:300px;border-radius:12px;display:block;" loading="lazy" onerror="this.style.display=\'none\'">' +
          '<div style="font-size:11px;color:var(--ink-sub);margin-top:4px;padding:0 6px;">📷 ' + esc(c) + '</div>' + tH + trH + '</div>';
      }
      return '<div class="sb-msg ' + cls + ' media"' + dataA + '>' + gsp + '📷 ' + esc(c) + tH + trH + '</div>';
    }
    if (type === 'voice') {
      // 沉浸语音条：只露波形和秒数（时长按字数估），点一下气泡才展开文字
      var plain = String(c).replace(/\s/g, '');
      var vlen = Math.max(2, Math.min(60, Math.round(plain.length / 3)));
      var WAVE = '▂▄▂▆▃▅▂▇▄▂▅▃▆▂▄▅▃▆▂▅';
      var wave = WAVE.slice(0, Math.max(6, Math.min(18, Math.round(vlen / 3) + 5)));
      return '<div class="sb-msg ' + cls + ' voice"' + dataA + '>' + gsp +
        '<div class="sb-vc"><span>🎙️</span><span class="vwave">' + wave + '</span><span class="vsec">' + vlen + '″</span></div>' +
        '<div class="sb-vc-txt">' + esc(c).replace(/\n/g, '<br>') + '</div>' + tH + trH + '</div>';
    }
    if (type === 'recall') return '<div class="sb-msg system"' + dataA + ' data-tp="recall">「' + (isU ? '你' : '对方') + '撤回了一条消息」' + tH + '</div>';   // 内容不显示——说了什么只有发的人自己记得
    if (type === 'system') return '<div class="sb-msg system"' + dataA + ' data-tp="system">' + esc(c) + '</div>';
    // 转发的账单/商品/帖子 → 小票收据卡（User 许愿的仪式感；内容还是同一行文字，只是穿了件衣服）
    if (isU && type === 'text') {
      var rcm = String(c).match(/^(🧾|🔗)\s*\[(转发账单|转发商品|转发帖子)\]\s*([\s\S]+)$/);
      if (rcm) {
        var rest = rcm[3].replace(/（SugarOS 账单分享）|（SugarElite 商城）/g, '').trim();
        var seg = rest.split(/\s*——\s*/);
        var rTitle = seg[0] || rest, rMeta = seg.slice(1).join(' — ');
        var rHead = rcm[2] === '转发账单' ? 'SUGAROS · BILL SHARE' : (rcm[2] === '转发帖子' ? 'SUGARRANK · PINNED POST' : 'SUGARELITE · WISHLIST');
        return '<div class="sb-msg sb-rcpt"' + dataA + '><div class="rc-h">' + rHead + '</div>' +
          '<div class="rc-n">' + esc(rTitle) + '</div>' + (rMeta ? '<div class="rc-m">' + esc(rMeta) + '</div>' : '') +
          '<div class="rc-f">' + rcm[1] + ' ' + esc(rcm[2].replace('转发', '')) + ' · 已转发 · 懂的都懂</div>' + tH + '</div>';
      }
    }
    // 引用回复：开头的 回"原句"： 拆成气泡内的引用小卡（长按菜单"引用回复"和NPC的引用格式都走这里）
    var qm = String(c).match(/^回\s*[""]([\s\S]{1,80}?)[""]\s*[:：]\s*([\s\S]+)$/);
    if (qm) {
      return '<div class="sb-msg ' + cls + '"' + dataA + '>' + gsp +
        '<div class="sb-qt">' + esc(qm[1]) + '</div>' +
        esc(qm[2]).replace(/\n/g, '<br>') + tH + trH + '</div>';
    }
    return '<div class="sb-msg ' + cls + '"' + dataA + '>' + gsp + esc(c).replace(/\n/g, '<br>') + tH + trH + '</div>';
  }

  // ── 拖动支持（FAB 和手机面板都能拖；位置存 localStorage 记住） ──
  var VIEW = DOC.defaultView || window;
  // 手机版 ST 给页面加 transform/zoom → position:fixed 坐标失准（悬浮球飞出屏幕外、面板只露一角）。
  // 动森 NookPhone 同款解法：探针实测渲染偏移和缩放比，所有定位都经 CAL 换算——不猜环境，量出来。
  var CAL = { ox: 0, oy: 0, sx: 1, sy: 1 };
  function recalib() {
    try {
      var probe = DOC.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;pointer-events:none;visibility:hidden;';
      DOC.body.appendChild(probe);
      var r = probe.getBoundingClientRect();
      probe.remove();
      CAL = { ox: r.left, oy: r.top, sx: (r.width / 100) || 1, sy: (r.height / 100) || 1 };
    } catch (e) {}
  }
  function vpW() { return (VIEW.visualViewport && VIEW.visualViewport.width) || VIEW.innerWidth; }
  function vpH() { return (VIEW.visualViewport && VIEW.visualViewport.height) || VIEW.innerHeight; }
  function setClientPos(el, cx, cy) {
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.left = ((cx - CAL.ox) / CAL.sx) + 'px';
    el.style.top = ((cy - CAL.oy) / CAL.sy) + 'px';
  }
  function clampXY(x, y, margin) {
    return {
      x: Math.max(4, Math.min(x, vpW() - (margin || 60))),
      y: Math.max(4, Math.min(y, vpH() - (margin || 60))),
    };
  }
  function defaultFabPos() { recalib(); setClientPos(fab, vpW() - 66, vpH() - 200); }
  function defaultPanelPos() {
    recalib();
    var pw = Math.min(380, vpW() - 20), ph = Math.min(660, vpH() - 220);
    setClientPos(panel, Math.max(8, vpW() - pw - 10), Math.max(8, vpH() - ph - 200));
  }
  // 键盘弹出探测：面板里有输入框在打字时，一切位置/高度调整全部冻结
  // （安卓弹键盘 = 视口和 100vh 一起缩水 → CSS 的 calc(100vh-220px) 把手机压扁一半——所以开面板时锁死像素高度）
  function typingInPanel() {
    try { var a = DOC.activeElement; return !!(a && panel.contains(a)); } catch (e) { return false; }
  }
  function lockPanelHeight() {
    if (vpW() < 500) { fitPanel(); return; }
    recalib();
    panel.style.height = (Math.min(660, vpH() - 220) / CAL.sy) + 'px';
  }
  // 窄屏（手机浏览器）：面板顶到屏幕顶、底不压输入栏，宽度居中
  function fitPanel() {
    if (vpW() >= 500) { panel.style.height = ''; return; }
    recalib();
    var bottom = vpH();
    try {
      var sf = DOC.getElementById('send_form') || DOC.getElementById('form_sheld');
      if (sf) { var r = sf.getBoundingClientRect(); if (r.top > 100) bottom = r.top; }
    } catch (e) {}
    var pw2 = Math.min(380, vpW() - 12);
    setClientPos(panel, Math.max(4, (vpW() - pw2) / 2), 6);
    panel.style.height = ((bottom - 14) / CAL.sy) + 'px';
  }
  function loadPos(key) { try { var s = VIEW.localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function savePos(key, x, y) { try { VIEW.localStorage.setItem(key, JSON.stringify({ x: x, y: y })); } catch (e) {} }
  function applyPos(el, pos) {
    if (!pos) return false;
    recalib();
    var c = clampXY(pos.x, pos.y);
    setClientPos(el, c.x, c.y);
    return true;
  }
  function makeDraggable(el, handle, storeKey, onTap) {
    handle.style.touchAction = 'none';
    handle.style.cursor = 'grab';
    var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', function (e) {
      // 点在交互控件(⚙等)上不抢拖动——setPointerCapture 会把后续 click 重定向到把手，控件就永远收不到点击
      if (e.target && e.target.closest && e.target.closest('.sb-gear')) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
      var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;   // 6px 内算点击不算拖
      moved = true;
      var c = clampXY(ox + dx, oy + dy);   // client 坐标系里算，setClientPos 负责换算回样式值
      setClientPos(el, c.x, c.y);
      e.preventDefault();
    });
    handle.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      if (moved) { var r = el.getBoundingClientRect(); savePos(storeKey, r.left, r.top); }
      else if (onTap) onTap();
    });
    handle.addEventListener('pointercancel', function () { dragging = false; });
  }

  // ── 事件接线 ──
  // FAB：点=开关手机，按住拖=移动
  makeDraggable(fab, fab, 'sbnyc_fab_pos', function () {
    var open = panel.classList.toggle('open');
    if (open) { lockPanelHeight(); refreshView(); }
  });
  // 手机面板：抓灵动岛或状态栏拖动
  makeDraggable(panel, panel.querySelector('.sb-island'), 'sbnyc_panel_pos');
  makeDraggable(panel, barEl, 'sbnyc_panel_pos');
  // 初始定位：有存档用存档（钳进视口），没存档一律走校准后的默认位——CSS 的 right/bottom 在手机版会失准
  if (!applyPos(fab, loadPos('sbnyc_fab_pos'))) defaultFabPos();
  if (!applyPos(panel, loadPos('sbnyc_panel_pos'))) defaultPanelPos();
  // 键盘抬升：打字时不缩面板，把整台手机往上平移到键盘上方（平移不够贴顶了才把高度微缩掉差额）。
  // 用 transform 平移不动 left/top —— 拖动存档不受影响，键盘一收 transform 清零就回原位。
  function liftForKeyboard() {
    try {
      var vv = VIEW.visualViewport;
      if (!vv) return;
      panel.style.transform = '';                                  // 先复位再量，免得平移叠加
      var kb = VIEW.innerHeight - vv.height - (vv.offsetTop || 0);
      if (kb < 60) {                                               // 键盘收了（比如安卓返回键）→ 恢复原尺寸
        if (vpW() < 500) fitPanel(); else lockPanelHeight();
        return;
      }
      var r = panel.getBoundingClientRect();
      var overlap = r.bottom - (vv.offsetTop + vv.height) + 8;
      if (overlap <= 0) return;                                    // 没被键盘挡住就不动
      var lift = Math.min(overlap, Math.max(0, r.top - 6));        // 最多抬到贴屏幕顶
      if (lift > 0) panel.style.transform = 'translateY(-' + lift + 'px)';
      var remain = overlap - lift;
      if (remain > 4) panel.style.height = (Math.max(240, r.height - remain) / CAL.sy) + 'px';   // 抬到顶还差的部分才缩高度
    } catch (e) {}
  }
  // 视口变化（转屏/键盘弹出/缩放）→ 重校准；打字中只抬升，没打字就复位+按当前视口重排。
  // 每次都现算，没有"定格"——这就是"键盘收起会自己弹回来"的保证。
  function keepInView() {
    recalib();
    var typing = typingInPanel();
    if (!typing) {
      try {
        var rf = fab.getBoundingClientRect();
        var c1 = clampXY(rf.left, rf.top);
        setClientPos(fab, c1.x, c1.y);
      } catch (e) {}
    }
    if (panel.classList.contains('open')) {
      if (typing) { liftForKeyboard(); return; }                   // 打字中：整机抬升，不改位置存档
      panel.style.transform = '';                                  // 没在打字：清掉抬升 → 回原位
      if (vpW() < 500) fitPanel();
      else {
        lockPanelHeight();
        try { var rp = panel.getBoundingClientRect(); var c2 = clampXY(rp.left, rp.top, 120); setClientPos(panel, c2.x, c2.y); } catch (e) {}
      }
    }
  }
  // 有些浏览器键盘收起不派发 resize（玩家反馈"抬上去不回来，要关了重开"）→ 输入框失焦后补一拍重排兜底
  var _kvTimer = null;
  function keepInViewSoon() { clearTimeout(_kvTimer); _kvTimer = setTimeout(keepInView, 300); }
  panel.addEventListener('focusout', keepInViewSoon, true);
  try { VIEW.addEventListener('resize', keepInView); } catch (e) {}
  try { if (VIEW.visualViewport) VIEW.visualViewport.addEventListener('resize', keepInView); } catch (e) {}
  // QR 栏保底按钮（动森同款自救入口）：悬浮球拖丢/手机端不可见 → 点它复位+开关面板
  try {
    eventOn(getButtonEvent('📱手机'), function () {
      try { VIEW.localStorage.removeItem('sbnyc_fab_pos'); VIEW.localStorage.removeItem('sbnyc_panel_pos'); } catch (e) {}
      defaultFabPos();
      var open = panel.classList.toggle('open');
      if (open) {
        defaultPanelPos();
        lockPanelHeight();
        refreshView();
      }
    });
  } catch (e) {}
  // ⚙️ 设置 + 🌙 夜间：委托在 barEl 上，render() 重写 innerHTML 也不掉绑定
  function applyNight(on) {
    panel.classList.toggle('night', !!on);
    try { VIEW.localStorage.setItem('sbnyc_night', on ? '1' : '0'); } catch (e) {}
    var b = DOC.getElementById('sbnyc-night'); if (b) b.textContent = on ? '☀️' : '🌙';
  }
  function applyBlind(on) {   // 🎁 盲盒模式：藏起所有身份标签（纯 CSS，切换即时不用重渲染）
    panel.classList.toggle('blindbox', !!on);
    try { VIEW.localStorage.setItem('sbnyc_blindbox', on ? '1' : '0'); } catch (e) {}
  }
  barEl.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.id === 'sbnyc-gear') openSettings();
    else if (t && t.id === 'sbnyc-night') applyNight(!panel.classList.contains('night'));
    else if (t && t.id === 'sb-bar-time-click') calibrateTime();   // ⏱ 时间校准（UWU）——顶栏是委托绑定，别在 render 里找它
  });
  try { if (VIEW.localStorage.getItem('sbnyc_night') === '1') applyNight(true); } catch (e) {}   // 记住上次选择
  try { if (VIEW.localStorage.getItem('sbnyc_blindbox') === '1') applyBlind(true); } catch (e) {}
  // 🌐 翻译开关：委托在常驻的 chatEl 上，聊天页怎么重渲染都不掉绑定
  // _pendingTrs 是字典不是单变量：连点两条翻译时各自记账，谁的译文回来谁自动展开（单变量会被第二次点击顶掉）
  var _pendingTrs = {};
  chatEl.addEventListener('click', function (e) {
    var t = e.target;
    // ☑️ 多选模式优先：点气泡=勾选/取消，其余点击一律吞掉（防误触翻译/语音展开）
    if (_msel) {
      var mb = bubbleOf(t);
      if (mb && mb.getAttribute('data-mi') != null) {
        var mk = mb.getAttribute('data-mi');
        if (_msel.set[mk]) { delete _msel.set[mk]; mb.classList.remove('sel'); }
        else { _msel.set[mk] = 1; mb.classList.add('sel'); }
        var db = chatEl.querySelector('.sb-mselbar .mdel');
        if (db) db.textContent = '🗑 删除选中（' + Object.keys(_msel.set).length + '）';
      }
      return;
    }
    if (t && t.classList && t.classList.contains('sb-tr-btn')) {
      if (t.classList.contains('need')) {
        // 漏针的那条：现场翻一次（只有漏网之鱼走这条路），翻完 sb_updated 重渲染并自动展开
        t.textContent = '⏳ 翻译中…';
        var trReq = { name: t.getAttribute('data-n'), idx: parseInt(t.getAttribute('data-i'), 10) };
        _pendingTrs[trReq.name + '|' + trReq.idx] = true;
        SBemit('sb_request_translate', trReq);
        return;
      }
      var box = t.parentNode && t.parentNode.querySelector('.sb-tr-txt');
      if (box) box.classList.toggle('show');
      if (_msgMenu && !_msgMenu.contains(t)) closeMsgMenu();
      return;
    }
    // 🎙️ 语音条：点一下展开/收起文字（微信式"点了才知道TA说了什么"）
    var vb = bubbleOf(t);
    if (vb && vb.classList && vb.classList.contains('voice')) vb.classList.toggle('open');
    // 点菜单以外的地方 → 收起长按菜单
    if (_msgMenu && !_msgMenu.contains(t)) closeMsgMenu();
  });

  // ── 长按消息气泡（或右键）→ 操作菜单：✏️编辑自己的 / 🔄重roll对方最新回复 / 📋复制 ──
  // 替代原来挂在每条气泡尾巴上的小按钮（玩家嫌难看）。触发：按住450ms，或桌面右键。
  var _lpTimer = null, _msgMenu = null;
  function closeMsgMenu() { if (_msgMenu && _msgMenu.parentNode) _msgMenu.parentNode.removeChild(_msgMenu); _msgMenu = null; }
  function bubbleOf(t) { while (t && t !== chatEl) { if (t.classList && t.classList.contains('sb-msg')) return t; t = t.parentNode; } return null; }
  function showMsgMenu(b) {
    closeMsgMenu();
    var nm = b.getAttribute('data-nm'); var mi = parseInt(b.getAttribute('data-mi'), 10);
    if (!nm || !(mi >= 0)) return;
    var isMe = b.getAttribute('data-owner') === 'me';
    var tp = b.getAttribute('data-tp') || '';
    var items = [];
    if (tp === 'recall') {
      // 撤回存根：只许删——复制/引用都会把"看不到的内容"漏出来
      items.push(['🗑 删除这条', 'del']);
      items.push(['☑️ 多选删除', 'ms']);
    } else {
      if (b.getAttribute('data-ed') === '1') items.push(['✏️ 编辑这条', 'ed']);
      if (b.getAttribute('data-rc') === '1') items.push(['↩️ 撤回这条', 'rc']);
      if (b.getAttribute('data-rr') === '1') items.push(['🔄 重roll 这条回复', 'rr']);
      if (!isMe && !tp) items.push(['💬 引用回复', 'qt']);
      items.push(['🗑 删除这条', 'del']);
      items.push(['📋 复制文字', 'cp']);
      items.push(['☑️ 多选删除', 'ms']);
    }
    var menu = DOC.createElement('div');
    menu.className = 'sb-msgmenu';
    for (var i = 0; i < items.length; i++) menu.innerHTML += '<button data-act="' + items[i][1] + '">' + items[i][0] + '</button>';
    panel.appendChild(menu);
    // 定位：贴着气泡；太靠底就翻到气泡上方，左右夹进面板内
    var pr = panel.getBoundingClientRect(), br = b.getBoundingClientRect();
    var top = br.bottom - pr.top + 4;
    if (top > pr.height - (items.length * 38 + 16)) top = Math.max(8, br.top - pr.top - items.length * 38 - 12);
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, Math.min(br.left - pr.left, pr.width - 168)) + 'px';
    menu.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      closeMsgMenu();
      if (act === 'ed') editUserMsg(nm, mi);
      else if (act === 'rc') recallMsg(nm, mi);
      else if (act === 'rr' && currentChatName) { setStatus('⏳ 重生成…'); rerollLast(currentChatName); }
      else if (act === 'ms') enterMultiSel(nm);
      else if (act === 'del') deleteMsg(nm, mi);
      else if (act === 'qt') {
        // 引用回复：把对方那句垫进输入框，接着打字就是"回着说"
        var qmsg = state && state.npcs && state.npcs[nm] && state.npcs[nm].dm_history && state.npcs[nm].dm_history[mi];
        var qta = chatEl.querySelector('.sb-cbar textarea');
        if (qmsg && qta) { qta.value = '回"' + String(qmsg.content || '').slice(0, 50) + '"：' + qta.value; try { qta.focus(); } catch (e2) {} }
      }
      else if (act === 'cp') {
        var msg = state && state.npcs && state.npcs[nm] && state.npcs[nm].dm_history && state.npcs[nm].dm_history[mi];
        var txt = (msg && msg.content) || '';
        try { VIEW.navigator.clipboard.writeText(txt).then(function () { toast('success', '📋 已复制'); }, function () { toast('warning', '复制失败'); }); }
        catch (e2) { toast('warning', '这个环境不让复制'); }
      }
      _msgMenu = null;
    });
    _msgMenu = menu;
  }
  // ── ☑️ 多选删除模式：长按菜单进入，点气泡=勾选，底部条批量删（双方的消息都能选，礼物/转账/撤回存根也能选） ──
  var _msel = null;   // { name, set: {mi: 1} }
  function enterMultiSel(name) {
    exitMultiSel();
    _msel = { name: name, set: {} };
    var bar = DOC.createElement('div');
    bar.className = 'sb-mselbar';
    bar.innerHTML = '<button class="mdel">🗑 删除选中（0）</button><button class="mcancel">✕ 取消</button>';
    chatEl.appendChild(bar);
    bar.querySelector('.mcancel').addEventListener('click', exitMultiSel);
    bar.querySelector('.mdel').addEventListener('click', function () {
      var nm2 = _msel && _msel.name;
      var idxs = _msel ? Object.keys(_msel.set).map(Number).sort(function (a, b2) { return b2 - a; }) : [];   // 从大往小删，索引不漂移
      if (!nm2 || !idxs.length) { toast('info', '先点选要删的消息'); return; }
      // 回退：收集被删消息里的财务影响（本地镜像 + 变量持久化双写）
      var v0 = SBgetVars(); var h0 = (v0 && v0.sb && v0.sb.npcs && v0.sb.npcs[nm2] && v0.sb.npcs[nm2].dm_history) || [];
      var delBatch = [];
      for (var d2 = 0; d2 < idxs.length; d2++) { if (h0[idxs[d2]]) delBatch.push(h0[idxs[d2]]); }
      rollbackMsgEffects(nm2, delBatch, (state && state.wallet) || {}, (state && state.closet) || []);
      // 删的是自己攒着没发的话时，待发队列同步撤（单删一直有这逻辑，多删曾漏 → 首页冒发送按钮、一发送删掉的话还魂）
      var ob = loadOutbox(); var q = ob[nm2]; var obChanged = false;
      if (q && q.length) {
        for (var d = 0; d < idxs.length; d++) {
          var md = h0[idxs[d]];
          if (!md || md.sender !== 'USER') continue;
          var qv = md.type === 'image' ? '（发了一张照片，TA能看到：' + md.content + '）'
            : (md.type === 'voice' ? '（发了一段语音，TA能听到：' + md.content + '）' : md.content);
          for (var qi = q.length - 1; qi >= 0; qi--) { if (q[qi] === qv) { q.splice(qi, 1); obChanged = true; break; } }
        }
        if (obChanged) { if (!q.length) delete ob[nm2]; saveOutbox(ob); }
      }
      SBupdate(function (v) {
        var n = v.sb && v.sb.npcs && v.sb.npcs[nm2];
        if (!n || !n.dm_history) return v;
        // 变量持久化端回退（带流水记录）
        var vBatch = [];
        for (var vb = 0; vb < idxs.length; vb++) { if (n.dm_history[idxs[vb]]) vBatch.push(n.dm_history[idxs[vb]]); }
        rollbackMsgEffects(nm2, vBatch, v.sb.wallet || {}, v.sb.closet || [], true);
        for (var i = 0; i < idxs.length; i++) { if (idxs[i] >= 0 && idxs[i] < n.dm_history.length) n.dm_history.splice(idxs[i], 1); }
        n.last_message = lastPreview(n.dm_history[n.dm_history.length - 1]);
        return v;
      });
      var loc = state && state.npcs && state.npcs[nm2];
      if (loc && loc.dm_history) {
        for (var j = 0; j < idxs.length; j++) { if (idxs[j] >= 0 && idxs[j] < loc.dm_history.length) loc.dm_history.splice(idxs[j], 1); }
        loc.last_message = lastPreview(loc.dm_history[loc.dm_history.length - 1]);
      }
      var delN = idxs.length;
      exitMultiSel();
      toast('info', '🗑 已删除 ' + delN + ' 条');
      SBemit('sb_updated');                       // 注入摘要同步遗忘 + 重渲染
      SBemit('sb_scrub_floor', { name: nm2 });    // 楼层誊抄本同步擦掉重誊
      if (loc) openChat(nm2, loc);
    });
    toast('info', '☑️ 多选模式：点消息勾选，选完点底部删除');
  }
  function exitMultiSel() {
    _msel = null;
    var bar = chatEl.querySelector('.sb-mselbar'); if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    var sels = chatEl.querySelectorAll('.sb-msg.sel'); for (var i = 0; i < sels.length; i++) sels[i].classList.remove('sel');
  }

  function armLongPress(e) {
    if (_msel) return;   // 多选模式里长按不再开菜单
    var b = bubbleOf(e.target);
    if (!b || !b.getAttribute('data-nm')) return;
    clearTimeout(_lpTimer);
    _lpTimer = setTimeout(function () { showMsgMenu(b); }, 450);
  }
  chatEl.addEventListener('touchstart', armLongPress, { passive: true });
  chatEl.addEventListener('touchend', function () { clearTimeout(_lpTimer); });
  chatEl.addEventListener('touchmove', function () { clearTimeout(_lpTimer); });   // 滑动=在滚屏，不是长按
  chatEl.addEventListener('mousedown', function (e) { if (e.button === 0) armLongPress(e); });
  chatEl.addEventListener('mouseup', function () { clearTimeout(_lpTimer); });
  chatEl.addEventListener('contextmenu', function (e) {
    var b = bubbleOf(e.target);
    if (b && b.getAttribute('data-nm')) { e.preventDefault(); showMsgMenu(b); }
  });
  SBon('sb_updated', function () {
    var prevUn = totalUnread();   // 震动只在未读涨了才触发（UWU 功能 + 守门：自己发消息/改设置不抖）
    setStatus('✓ 新消息 ' + nowT());
    refreshView();
    if (totalUnread() > prevUn) triggerVibration();
  });
  // 🧾 税务题目就绪（UWU）：流水页税务中心开着就地刷新
  SBon('sb_tax_questions_ready', function () {
    loadState();
    if (_onTaxReady) { var cb = _onTaxReady; _onTaxReady = null; cb(); }
  });
  SBon('sb_dm_failed', function (msg) {
    setStatus('⚠️ ' + (msg || '私信生成失败'));
    // 生成失败 → 摘掉"正在输入…"气泡（成功时 sb_updated 重渲染会自然带走它）
    try { var tps = chatEl.querySelectorAll('.sb-typing'); for (var ti = 0; ti < tps.length; ti++) tps[ti].parentNode.removeChild(tps[ti]); } catch (e) {}
    // 兜底翻译失败 → 清空待展开账本 + 复位死在"⏳ 翻译中"的按钮
    if (Object.keys(_pendingTrs).length) {
      _pendingTrs = {};
      if (currentChatName && state && state.npcs && state.npcs[currentChatName]) openChat(currentChatName, state.npcs[currentChatName]);
    }
  });
  // 📥 旧识背调结果：成功=直接把TA的聊天开出来等第一条私信；失败=复位导入页按钮（失败必出声铁律）
  SBon('sb_import_done', function (p) {
    var nm = (p && p.name) || '';
    loadState();
    toast('success', '📥 ' + nm + ' 已入通讯录' + ((p && p.warnings && p.warnings.length) ? '（' + p.warnings[0] + '）' : ''));
    if (nm && state && state.npcs && state.npcs[nm]) { openChat(nm, state.npcs[nm]); showTyping(nm); }
  });
  SBon('sb_import_failed', function (msg) {
    toast('error', '📥 背调失败：' + (msg || '未知原因'));
    setStatus('⚠️ 背调失败');
    if (currentPage === 'import') {
      var b = chatEl.querySelector('#sbnyc-imp-btn');
      if (b) { b.disabled = false; b.textContent = '🕵️ 开始背调'; }
      var st = chatEl.querySelector('#sbnyc-imp-status');
      if (st) st.textContent = '';
    }
  });
  SBon('sb_status', function (msg) {
    setStatus(msg || '');
  });
  SBon('sb_windfall', function (data) {
    var amt = Number((data && data.amount) != null ? data.amount : data) || 0;
    if (amt < 1000) return;
    _windfall = amt;
    setStatus('✨ S.: 到账 ' + fmtUSD(amt) + '。今天值得犒赏自己 → Elite');
    fetchPool();
  });
  SBon('sb_mag_updated', function () {
    loadState();
    setStatus('📰 本期内容已更新');
    if (chatEl.style.display !== 'none' && currentPage && currentPage !== 'settings') reopenPage();
  });
  SBon('sb_playlist', function (songs) {
    if (Array.isArray(songs) && songs.length) {
      PLAYLIST = songs; songIdx = 0;
      if (Date.now() >= statusUntil) showIsland('♪ ' + PLAYLIST[0]);
    }
  });

  // 初始读一次（填表前 sb 不存在 → 面板显示等待提示，FAB 照样可见 = 脚本活着的证据）
  refreshView();
  console.log('[SB-NYC v4] phone panel mounted (floating, no regex, no markdown + UWU: vibrate/wallpaper/calendar/statement-tax/date-labels/time-adjust)');
})();
