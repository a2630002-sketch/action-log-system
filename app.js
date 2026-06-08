const $ = (id) => document.getElementById(id);
const STORE_KEY = "actionLogSystem.v1";
let session = { key: null, userId: null, logs: [] };

const enc = new TextEncoder();
const dec = new TextDecoder();
const todayISO = () => new Date().toISOString().slice(0,10);
const pad = (n) => String(n).padStart(2,"0");
const timeNow = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uidOk = (v) => /^[A-Za-z0-9]{8,}$/.test(v);
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function sha256(text){ return b64(await crypto.subtle.digest("SHA-256", enc.encode(text))); }
async function deriveKey(password, salt){
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:310000, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function encryptJSON(obj, key){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, data);
  return { iv: b64(iv), cipher: b64(cipher) };
}
async function decryptJSON(payload, key){
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv: fromB64(payload.iv)}, key, fromB64(payload.cipher));
  return JSON.parse(dec.decode(plain));
}
function loadStore(){ return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
function saveStore(obj){ localStorage.setItem(STORE_KEY, JSON.stringify(obj)); }
async function persist(){
  const store = loadStore();
  const encrypted = await encryptJSON({ logs: session.logs }, session.key);
  saveStore({ ...store, encrypted });
}

function setAuthMessage(text){ $("authMessage").textContent = text || ""; }
async function auth(e){
  e.preventDefault(); setAuthMessage("");
  const userId = $("userId").value.trim(); const password = $("password").value;
  if(!uidOk(userId)) return setAuthMessage("IDは8文字以上の英数字にしてください。");
  if(password.length < 12) return setAuthMessage("パスワードは12文字以上にしてください。");
  const store = loadStore();
  if(!store){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    session = { key, userId, logs: [] };
    const encrypted = await encryptJSON({ logs: [] }, key);
    saveStore({ userHash: await sha256(userId), passHash: await sha256(userId + ":" + password), salt: b64(salt), encrypted });
    openApp(); return;
  }
  if(await sha256(userId) !== store.userHash || await sha256(userId + ":" + password) !== store.passHash){
    return setAuthMessage("IDまたはパスワードが違います。この端末の登録情報と一致しません。");
  }
  try{
    const key = await deriveKey(password, fromB64(store.salt));
    const data = await decryptJSON(store.encrypted, key);
    session = { key, userId, logs: data.logs || [] };
    openApp();
  }catch(err){ setAuthMessage("復号に失敗しました。パスワードを確認してください。"); }
}
function openApp(){
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("logoutBtn").classList.remove("hidden");
  const d = new Date(); $("todayLabel").textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  $("startTime").value = timeNow(); $("endTime").value = timeNow();
  $("gentleMessage").textContent = "完璧な記録ではなく、1件だけ残せば十分です。反省より、次に動ける形へ。";
  render();
}
function logout(){ session = {key:null,userId:null,logs:[]}; location.reload(); }
function minutesBetween(s,e){
  const [sh,sm]=s.split(":").map(Number), [eh,em]=e.split(":").map(Number);
  let start=sh*60+sm, end=eh*60+em; if(end<start) end += 24*60; return Math.max(0,end-start);
}
async function addLog(e){
  e.preventDefault();
  const log = { id: crypto.randomUUID(), date: todayISO(), createdAt: new Date().toISOString(), activity: $("activity").value.trim(), startTime: $("startTime").value, endTime: $("endTime").value, minutes: minutesBetween($("startTime").value,$("endTime").value), done: Number($("done").value), mood: Number($("mood").value), blocker: $("blocker").value, nextAction: $("nextAction").value.trim() };
  session.logs.unshift(log); await persist(); $("logForm").reset(); $("done").value=3; $("mood").value=3; updateRangeLabels(); $("startTime").value=timeNow(); $("endTime").value=timeNow(); render();
}
async function deleteLog(id){ session.logs = session.logs.filter(l => l.id !== id); await persist(); render(); }
async function clearToday(){ if(!confirm("今日のログをすべて削除しますか？")) return; session.logs = session.logs.filter(l => l.date !== todayISO()); await persist(); render(); }
function render(){ renderLogs(); renderStats(); }
function renderLogs(){
  const list = $("logList"); list.innerHTML = "";
  const todays = session.logs.filter(l => l.date === todayISO());
  if(!todays.length){ list.innerHTML = `<p class="muted">まだ今日のログはありません。まずは「研究を開始」などを押すだけでOKです。</p>`; return; }
  for(const log of todays){
    const node = $("logTemplate").content.cloneNode(true);
    node.querySelector(".log-activity").textContent = log.activity;
    node.querySelector(".log-meta").textContent = `${log.startTime}〜${log.endTime} / ${log.minutes}分 / 実行${log.done}/5 / 気分${log.mood}/5 / ${log.blocker}`;
    node.querySelector(".log-next").textContent = log.nextAction ? `次: ${log.nextAction}` : "次: 未入力";
    node.querySelector(".delete-log").addEventListener("click", () => deleteLog(log.id));
    list.appendChild(node);
  }
}
function renderStats(){
  const today = todayISO();
  const todayLogs = session.logs.filter(l => l.date === today);
  $("todayMinutes").textContent = todayLogs.reduce((a,l)=>a+(l.minutes||0),0);
  const since = new Date(); since.setDate(since.getDate()-6); const sinceISO = since.toISOString().slice(0,10);
  const weekLogs = session.logs.filter(l => l.date >= sinceISO); $("weekEntries").textContent = weekLogs.length;
  const counts = {}; weekLogs.forEach(l => counts[l.blocker] = (counts[l.blocker]||0)+1);
  const top = Object.entries(counts).filter(([k])=>k!=="なし").sort((a,b)=>b[1]-a[1])[0];
  $("topBlocker").textContent = top ? top[0] : "-";
  $("streakCount").textContent = calcStreak();
  $("reflectionHint").textContent = makeHint(top?.[0]);
}
function calcStreak(){
  const dates = new Set(session.logs.map(l=>l.date)); let streak=0; const d = new Date();
  while(dates.has(d.toISOString().slice(0,10))){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}
function makeHint(blocker){
  const hints = {
    "疲労・眠気":"疲労が多い日は、開始目標を『5分だけ』に下げ、睡眠・休憩もログに残すと原因が見えます。",
    "興味が湧かない":"興味が湧かないタスクは、意味づけより先に『1クリック』『1文』まで分解すると始めやすくなります。",
    "予定の競合・急用":"急用が多い時期は、予備時間を予定に入れ、できなかった記録も失敗ではなく調整材料にしましょう。",
    "タスクが曖昧":"曖昧さが多い場合は、次の最小行動を『ファイルを開く』『見出しを書く』の形にしてください。",
    "スマホ・動画":"スマホが多い日は、始める前にNotionや資料を先に開く儀式を作るのがおすすめです。",
    "不安・恥への恐れ":"不安が強い時は、人に見せる完成物ではなく、非公開の下書き1行をゴールにしてください。",
    "生活管理・忘れ物":"生活管理は気合いではなく外部化です。チェックリスト化できる項目を1つだけ増やしましょう。"
  };
  return hints[blocker] || "今日の記録から、次の最小行動を1つだけ決めましょう。できなかった理由は自己批判ではなく設計材料です。";
}
function updateRangeLabels(){ $("doneValue").textContent = $("done").value; $("moodValue").textContent = $("mood").value; }
function quick(activity){ $("activity").value = activity; $("startTime").value = timeNow(); $("endTime").value = timeNow(); window.scrollTo({top:0,behavior:"smooth"}); }
function download(name, content, type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function exportJSON(){ download(`action_logs_${todayISO()}.json`, JSON.stringify(session.logs,null,2), "application/json"); }
function exportCSV(){
  const header = ["date","startTime","endTime","minutes","activity","done","mood","blocker","nextAction","createdAt"];
  const rows = session.logs.map(l => header.map(k => `"${String(l[k] ?? "").replaceAll('"','""')}"`).join(","));
  download(`action_logs_${todayISO()}.csv`, [header.join(","),...rows].join("\n"), "text/csv;charset=utf-8");
}
async function importJSON(e){ const file=e.target.files[0]; if(!file) return; const data=JSON.parse(await file.text()); if(!Array.isArray(data)) return alert("JSON形式が違います"); session.logs = [...data, ...session.logs]; await persist(); render(); alert("読み込みました"); }

$("authForm").addEventListener("submit", auth); $("logoutBtn").addEventListener("click", logout); $("logForm").addEventListener("submit", addLog); $("clearTodayBtn").addEventListener("click", clearToday);
$("done").addEventListener("input", updateRangeLabels); $("mood").addEventListener("input", updateRangeLabels); updateRangeLabels();
document.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => quick(b.dataset.quick)));
$("exportJsonBtn").addEventListener("click", exportJSON); $("exportCsvBtn").addEventListener("click", exportCSV); $("importJson").addEventListener("change", importJSON);
if("serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
