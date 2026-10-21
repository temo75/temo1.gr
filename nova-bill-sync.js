(() => {
  "use strict";
  const API = "https://dei-bill-sync.temo75elia.workers.dev";
  const SESSION_KEY = "t1.deiBillSession.v1";
  const text = {
    ka: {title:"NOVA — გადასახადები",desc:"Gmail-იდან NOVA-ს ქვითრები",sync:"განახლება",connect:"Gmail-ის დაკავშირება",loading:"NOVA-ს წერილებს ვკითხულობ…",count:"ქვითრების რაოდენობა",paid:"გადახდილი ჯამი",due:"გადასახდელი ჯამი",history:"NOVA-ს ქვითრების ისტორია",amount:"თანხა",status:"სტატუსი",issued:"წერილის თარიღი",dueDate:"გადახდის ბოლო ვადა",paidDate:"გადახდის თარიღი",paidStatus:"გადახდილია",dueStatus:"გადასახდელია",unknown:"სტატუსი უცნობია",noDate:"მითითებული არ არის",empty:"NOVA-ს შესაბამისი წერილები ჯერ არ მოიძებნა.",error:"შეცდომა",back:"კატეგორიებზე დაბრუნება",receipt:"გადახდის დადასტურება",invoice:"ქვითარი"},
    en: {title:"NOVA — Bills",desc:"NOVA bills from Gmail",sync:"Refresh",connect:"Connect Gmail",loading:"Reading NOVA emails…",count:"Number of bills",paid:"Total paid",due:"Total due",history:"NOVA bill history",amount:"Amount",status:"Status",issued:"Email date",dueDate:"Payment due date",paidDate:"Payment date",paidStatus:"Paid",dueStatus:"Due",unknown:"Status unknown",noDate:"Not provided",empty:"No matching NOVA emails found yet.",error:"Error",back:"Back to categories",receipt:"Payment confirmation",invoice:"Bill"},
    el: {title:"NOVA — Λογαριασμοί",desc:"Λογαριασμοί NOVA από το Gmail",sync:"Ανανέωση",connect:"Σύνδεση Gmail",loading:"Ανάγνωση email NOVA…",count:"Αριθμός λογαριασμών",paid:"Σύνολο εξοφλημένων",due:"Σύνολο προς πληρωμή",history:"Ιστορικό λογαριασμών NOVA",amount:"Ποσό",status:"Κατάσταση",issued:"Ημερομηνία email",dueDate:"Προθεσμία πληρωμής",paidDate:"Ημερομηνία πληρωμής",paidStatus:"Εξοφλήθηκε",dueStatus:"Προς πληρωμή",unknown:"Άγνωστη κατάσταση",noDate:"Δεν αναφέρεται",empty:"Δεν βρέθηκαν ακόμη σχετικά email NOVA.",error:"Σφάλμα",back:"Επιστροφή στις κατηγορίες",receipt:"Επιβεβαίωση πληρωμής",invoice:"Λογαριασμός"}
  };
  function session(){try{const v=JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");return v&&v.token&&Date.parse(v.expiresAt)>Date.now()?v:null;}catch{return null;}}
  async function api(path, sess, method="GET"){const headers={Accept:"application/json"};if(sess?.token)headers.Authorization="Bearer "+sess.token;const r=await fetch(API+path,{method,headers,cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||("HTTP "+r.status));return d;}
  function date(value, lang){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);return new Intl.DateTimeFormat(lang==="ka"?"ka-GE":lang==="el"?"el-GR":"en-GB",{year:"numeric",month:"short",day:"numeric",timeZone:"Europe/Athens"}).format(d);}
  function euro(value, lang){if(value==null||value==="")return "—";return new Intl.NumberFormat(lang==="ka"?"ka-GE":lang==="el"?"el-GR":"en-GB",{style:"currency",currency:"EUR"}).format(Number(value));}
  function el(tag, cls, value){const n=document.createElement(tag);if(cls)n.className=cls;if(value!=null)n.textContent=value;return n;}
  function mount(root, lang){const t=text[lang]||text.ka;root.replaceChildren();root.className="nova-bill-root";
    const style=el("style");style.textContent=".nova-bill-root{color:var(--text,#edf7fb);padding:12px 0 90px}.nova-bill-panel{border:1px solid #2999df;border-radius:20px;background:linear-gradient(145deg,#0d1b24,#10232f);padding:18px;margin:10px 0 18px}.nova-bill-root h1{font-size:25px;margin:0 0 8px}.nova-muted{color:#a7b8c2;line-height:1.5}.nova-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.nova-btn{border:1px solid #31556a;border-radius:14px;padding:12px 16px;background:#19394a;color:#f4f9fc;font:inherit}.nova-btn.primary{border-color:#2999df}.nova-stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.nova-stat{padding:12px;border:1px solid #31556a;border-radius:14px;background:#0b2029}.nova-stat span{display:block;color:#a7b8c2;font-size:14px;margin-bottom:6px}.nova-stat strong{font-size:20px}.nova-bill-card{border:1px solid #294757;border-radius:17px;padding:16px;margin:12px 0;background:rgba(4,18,25,.42)}.nova-bill-head{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.nova-bill-amount{font-size:24px;font-weight:700}.nova-pill{border-radius:12px;padding:7px 10px;background:#393622;font-weight:700}.nova-pill.paid{background:#173c2b;color:#8ef0b1}.nova-row{margin-top:14px}.nova-label{display:block;color:#a7b8c2;font-size:14px;margin-bottom:3px}.nova-error{color:#ffaaaa;white-space:pre-wrap}.nova-empty{padding:18px 0;color:#a7b8c2}.nova-bill-root[hidden]{display:none}@media(min-width:600px){.nova-stats{grid-template-columns:repeat(3,1fr)}}";
    root.append(style);
    const panel=el("div","nova-bill-panel");panel.append(el("h1","",t.title),el("p","nova-muted",t.desc));
    const status=el("p","nova-muted","");panel.append(status);
    const actions=el("div","nova-actions");const sync=el("button","nova-btn primary",t.sync);sync.type="button";const connect=el("button","nova-btn",t.connect);connect.type="button";actions.append(sync,connect);panel.append(actions);
    const stats=el("div","nova-stats");panel.append(stats);
    const histPanel=el("div","nova-bill-panel");histPanel.append(el("h2","",t.history));const list=el("div","");histPanel.append(list);root.append(panel,histPanel);
    connect.addEventListener("click",()=>{location.href=API+"/oauth/start?return_to="+encodeURIComponent(location.origin+location.pathname);});
    async function load(doSync){const sess=session();status.textContent=doSync?t.loading:"";list.replaceChildren();stats.replaceChildren();sync.disabled=true;connect.hidden=!!sess;
      if(!sess){status.textContent=lang==="el"?"Συνδέστε πρώτα το Gmail από την ενότητα ΔΕΗ.":lang==="en"?"Connect Gmail first in the DEI section.":"ჯერ Gmail დააკავშირე დენის (DEI) განყოფილებიდან.";sync.disabled=false;return;}
      try{const d=await api(doSync?"/api/nova/sync":"/api/nova/history",sess,doSync?"POST":"GET");status.textContent=d.lastSyncAt?((lang==="el"?"Τελευταίος συγχρονισμός: ":lang==="en"?"Last sync: ":"ბოლო სინქრონიზაცია: ")+date(d.lastSyncAt,lang)):"";
        const stat=(label,val)=>{const box=el("div","nova-stat");box.append(el("span","",label),el("strong","",val));stats.append(box);};
        stat(t.count,String(d.count||0));stat(t.paid,euro(d.totalPaidEUR||0,lang));stat(t.due,euro(d.totalDueEUR||0,lang));
        const bills=Array.isArray(d.bills)?d.bills:[];
        if(!bills.length){list.append(el("p","nova-empty",t.empty));return;}
        bills.forEach(b=>{const card=el("article","nova-bill-card");const head=el("div","nova-bill-head");head.append(el("div","nova-bill-amount",euro(b.totalEUR,lang)));const paid=b.paymentStatus==="paid";const due=b.paymentStatus==="due";head.append(el("span","nova-pill"+(paid?" paid":""),paid?t.paidStatus:due?t.dueStatus:t.unknown));card.append(head);
          const row=(label,val)=>{const wrap=el("div","nova-row");wrap.append(el("span","nova-label",label),el("div","",val||"—"));card.append(wrap);};
          row(t.issued,date(b.emailDate,lang));row(t.dueDate,date(b.dueDate,lang));if(paid&&b.paymentDate)row(t.paidDate,date(b.paymentDate,lang));if(b.subject)row(lang==="el"?"Θέμα email":lang==="en"?"Email subject":"წერილის სათაური",b.subject);
          list.append(card);
        });
      }catch(e){status.className="nova-error";status.textContent=t.error+": "+(e.message||String(e));}
      finally{sync.disabled=false;}
    }
    sync.addEventListener("click",()=>load(true));load(false);
  }
  window.NOVABillSync={mount};
})();