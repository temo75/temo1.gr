(() => {
  "use strict";
  const API = "https://dei-bill-sync.temo75elia.workers.dev";
  const SESSION_KEY = "t1.deiBillSession.v1";
  const L = {
    ka: {title:"NOVA — ელფოსტის ქვითრები",desc:"Gmail-იდან მოძიებული NOVA-ს ინვოისები და გადახდის შეტყობინებები.",connect:"Gmail-ის დაკავშირება",sync:"ელფოსტის შემოწმება",loading:"NOVA-ს წერილებს ვამოწმებ…",history:"მოძიებული NOVA-ს წერილები",count:"ინვოისები",paid:"გადახდილი",due:"გადასახდელი",issued:"წერილის თარიღი",dueDate:"გადახდის ბოლო ვადა",paymentDate:"გადახდის თარიღი",invoice:"ინვოისი",receipt:"გადახდის დადასტურება",paidStatus:"გადახდილია",dueStatus:"გადასახდელია",unknown:"სტატუსი დასადგენია",empty:"NOVA-ს შესაბამისი წერილები ჯერ არ მოიძებნა. დააჭირე „ელფოსტის შემოწმებას“.",notConnected:"Gmail ჯერ არ არის დაკავშირებული. დააჭირე „Gmail-ის დაკავშირებას“ და Google-ის ფანჯარაში დაადასტურე წვდომა.",back:"გადასახადების კატეგორიები",lastSync:"ბოლო შემოწმება",error:"შეცდომა",noDate:"მითითებული არ არის"},
    en: {title:"NOVA — Email bills",desc:"NOVA invoices and payment emails found in Gmail.",connect:"Connect Gmail",sync:"Check email",loading:"Checking NOVA emails…",history:"NOVA emails found",count:"Invoices",paid:"Paid",due:"Due",issued:"Email date",dueDate:"Payment due date",paymentDate:"Payment date",invoice:"Invoice",receipt:"Payment confirmation",paidStatus:"Paid",dueStatus:"Due",unknown:"Status needs checking",empty:"No matching NOVA emails found yet. Tap Check email.",notConnected:"Gmail is not connected. Tap Connect Gmail and approve access in Google's window.",back:"Bill categories",lastSync:"Last checked",error:"Error",noDate:"Not provided"},
    el: {title:"NOVA — Λογαριασμοί email",desc:"Λογαριασμοί NOVA και email πληρωμών που βρέθηκαν στο Gmail.",connect:"Σύνδεση Gmail",sync:"Έλεγχος email",loading:"Έλεγχος email NOVA…",history:"Email NOVA που βρέθηκαν",count:"Λογαριασμοί",paid:"Εξοφλημένα",due:"Προς πληρωμή",issued:"Ημερομηνία email",dueDate:"Προθεσμία πληρωμής",paymentDate:"Ημερομηνία πληρωμής",invoice:"Λογαριασμός",receipt:"Επιβεβαίωση πληρωμής",paidStatus:"Εξοφλήθηκε",dueStatus:"Προς πληρωμή",unknown:"Χρειάζεται έλεγχος",empty:"Δεν βρέθηκαν ακόμη σχετικά email NOVA. Πατήστε Έλεγχος email.",notConnected:"Το Gmail δεν είναι συνδεδεμένο. Πατήστε Σύνδεση Gmail και εγκρίνετε την πρόσβαση.",back:"Κατηγορίες λογαριασμών",lastSync:"Τελευταίος έλεγχος",error:"Σφάλμα",noDate:"Δεν αναφέρεται"}
  };
  let lang = "ka";
  function language() {
    try {
      const uid = String(localStorage.getItem("temoWorkTrackerUserId") || "").trim();
      const v = localStorage.getItem(uid ? "temoLanguage_" + uid : "temoLanguage") || localStorage.getItem("temoLanguage");
      return ["ka","en","el"].includes(v) ? v : "ka";
    } catch { return "ka"; }
  }
  function session() {
    try {
      const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (v && v.token && Date.parse(v.expiresAt) > Date.now()) return v;
    } catch {}
    return null;
  }
  async function api(path, sess, method = "GET", body) {
    const headers = {Accept:"application/json"};
    if (sess && sess.token) headers.Authorization = "Bearer " + sess.token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(API + path, {method,headers,body:body === undefined ? undefined : JSON.stringify(body),cache:"no-store"});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) sessionStorage.removeItem(SESSION_KEY);
      throw new Error(data.error || ("HTTP " + response.status));
    }
    return data;
  }
  async function exchangeCode() {
    const params = new URLSearchParams(location.hash.replace(/^#/,""));
    const code = params.get("dei_code");
    if (!code) return;
    history.replaceState(null,"",location.pathname + location.search);
    const result = await api("/api/session/exchange",null,"POST",{code});
    if (!result.sessionToken || !result.expiresAt) throw new Error("Google session was not returned");
    sessionStorage.setItem(SESSION_KEY,JSON.stringify({token:result.sessionToken,expiresAt:result.expiresAt}));
  }
  const $ = id => document.getElementById(id);
  function euro(v) { return v == null || v === "" ? "—" : new Intl.NumberFormat(lang==="ka"?"ka-GE":lang==="el"?"el-GR":"en-GB",{style:"currency",currency:"EUR"}).format(Number(v)); }
  function date(v) {
    if (!v) return text().noDate;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat(lang==="ka"?"ka-GE":lang==="el"?"el-GR":"en-GB",{year:"numeric",month:"short",day:"numeric",timeZone:"Europe/Athens"}).format(d);
  }
  function text() { return L[lang] || L.ka; }
  function node(tag, cls, value) { const n=document.createElement(tag); if(cls)n.className=cls; if(value!==undefined)n.textContent=value; return n; }
  function status(message, error=false) { $("novaStatus").textContent=message; $("novaStatus").className=error?"error":"muted"; }
  function connect() { location.href = API + "/oauth/start?return_to=" + encodeURIComponent(location.origin + "/nova.html"); }
  function render(data) {
    const t=text(); const bills=Array.isArray(data.bills)?data.bills:[];
    const invoices=bills.filter(b=>b.kind!=="payment-receipt");
    $("novaStats").replaceChildren();
    const stat=(label,value)=>{const card=node("div","stat");card.append(node("span","muted",label),node("strong","",value));$("novaStats").append(card);};
    stat(t.count,String(invoices.length));stat(t.paid,euro(data.totalPaidEUR||0));stat(t.due,euro(data.totalDueEUR||0));
    const list=$("novaList");list.replaceChildren();
    if(!bills.length){list.append(node("p","muted",t.empty));return;}
    bills.forEach(b=>{
      const isReceipt=b.kind==="payment-receipt";
      const card=node("article","bill");
      const head=node("div","billHead");
      head.append(node("h3","",isReceipt?t.receipt:t.invoice));
      const paid=b.paymentStatus==="paid";
      head.append(node("span","pill "+(paid?"paid":b.paymentStatus==="due"?"due":"unknown"),paid?t.paidStatus:b.paymentStatus==="due"?t.dueStatus:t.unknown));
      card.append(head,node("div","amount",euro(b.totalEUR)));
      const detail=(label,value)=>{const row=node("div","detail");row.append(node("span","muted",label),node("span","",value||"—"));card.append(row);};
      detail(t.issued,date(b.emailDate));detail(t.dueDate,date(b.dueDate));
      if(b.paymentDate)detail(t.paymentDate,date(b.paymentDate));
      if(b.subject)detail(lang==="el"?"Θέμα email":lang==="en"?"Email subject":"წერილის სათაური",b.subject);
      list.append(card);
    });
  }
  async function load(sync) {
    const t=text(); const button=$("novaSync");button.disabled=true;
    try {
      const sess=session();
      if(!sess) { $("novaConnect").hidden=false;button.disabled=false;status(t.notConnected);$("novaList").replaceChildren();$("novaStats").replaceChildren();return; }
      $("novaConnect").hidden=true;status(sync?t.loading:"");
      const data=await api(sync?"/api/nova/sync":"/api/nova/history",sess,sync?"POST":"GET");
      render(data);
      status(data.lastSyncAt ? t.lastSync+": "+date(data.lastSyncAt) : "");
    } catch(e) {
      status(t.error+": "+(e.message||String(e)),true);
    } finally {button.disabled=false;}
  }
  function init() {
    lang=language();const t=text();
    document.documentElement.lang=lang;
    $("novaTitle").textContent=t.title;$("novaDesc").textContent=t.desc;$("novaConnect").textContent=t.connect;$("novaSync").textContent=t.sync;$("novaHistoryTitle").textContent=t.history;$("novaBack").textContent="← "+t.back;
    $("novaConnect").addEventListener("click",connect);
    $("novaSync").addEventListener("click",()=>load(true));
    $("novaBack").addEventListener("click",()=>location.href="./bills.html");
    (async()=>{try{await exchangeCode();await load(false);}catch(e){status(t.error+": "+(e.message||String(e)),true);}})();
  }
  document.addEventListener("DOMContentLoaded",init,{once:true});
})();