(() => {
  "use strict";
  const API = "https://dei-bill-sync.temo75elia.workers.dev";
  const SESSION_KEY = "t1.deiBillSession.v1";

  function getSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (!value || !value.token || !value.expiresAt || Date.parse(value.expiresAt) <= Date.now()) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return value;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  async function api(path, session, options) {
    const config = options || {};
    const headers = { "Accept": "application/json" };
    if (config.body) headers["Content-Type"] = "application/json";
    if (session && session.token) headers.Authorization = "Bearer " + session.token;
    const response = await fetch(API + path, {
      method: config.method || "GET",
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
      cache: "no-store"
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401 && session) sessionStorage.removeItem(SESSION_KEY);
      throw new Error(data.error || ("Worker returned HTTP " + response.status));
    }
    return data;
  }

  async function exchangeOAuthCode() {
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    const code = fragment.get("dei_code");
    if (!code) return false;
    history.replaceState(null, "", location.pathname + location.search);
    const result = await api("/api/session/exchange", null, { method: "POST", body: { code } });
    if (!result.sessionToken || !result.expiresAt) throw new Error("Worker returned an incomplete session");
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: result.sessionToken, expiresAt: result.expiresAt }));
    return true;
  }

  function selectedLanguage() {
    try {
      const uid = String(localStorage.getItem("temoWorkTrackerUserId") || "").trim();
      const saved = localStorage.getItem(uid ? "temoLanguage_" + uid : "temoLanguage");
      if (["ka", "en", "el"].includes(saved)) return saved;
      const global = localStorage.getItem("temoLanguage");
      return ["ka", "en", "el"].includes(global) ? global : "ka";
    } catch { return "ka"; }
  }

  const WIDGET_TEXT = {
    "ქვითრების რაოდენობა": ["Number of bills", "Αριθμός λογαριασμών"],
    "გადახდილი ჯამი": ["Total paid", "Σύνολο εξοφλημένων"],
    "გადასახდელი ჯამი": ["Total due", "Σύνολο προς πληρωμή"],
    "წლიური ჯამები": ["Annual totals", "Ετήσια σύνολα"],
    "გადახდილი": ["Paid", "Εξοφλημένα"],
    "გადასახდელი": ["Due", "Προς πληρωμή"],
    "წლიური ჯამები ჯერ არ არის.": ["No annual totals yet.", "Δεν υπάρχουν ακόμη ετήσια σύνολα."],
    "ჯერ შენახული ქვითრები არ არის. დააჭირე სინქრონიზაციას.": ["No saved bills yet. Press Sync now.", "Δεν υπάρχουν ακόμη αποθηκευμένοι λογαριασμοί. Πατήστε Συγχρονισμός τώρα."],
    "თანხა წერილიდან ვერ ამოვიღე": ["Could not extract amount from the email", "Δεν ήταν δυνατή η εξαγωγή ποσού από το email"],
    "ვადა წერილში ვერ მოიძებნა": ["Due date not found in the email", "Δεν βρέθηκε προθεσμία στο email"],
    "ვადა გადაცილებულია": ["Overdue", "Εκπρόθεσμο"],
    "გადახდის ვადა": ["Payment due date", "Προθεσμία πληρωμής"],
    "გადახდის სტატუსი": ["Payment status", "Κατάσταση πληρωμής"],
    "ქვითრის წერილი": ["Bill email", "Email λογαριασμού"],
    "ბოლო სინქრონიზაცია": ["Last sync", "Τελευταίος συγχρονισμός"],
    "თანხა": ["Amount", "Ποσό"],
    "გადახდილია": ["Paid", "Εξοφλήθηκε"],
    "გადასახდელია": ["Due", "Προς πληρωμή"],
    "შესამოწმებელია": ["Needs checking", "Χρειάζεται έλεγχο"],
    "ბოლო ქვითრის ისტორია": ["Latest bill history", "Ιστορικό τελευταίων λογαριασμών"],
    "ბოლო ქვითარი უსაფრთხოდ ჩაიტვირთა KV-დან.": ["The latest bill was securely loaded from KV.", "Ο τελευταίος λογαριασμός φορτώθηκε με ασφάλεια από το KV."],
    "Gmail აქტორიზებულია ამ ბრაუზერში": ["Gmail is authorized in this browser", "Το Gmail είναι εξουσιοδοτημένο σε αυτό το πρόγραμμα περιήγησης"],
    "Gmail აქტორიზებულია ამ ბრაუზერში": ["Gmail is authorized in this browser", "Το Gmail είναι εξουσιοδοτημένο σε αυτό το πρόγραμμα περιήγησης"],
    "Gmail აქტორიზებულია ამ ბრაუზერში": ["Gmail is authorized in this browser", "Το Gmail είναι εξουσιοδοτημένο σε αυτό το πρόγραμμα περιήγησης"]
  };

  function translateWidgetText(value) {
    let text = String(value ?? "");
    const lang = selectedLanguage();
    if (lang === "ka") return text;
    const replacements = Object.entries(WIDGET_TEXT)
      .map(([ka, pair]) => [ka, pair[lang === "en" ? 0 : 1]])
      .sort((a, b) => b[0].length - a[0].length);
    for (const [source, target] of replacements) text = text.split(source).join(target);
    return text;
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = translateWidgetText(value);
    return node;
  }

  function formatAmount(value) {
    if (value === null || value === undefined || value === "") return "თანხა წერილიდან ვერ ამოვიღე";
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "თანხა წერილიდან ვერ ამოვიღე";
    return new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(amount);
  }

  function dateLocale() {
    const lang = selectedLanguage();
    return lang === "en" ? "en-GB" : lang === "el" ? "el-GR" : "ka-GE";
  }

  function formatDueDate(value) {
    if (!value) return translateWidgetText("ვადა წერილში ვერ მოიძებნა");
    const date = new Date(value + "T00:00:00Z");
    return Number.isNaN(date.getTime())
      ? translateWidgetText("ვადა წერილში ვერ მოიძებნა")
      : date.toLocaleDateString(dateLocale(), { timeZone: "UTC" });
  }

  function formatEmailDate(value) {
    if (!value) return translateWidgetText("თარიღი უცნობია");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return translateWidgetText("თარიღი უცნობია");
    return new Intl.DateTimeFormat(dateLocale(), {
      year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Athens"
    }).format(date);
  }

    function paymentLabel(status, dueDate) {
    if (status === "paid") return "გადახდილია";
    if (status === "due") {
      if (dueDate && new Date(dueDate + "T23:59:59Z").getTime() < Date.now()) return "ვადა გადაცილებულია";
      return "გადასახდელია";
    }
    return "წერილში გადახდის სტატუსი ვერ დადგინდა";
  }

  function mount(root) {
    if (!root) return;
    root.replaceChildren();
    root.classList.add("dei-sync-widget");

    const header = element("div", "dei-sync-header");
    header.append(element("h2", "", "⚡ ΔΕΗ — მიმდინარე ქვითარი"));
    const badge = element("span", "dei-sync-badge", "სტატუსის შემოწმება…");
    header.append(badge);

    const message = element("p", "dei-sync-message", "ვამოწმებ Gmail კავშირს…");
    const details = element("dl", "dei-sync-details");
    details.hidden = true;
    const fields = [
      ["amount", "თანხა"],
      ["due", "გადახდის ბოლო ვადა"],
      ["payment", "გადახდის სტატუსი"],
      ["email", "ქვითრის წერილი"],
      ["sync", "ბოლო სინქრონიზაცია"]
    ];
    const values = {};
    fields.forEach(([key, label]) => {
      details.append(element("dt", "", label));
      values[key] = element("dd", "dei-sync-" + key, "—");
      details.append(values[key]);
    });

    const actions = element("div", "dei-sync-actions");
    const connect = element("button", "dei-sync-primary", "Gmail-ის უსაფრთხოდ დაკავშირება");
    const sync = element("button", "", "განაახლე");
    const signOut = element("button", "", "ანგარიშიდან გასვლა");
    sync.hidden = true;
    signOut.hidden = true;
    actions.append(connect, sync, signOut);
    const historyPanel = element("section", "dei-bill-history");
    const historyTitle = element("h3", "", "შენახული ქვითრების ისტორია");
    const historySummary = element("p", "muted", "ისტორია ჯერ არ ჩატვირთულა.");
    const annualSummary = element("div", "dei-bill-annual-summary");
    const historyList = element("div", "dei-bill-history-list");
    const historyFooter = element("div", "dei-bill-history-footer");
    historyFooter.style.cssText = "display:flex;justify-content:flex-end;margin-top:12px";
    const clearHistory = element("button", "dei-bill-clear-history", "ისტორიის წაშლა");
    clearHistory.type = "button";
    clearHistory.style.cssText = "background:#45242a;border:1px solid #74333d;color:#fff;min-height:40px;padding:9px 12px";
    historyFooter.append(clearHistory);
    historyPanel.append(historyTitle, historySummary, annualSummary, historyList, historyFooter);
    root.append(header, message, details, actions, historyPanel);

    function setStatus(text, good) {
      badge.textContent = text;
      badge.classList.toggle("is-connected", Boolean(good));
      badge.classList.toggle("is-error", good === false);
    }

    function connectGmail() {
      const returnTo = location.origin + location.pathname;
      location.assign(API + "/oauth/start?return_to=" + encodeURIComponent(returnTo));
    }

    function renderBill(bill) {
      details.hidden = false;
      values.amount.textContent = formatAmount(bill.totalEUR);
      values.due.textContent = formatDueDate(bill.dueDate);
      values.payment.textContent = paymentLabel(bill.paymentStatus, bill.dueDate);
      values.email.textContent = bill.emailDate || "თარიღი არ არის მითითებული";
      values.sync.textContent = (bill.lastSyncAt || bill.fetchedAt) ? new Date(bill.lastSyncAt || bill.fetchedAt).toLocaleString("ka-GE") : "ჯერ არ დასინქრონებულა";
      window.dispatchEvent(new CustomEvent("t1:dei-bill", { detail: bill }));
    }

    async function refreshHistory(session) {
      const result = await api("/api/history", session);
      if (!result || result.ok !== true || !Array.isArray(result.bills)) {
        throw new Error("Worker-ის /api/history endpoint არ აბრუნებს ქვითრების ისტორიას. განახლებული Worker ჯერ არ არის აქტიური.");
      }
      historyList.replaceChildren();
      historySummary.textContent = "";
      historySummary.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:14px 0 18px;padding:14px;border:1px solid #254253;border-radius:14px;background:linear-gradient(145deg,rgba(14,36,47,.96),rgba(8,25,34,.92));box-shadow:0 5px 16px rgba(0,0,0,.12);";
      const countBox = element("div", "");
      countBox.style.cssText = "grid-column:1 / -1;padding:10px 12px;border:1px solid rgba(70,111,132,.5);border-radius:10px;background:rgba(5,20,28,.45);";
      const countLabel = element("div", "", "ქვითრების რაოდენობა");
      countLabel.style.cssText = "font-size:.88rem;color:#a9bbc4;margin-bottom:4px;";
      const countValue = element("strong", "", String(result.count));
      countValue.style.cssText = "font-size:1.2rem;color:#f1f7f8;";
      countBox.append(countLabel, countValue);
      const paidBox = element("div", "");
      paidBox.style.cssText = "min-width:0;padding:11px 10px;border:1px solid rgba(40,150,95,.32);border-radius:10px;background:rgba(40,150,95,.10);";
      const paidLabel = element("div", "", "გადახდილი ჯამი");
      paidLabel.style.cssText = "font-size:.83rem;color:#a9bbc4;margin-bottom:6px;";
      const paidValue = element("strong", "", formatAmount(result.totalPaidEUR));
      paidValue.style.cssText = "display:block;font-size:1.02rem;color:#e9f8ef;overflow-wrap:anywhere;";
      paidBox.append(paidLabel, paidValue);
      const dueBox = element("div", "");
      dueBox.style.cssText = "min-width:0;padding:11px 10px;border:1px solid rgba(220,155,35,.32);border-radius:10px;background:rgba(220,155,35,.10);";
      const dueLabel = element("div", "", "გადასახდელი ჯამი");
      dueLabel.style.cssText = "font-size:.83rem;color:#a9bbc4;margin-bottom:6px;";
      const dueValue = element("strong", "", formatAmount(result.totalDueEUR));
      dueValue.style.cssText = "display:block;font-size:1.02rem;color:#fff0ce;overflow-wrap:anywhere;";
      dueBox.append(dueLabel, dueValue);
      historySummary.append(countBox, paidBox, dueBox);
      annualSummary.replaceChildren();
      annualSummary.style.cssText = "margin:18px 0 20px;padding:14px;border:1px solid #254253;border-radius:14px;background:linear-gradient(145deg,rgba(14,36,47,.96),rgba(8,25,34,.9));";
      const annualTitle = element("h4", "", "📊 წლიური ჯამები");
      annualTitle.style.cssText = "margin:0 0 12px;font-size:1.08rem;letter-spacing:.2px;";
      annualSummary.append(annualTitle);
      if (Array.isArray(result.annualTotals) && result.annualTotals.length) {
        result.annualTotals.forEach((year) => {
          const line = element("div", "dei-bill-year-total");
          line.style.cssText = "display:flex;flex-direction:column;gap:10px;padding:12px;margin:9px 0 0;border:1px solid rgba(70,111,132,.55);border-radius:11px;background:rgba(5,20,28,.52);";
          const yearTitle = element("strong", "", String(year.year));
          yearTitle.style.cssText = "font-size:1.05rem;color:#eef7f7;";
          const values = element("div", "");
          values.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
          const paid = element("div", "");
          paid.style.cssText = "min-width:0;padding:10px;border-radius:9px;background:rgba(40,150,95,.12);border:1px solid rgba(40,150,95,.25);";
          const paidLabel = element("div", "", "გადახდილი");
          paidLabel.style.cssText = "font-size:.84rem;color:#9fb0b8;margin-bottom:5px;";
          const paidValue = element("strong", "", formatAmount(year.paidEUR));
          paidValue.style.cssText = "font-size:1rem;overflow-wrap:anywhere;";
          paid.append(paidLabel, paidValue);
          const due = element("div", "");
          due.style.cssText = "min-width:0;padding:10px;border-radius:9px;background:rgba(220,155,35,.12);border:1px solid rgba(220,155,35,.25);";
          const dueLabel = element("div", "", "გადასახდელი");
          dueLabel.style.cssText = "font-size:.84rem;color:#9fb0b8;margin-bottom:5px;";
          const dueValue = element("strong", "", formatAmount(year.dueEUR));
          dueValue.style.cssText = "font-size:1rem;overflow-wrap:anywhere;";
          due.append(dueLabel, dueValue);
          values.append(paid, due);
          line.append(yearTitle, values);
          annualSummary.append(line);
        });
      } else {
        const emptyAnnual = element("p", "muted", "წლიური ჯამები ჯერ არ არის.");
        emptyAnnual.style.cssText = "margin:0;";
        annualSummary.append(emptyAnnual);
      }
      if (!result.bills.length) {
        historyList.append(element("p", "muted", "ჯერ შენახული ქვითრები არ არის. დააჭირე სინქრონიზაციას."));
        return;
      }
      result.bills.forEach((bill) => {
        const row = element("article", "dei-bill-history-item");
        row.style.cssText = "display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:14px;margin:10px 0;border:1px solid #254253;border-radius:12px;background:rgba(8,25,34,.55);overflow-wrap:anywhere;min-width:0;";
        const topLine = element("div", "");
        topLine.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;";
        const amount = element("strong", "", formatAmount(bill.totalEUR));
        amount.style.cssText = "font-size:1.2rem;";
        const status = element("span", "", paymentLabel(bill.paymentStatus, bill.dueDate));
        status.style.cssText = "font-weight:700;padding:5px 9px;border-radius:8px;background:" + (bill.paymentStatus === "paid" ? "rgba(40,150,95,.18)" : bill.paymentStatus === "due" ? "rgba(220,155,35,.18)" : "rgba(130,145,155,.15)") + ";";
        topLine.append(amount, status);
        row.append(topLine);
        const emailLine = element("div", "");
        emailLine.style.cssText = "font-size:.95rem;line-height:1.5;overflow-wrap:anywhere;";
        emailLine.append(element("span", "", "ქვითრის თარიღი: "), element("strong", "", formatEmailDate(bill.emailDate)));
        const dueLine = element("div", "");
        dueLine.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:4px;font-size:.95rem;line-height:1.5;min-width:0;";
        const dueValue = element("strong", "", formatDueDate(bill.dueDate));
        dueValue.style.cssText = "white-space:nowrap;font-variant-numeric:tabular-nums;";
        dueLine.append(element("span", "", "გადახდის საბოლოო ვადა:"), dueValue);
        row.append(emailLine, dueLine);
        historyList.append(row);
      });
    }

async function syncAllPages(session) {
      let result = null;
      let continueSync = false;
      let pages = 0;
      do {
        message.textContent = pages
          ? "Gmail-ის ძველი ქვითრების გვერდებს ვამოწმებ… (" + pages + ")"
          : "Gmail-იდან DEI ქვითრებს ვკითხულობ…";
        result = await api("/api/sync", session, { method: "POST", body: { continue: continueSync } });
        pages++;
        continueSync = result.complete === false;
      } while (continueSync);
      result.syncPages = pages;
      return result;
    }

    async function refresh(force) {
      const session = getSession();
      if (!session) {
        sync.hidden = true;
        signOut.hidden = true;
        setStatus("ამ ბრაუზერში Gmail არ არის ავტორიზებული", false);
        message.textContent = "დააკავშირე Google ანგარიში OAuth-ის ოფიციალური თანხმობის გვერდით. პაროლს ან საიდუმლო გასაღებს ეს გვერდი არ ითხოვს.";
        const status = await api("/api/status", null);
        if (status.gmailConnected) message.textContent = "Gmail Worker-თან უკვე დაკავშირებულია. ამ მოწყობილობაზე მონაცემების სანახავად დააჭირე დაკავშირებას.";
        return;
      }
      connect.hidden = true;
      sync.hidden = false;
      signOut.hidden = false;
      setStatus("Gmail ავტორიზებულია ამ ბრაუზერში", true);
      message.textContent = force ? "Gmail-იდან DEI ქვითრებს ვკითხულობ…" : "Worker-ში შენახულ ბოლო DEI ქვითარს ვკითხულობ…";
      const result = force ? await syncAllPages(session) : await api("/api/latest", session);
      if (result.bill && result.bill.found) {
        renderBill(result.bill);
        message.textContent = result.cached
          ? "ბოლო ქვითარი უსაფრთხოდ ჩაიტვირთა KV-დან."
          : "Gmail-ის ყველა გვერდი შემოწმებულია. დამუშავებული გვერდები: " + (result.syncPages ?? "—") + ".";
      } else {
        details.hidden = true;
        message.textContent = force
          ? "სინქრონიზაცია დასრულდა, მაგრამ ამ წერილებში ამოსაცნობი DEI ქვითარი ვერ მოიძებნა."
          : "DEI-ის შენახული ქვითარი ჯერ არ არის. დააჭირე სინქრონიზაციას.";
        window.dispatchEvent(new CustomEvent("t1:dei-bill", { detail: null }));
      }
      try {
        await refreshHistory(session);
      } catch (error) {
        historyList.replaceChildren();
        annualSummary.replaceChildren();
        historySummary.textContent = "ისტორია ვერ ჩაიტვირთა: " + error.message;
      }
    }
    clearHistory.addEventListener("click", async () => {
      const session = getSession();
      if (!session) {
        alert("ისტორიის წასაშლელად ჯერ Gmail უნდა დააკავშირო ამ ბრაუზერში.");
        return;
      }
      if (!confirm("ნამდვილად წავშალო საიტზე შენახული DEI ქვითრების ისტორია? Gmail-ის წერილები არ წაიშლება.")) return;
      clearHistory.disabled = true;
      try {
        await api("/api/history/clear", session, { method: "POST", body: {} });
        await refreshHistory(session);
        message.textContent = "საიტზე შენახული ქვითრების ისტორია წაიშალა. Gmail-ის წერილები უცვლელია.";
      } catch (error) {
        message.textContent = "ისტორიის წაშლა ვერ შესრულდა: " + error.message;
      } finally {
        clearHistory.disabled = false;
      }
    });

    connect.addEventListener("click", connectGmail);
    sync.addEventListener("click", async () => {
      sync.disabled = true;
      try { await refresh(true); }
      catch (error) { message.textContent = "სინქრონიზაცია ვერ შესრულდა: " + error.message; setStatus("სინქრონიზაციის შეცდომა", false); }
      finally { sync.disabled = false; }
    });
    signOut.addEventListener("click", () => {
      sessionStorage.removeItem(SESSION_KEY);
      connect.hidden = false;
      refresh(false).catch(error => { message.textContent = error.message; setStatus("სტატუსის შემოწმება ვერ შესრულდა", false); });
    });

    (async () => {
      try {
        await exchangeOAuthCode();
        // Load the already-saved history on page open. Gmail rescans only when the user presses Sync.
        await refresh(false);
      } catch (error) {
        message.textContent = "კავშირის შემოწმება ვერ შესრულდა: " + error.message;
        setStatus("კავშირი ვერ მოწმდება", false);
      }
    })();
  }

  window.DEIBillSync = { mount };
})();