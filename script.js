(function(){
"use strict";
document.documentElement.lang = "id";

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const AR_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[\s\u200C،؛]+[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+)*/g;
const hasAr = s => /[\u0600-\u06FF]/.test(String(s || ""));
const stripHarakat = s => String(s || "").replace(/[\u064B-\u065F\u0670]/g, "").trim();

function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()){
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}
function mixed(el, text){
  el.textContent = "";
  const s = String(text == null ? "" : text);
  let last = 0;
  for (const m of s.matchAll(AR_RE)){
    if (m.index > last) el.append(s.slice(last, m.index));
    const sp = document.createElement("span");
    sp.className = "ar"; sp.lang = "ar"; sp.dir = "rtl"; sp.textContent = m[0];
    el.append(sp);
    last = m.index + m[0].length;
  }
  if (last < s.length) el.append(s.slice(last));
  return el;
}
const ICONS = {
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'
};
function icon(name){
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name];
  return s;
}
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
function shuffle(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
let toastT;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3400); }

/* =========================================================================
   GOOGLE TRANSLATE & GEMINI API HYBRID TRANSLATION ENGINE
   ========================================================================= */
const GoogleTranslateBridge = {
  // Jalur 1: Google Translate Web Endpoint (Client GTX) untuk terjemahan kalimat cepat & real-time
  async fetchGoogleGTX(text, sl, tl){
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("GTX HTTP " + res.status);
    const data = await res.json();
    let translated = "";
    let translit = "";
    if (Array.isArray(data[0])){
      data[0].forEach(seg => {
        if (seg[0]) translated += seg[0];
        if (seg[2]) translit += seg[2];
        else if (seg[3]) translit += seg[3];
      });
    }
    const detectedLang = data[2] || sl;
    if (!translated) throw new Error("Empty GTX result");
    return { translated: translated.trim(), translit: translit.trim(), detectedLang };
  },

  // Jalur 2: Gemini API (gemini-3-flash-preview) untuk memperkaya harakat lengkap, akar kata, & terjemahan akurat
  async fetchGeminiEnrichment(text, dirHint){
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const sysPrompt = "Kamu adalah mesin penerjemah Qamus Arab-Indonesia-Inggris setara Google Translate yang akurat dan akademis. Berikan harakat lengkap pada teks bahasa Arab.";
    const userQuery = `Terjemahkan teks berikut (arah: ${dirHint}). Jika sumbernya Indonesia/Inggris, terjemahkan ke Arab Fusha berharakat lengkap serta beri padanan Inggris/Indonesia. Jika sumbernya Arab, beri harakat lengkap serta terjemahkan ke Indonesia dan Inggris. Sertakan juga analisis kata (jenis kata: Isim/Fi'il/Harf, akar kata, bentuk jamak/tasrif, dan contoh kalimat).
Balas HANYA JSON valid:
{"detected_lang":"Indonesia|Inggris|Arab","arabic":"...","translit":"...","meaning_id":"...","meaning_en":"...","pos":"Isim|Fi'il|Harf|Frasa","root":"akar kata 3 huruf atau -","plural_tasrif":"bentuk jamak atau tasrif mudhari","example_ar":"contoh kalimat Arab berharakat","example_id":"arti contoh kalimat","words":[{"ar":"...","tr":"...","id":"...","en":"..."}],"note":"catatan singkat"}

Teks:
"""${text.slice(0, 2000)}"""`;

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: sysPrompt }] },
      generationConfig: { responseMimeType: "application/json" }
    };

    for (let attempt = 0; attempt < 3; attempt++){
      try{
        const resp = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error("Gemini HTTP " + resp.status);
        const json = await resp.json();
        const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText){
          const parsed = JSON.parse(rawText);
          if (parsed && parsed.arabic) return parsed;
        }
      }catch(e){
        if (attempt < 2) await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
      }
    }
    return null;
  },

  // Gabungan cerdas: Google Translate GTX + Gemini Enrichment + Database Lokal Qamus
  async translate(text, dir = "auto"){
    const clean = text.trim();
    const isAr = hasAr(clean);
    let sl = "auto", tl = "ar";
    if (dir === "ar-id" || dir === "ar-iden" || (dir === "auto" && isAr)){
      sl = isAr ? "ar" : "auto";
      tl = "id";
    } else if (dir === "id-ar"){
      sl = "id"; tl = "ar";
    } else if (dir === "en-ar"){
      sl = "en"; tl = "ar";
    }

    // 1. Cek apakah ada kecocokan persis di database lokal untuk metadata cepat
    const localHit = findExactLocalEntry(clean);

    // 2. Jalankan Google Translate GTX & Gemini secara paralel untuk kecepatan + akurasi harakat
    const gtxPromise = (async () => {
      try{
        if (tl === "ar"){
          const [toAr, toEn] = await Promise.all([
            this.fetchGoogleGTX(clean, sl, "ar"),
            this.fetchGoogleGTX(clean, sl, "en").catch(() => ({ translated: "" }))
          ]);
          return {
            source: "Google Translate",
            detectedLang: toAr.detectedLang === "en" ? "Inggris" : "Indonesia",
            arabic: toAr.translated,
            translit: toAr.translit,
            meaning_id: toAr.detectedLang === "id" ? clean : (await this.fetchGoogleGTX(clean, sl, "id").catch(() => ({ translated: clean }))).translated,
            meaning_en: toAr.detectedLang === "en" ? clean : (toEn.translated || clean)
          };
        } else {
          const [toId, toEn] = await Promise.all([
            this.fetchGoogleGTX(clean, sl, "id"),
            this.fetchGoogleGTX(clean, sl, "en").catch(() => ({ translated: "" }))
          ]);
          return {
            source: "Google Translate",
            detectedLang: "Arab",
            arabic: clean,
            translit: toId.translit,
            meaning_id: toId.translated,
            meaning_en: toEn.translated
          };
        }
      }catch(e){
        return null;
      }
    })();

    const geminiPromise = this.fetchGeminiEnrichment(clean, dir);

    const [gtxRes, gemRes] = await Promise.all([gtxPromise, geminiPromise]);

    if (gemRes){
      return {
        engine: gtxRes ? "Google Translate + Gemini AI" : "Gemini AI Translator",
        lang: gemRes.detected_lang || (gtxRes && gtxRes.detectedLang) || (isAr ? "Arab" : "Indonesia/Inggris"),
        arabic: gemRes.arabic || (gtxRes && gtxRes.arabic) || (localHit && localHit.ar) || clean,
        translit: gemRes.translit || (gtxRes && gtxRes.translit) || (localHit && localHit.tr) || "",
        meaning_id: gemRes.meaning_id || (gtxRes && gtxRes.meaning_id) || (localHit && localHit.id) || "",
        meaning_en: gemRes.meaning_en || (gtxRes && gtxRes.meaning_en) || (localHit && localHit.en) || "",
        pos: gemRes.pos || (localHit && localHit.pos) || "Frasa / Kalimat",
        root: gemRes.root || (localHit && localHit.root) || "-",
        plural_tasrif: gemRes.plural_tasrif || (localHit && localHit.plural) || "-",
        example_ar: gemRes.example_ar || (localHit && localHit.ex) || "",
        example_id: gemRes.example_id || (localHit && localHit.exid) || "",
        words: Array.isArray(gemRes.words) ? gemRes.words : [],
        note: gemRes.note || (gtxRes && gtxRes.arabic && gtxRes.arabic !== gemRes.arabic ? `Versi Google Translate tanpa harakat: ${gtxRes.arabic}` : "")
      };
    }

    if (gtxRes){
      return {
        engine: "Google Translate (Real-Time)",
        lang: gtxRes.detectedLang,
        arabic: localHit ? localHit.ar : gtxRes.arabic,
        translit: gtxRes.translit || (localHit && localHit.tr) || "",
        meaning_id: gtxRes.meaning_id || (localHit && localHit.id) || "",
        meaning_en: gtxRes.meaning_en || (localHit && localHit.en) || "",
        pos: (localHit && localHit.pos) || "Terjemahan Langsung",
        root: (localHit && localHit.root) || "-",
        plural_tasrif: (localHit && localHit.plural) || "-",
        example_ar: (localHit && localHit.ex) || "",
        example_id: (localHit && localHit.exid) || "",
        words: localHit ? [localHit] : [],
        note: "Diterjemahkan langsung melalui layanan Google Translate."
      };
    }

    // 3. Fallback ke Database Lokal Qamus jika offline sepenuhnya
    return localQamusLookup(clean, dir);
  }
};

/* =========================================================================
   SELF-EVOLVING LOCAL AI ENGINE (AI SEDERHANA YANG BERKEMBANG SENDIRI)
   ========================================================================= */
const SelfEvolvingAI = {
  KEY: "mk.self_ai_memory_v2",
  state: {
    learnedVocab: [],
    dialogMemory: [],
    userStats: { turns: 0, commonMistakes: {}, masteredWords: [] },
    lastTopic: "Bebas (apa pun)"
  },
  init(){
    const saved = store.get(this.KEY, null);
    if (saved && typeof saved === "object"){
      this.state = {
        learnedVocab: Array.isArray(saved.learnedVocab) ? saved.learnedVocab : [],
        dialogMemory: Array.isArray(saved.dialogMemory) ? saved.dialogMemory : [],
        userStats: saved.userStats || { turns: 0, commonMistakes: {}, masteredWords: [] },
        lastTopic: saved.lastTopic || "Bebas (apa pun)"
      };
    }
    this.updateBadge();
  },
  save(){
    store.set(this.KEY, this.state);
    this.updateBadge();
    renderLocalDb();
  },
  updateBadge(){
    const el = $("#aiBrainStat");
    if (!el) return;
    const total = this.state.learnedVocab.length + this.state.dialogMemory.length + this.state.userStats.turns;
    el.textContent = `Memori AI Mandiri: ${total} pengetahuan & pola percakapan tersimpan`;
  },
  learnFromExchange(userText, aiReplyObj, topic){
    this.state.userStats.turns += 1;
    const cleanUser = stripHarakat(userText).toLowerCase();
    if (cleanUser && aiReplyObj && aiReplyObj.reply_ar){
      const existing = this.state.dialogMemory.find(m => m.trigger === cleanUser);
      if (existing){
        existing.weight = (existing.weight || 1) + 1;
        existing.reply_ar = aiReplyObj.reply_ar;
        existing.reply_tr = aiReplyObj.reply_translit || existing.reply_tr;
        existing.reply_id = aiReplyObj.reply_id || existing.reply_id;
      } else {
        this.state.dialogMemory.unshift({
          trigger: cleanUser,
          reply_ar: aiReplyObj.reply_ar,
          reply_tr: aiReplyObj.reply_translit || "",
          reply_id: aiReplyObj.reply_id || "",
          topic: topic || "Umum",
          weight: 1
        });
        if (this.state.dialogMemory.length > 80) this.state.dialogMemory.pop();
      }
    }
    if (Array.isArray(aiReplyObj?.corrections)){
      aiReplyObj.corrections.forEach(c => {
        if (c && c.type){
          this.state.userStats.commonMistakes[c.type] = (this.state.userStats.commonMistakes[c.type] || 0) + 1;
        }
      });
    }
    this.save();
  },
  learnVocab(items, topic){
    if (!Array.isArray(items)) return false;
    let added = false;
    items.forEach(item => {
      if (!item || !item.ar) return;
      const key = stripHarakat(item.ar);
      if (!this.state.learnedVocab.some(v => stripHarakat(v.ar) === key)){
        this.state.learnedVocab.unshift({
          ar: item.ar,
          tr: item.tr || "",
          id: item.id || "",
          en: item.en || "",
          pos: item.pos || "Isim",
          root: item.root || "-",
          plural: item.plural || "-",
          ex: item.ex || "",
          exid: item.exid || "",
          topic: topic || "Mandiri"
        });
        added = true;
      }
    });
    if (this.state.learnedVocab.length > 200) this.state.learnedVocab.length = 200;
    this.save();
    return added;
  },
  respondOffline(text, topic, level, src, target){
    const raw = String(text || "").trim();
    const norm = stripHarakat(raw).toLowerCase();
    const corrections = [];

    if (target){
      const tNorm = stripHarakat(target);
      if (norm !== tNorm){
        corrections.push({
          type: src === "voice" ? "lafadz" : "nahwu",
          said: raw,
          correct: target,
          note_id: src === "voice"
            ? "Sepertinya pelafalan beberapa huruf hijaiyah belum persis sama dengan kalimat target. Coba ulangi perlahan sesuai harakat."
            : "Susunan kata atau huruf belum persis sama dengan kalimat target yang diminta."
        });
      }
    }

    if (hasAr(raw)){
      if (/كيف حالك/.test(norm) && /انت/.test(norm) && !/أنت/.test(norm)){
        corrections.push({
          type: "nahwu",
          said: "انت",
          correct: "أَنْتَ / أَنْتِ",
          note_id: "Gunakan hamzah (أ) pada kata ganti kamu (أَنْتَ untuk laki-laki, أَنْتِ untuk perempuan)."
        });
      }
      if (src === "voice"){
        const confusions = [
          { re: /سلات|سلاة/, right: "صَلَاةٌ", note: "Sepertinya huruf ص (Shad) terdengar seperti س (Sin). Tebalkan pangkal lidah saat mengucapkan ص." },
          { re: /كلب/, right: "قَلْبٌ", note: "Hati-hati membedakan ق (Qaf, dari pangkal lidah) dan ك (Kaf). قَلْبٌ = hati, كَلْبٌ = anjing." },
          { re: /حمد لله/, right: "الْحَمْدُ لِلَّهِ", note: "Pastikan huruf ح (Ha pedas dari tengah tenggorokan) terdengar jelas, bukan ه (Ha besar)." }
        ];
        confusions.forEach(cf => {
          if (cf.re.test(norm)){
            corrections.push({ type: "lafadz", said: raw, correct: cf.right, note_id: cf.note });
          }
        });
      }
    } else {
      const qMatch = findExactLocalEntry(norm);
      const suggestedAr = qMatch ? qMatch.ar : "أُرِيدُ أَنْ أَتَحَدَّثَ عَنْ هَذَا الْمَوْضُوعِ";
      const suggestedTr = qMatch ? qMatch.tr : "Urīdu an ataḥaddatsa ‘an hādzā al-mawdhū‘";
      const replyObj = {
        reply_ar: `جَمِيلٌ! بِالْعَرَبِيَّةِ نَقُولُ: «${suggestedAr}». هَلْ يُمْكِنُكَ أَنْ تَقُولَهَا الْآنَ؟`,
        reply_translit: `Jamīl! Bil-‘arabiyyah naqūlu: "${suggestedTr}". Hal yumkinuka an taqūlahā al-ān?`,
        reply_id: `Bagus! Dalam bahasa Arab kita mengucapkannya: "${suggestedAr}" (${suggestedTr}). Bisakah kamu mengucapkannya sekarang?`,
        praise_id: "",
        corrections: [{
          type: "mufradat",
          said: raw,
          correct: suggestedAr,
          note_id: "Biasakan langsung menggunakan kosakata bahasa Arab saat sesi muhadatsah."
        }],
        practice_ar: suggestedAr,
        practice_id: `Ucapkan: ${qMatch ? qMatch.id : "Saya ingin membicarakan topik ini"}`
      };
      this.learnFromExchange(raw, replyObj, topic);
      return replyObj;
    }

    const memHit = this.state.dialogMemory.find(m => norm.includes(m.trigger) || m.trigger.includes(norm));
    if (memHit && norm.length > 3){
      const replyObj = {
        reply_ar: memHit.reply_ar,
        reply_translit: memHit.reply_tr,
        reply_id: memHit.reply_id + " (Respons dari memori AI yang telah dipelajari)",
        praise_id: corrections.length ? "" : "Bagus sekali! Pelafalan dan susunan kalimatmu semakin lancar.",
        corrections,
        practice_ar: level === "beginner" ? "أَنَا سَعِيدٌ جِدًّا بِالتَّحَدُّثِ مَعَكَ." : "أَتَمَنَّى أَنْ نَسْتَمِرَّ فِي تَعَلُّمِ اللُّغَةِ الْعَرَبِيَّةِ كُلَّ يَوْمٍ.",
        practice_id: level === "beginner" ? "Saya sangat senang berbicara denganmu." : "Saya berharap kita terus belajar bahasa Arab setiap hari."
      };
      this.learnFromExchange(raw, replyObj, topic);
      return replyObj;
    }

    const patterns = [
      {
        test: /سلام|مرحبا|اهلا/,
        ar: "وَعَلَيْكُمُ السَّلَامُ وَرَحْمَةُ اللهِ! كَيْفَ حَالُكَ الْيَوْمَ، وَمَا اسْمُكَ؟",
        tr: "Wa ‘alaikumussalām wa raḥmatullāh! Kaifa ḥāluka al-yawm, wa mā ismuka?",
        id: "Wa'alaikumussalam warahmatullah! Apa kabarmu hari ini, dan siapa namamu?",
        prac_ar: "أَنَا بِخَيْرٍ، الْحَمْدُ لِلَّهِ. اسْمِي أَحْمَدُ.",
        prac_id: "Saya baik, alhamdulillah. Nama saya Ahmad."
      },
      {
        test: /بخير|الحمد لله|طيب|سعيد/,
        ar: "الْحَمْدُ لِلَّهِ دَائِمًا! مِنْ أَيْنَ أَنْتَ، وَمَاذَا تَعْمَلُ أَوْ تَدْرُسُ؟",
        tr: "Al-ḥamdulillāhi dā'iman! Min aina anta, wa mādzā ta‘malu aw tadrusu?",
        id: "Alhamdulillah selalu! Dari mana asalmu, dan apa pekerjaan atau studimu?",
        prac_ar: "أَنَا مِنْ إِنْدُونِيسِيَا، وَأَنَا طَالِبٌ فِي الْجَامِعَةِ.",
        prac_id: "Saya dari Indonesia, dan saya mahasiswa di universitas."
      },
      {
        test: /اسمي|انا من|اندونيسيا|طالب|معلم/,
        ar: "تَشَرَّفْنَا بِمَعْرِفَتِكَ! مَا هِيَ هِوَايَتُكَ الْمُفَضَّلَةُ فِي أَوْقَاتِ الْفَرَاغِ؟",
        tr: "Tasyarrafnā bima‘rifatika! Mā hiya hiwāyatuka al-mufadhdhalatu fī awqāti al-farāgh?",
        id: "Senang berkenalan denganmu! Apa hobi favoritmu di waktu luang?",
        prac_ar: "هِوَايَتِي قِرَاءَةُ الْكُتُبِ وَتَعَلُّمُ اللُّغَةِ الْعَرَبِيَّةِ.",
        prac_id: "Hobiku membaca buku dan belajar bahasa Arab."
      },
      {
        test: /مسجد|صلاة|قران|دين/,
        ar: "مَا شَاءَ اللهُ! هَلْ تُصَلِّي الصَّلَوَاتِ الْخَمْسَ فِي الْمَسْجِدِ قُرْبَ بَيْتِكَ؟",
        tr: "Mā syā'allāh! Hal tushallī ash-shalawāti al-khamsa fī al-masjidi qurba baitika?",
        id: "Masya Allah! Apakah kamu salat lima waktu di masjid dekat rumahmu?",
        prac_ar: "نَعَمْ، أَذْهَبُ إِلَى الْمَسْجِدِ كُلَّ يَوْمٍ مَعَ أُسْرَتِي.",
        prac_id: "Ya, saya pergi ke masjid setiap hari bersama keluargaku."
      },
      {
        test: /اسرة|ابي|امي|اخي|اختي|عائلة/,
        ar: "حَفِظَ اللهُ أُسْرَتَكَ! كَمْ عَدَدُ أَفْرَادِ أُسْرَتِكَ؟",
        tr: "Ḥafizhahullāhu usrataka! Kam ‘adadu afrādi usratika?",
        id: "Semoga Allah menjaga keluargamu! Berapa jumlah anggota keluargamu?",
        prac_ar: "تَتَكَوَّنُ أُسْرَتِي مِنْ خَمْسَةِ أَفْرَادٍ.",
        prac_id: "Keluargaku terdiri dari lima orang."
      },
      {
        test: /سوق|شراء|طعام|فاكهة|خضار/,
        ar: "مَاذَا تَشْتَرِي عَادَةً عِنْدَمَا تَذْهَبُ إِلَى السُّوقِ؟",
        tr: "Mādzā tasytarī ‘ādatan ‘indamā tadzhabu ilā as-sūq?",
        id: "Apa yang biasanya kamu beli ketika pergi ke pasar?",
        prac_ar: "أَشْتَرِي الْفَوَاكِهَ الطَّازَجَةَ وَالْخُضْرَوَاتِ.",
        prac_id: "Saya membeli buah-buahan segar dan sayuran."
      },
      {
        test: /شكرا|جزاك/,
        ar: "عَفْوًا، وَإِيَّاكُمْ! هَلْ لَدَيْكَ سُؤَالٌ آخَرُ أَوْ نَنْتَقِلُ إِلَى فِكْرَةٍ جَدِيدَةٍ؟",
        tr: "‘Afwan, wa iyyākum! Hal ladaika su'ālun ākharu aw nantaqilu ilā fikratin jadīdah?",
        id: "Sama-sama! Apakah kamu punya pertanyaan lain atau kita beralih ke ide baru?",
        prac_ar: "نَعَمْ، أُرِيدُ أَنْ أَتَعَلَّمَ مُفْرَدَاتٍ جَدِيدَةً الْيَوْمَ.",
        prac_id: "Ya, saya ingin belajar kosakata baru hari ini."
      }
    ];

    const matched = patterns.find(p => p.test.test(norm));
    const topicPool = this.state.learnedVocab.filter(v => v.topic.toLowerCase() === topic.toLowerCase());
    const extraVocab = topicPool[0] || VOCAB[Math.floor(Math.random() * VOCAB.length)];

    let replyObj;
    if (matched){
      replyObj = {
        reply_ar: matched.ar,
        reply_translit: matched.tr,
        reply_id: matched.id,
        praise_id: corrections.length ? "" : "Mumtaz! Kalimat bahasa Arabmu sudah dipahami dengan baik.",
        corrections,
        practice_ar: matched.prac_ar,
        practice_id: matched.prac_id
      };
    } else {
      const topLabel = topic && topic !== "Bebas (apa pun)" ? topic : "حَيَاتِنَا الْيَوْمِيَّةِ";
      replyObj = {
        reply_ar: `فِكْرَةٌ رَائِعَةٌ! كَلَامُكَ وَاضِحٌ. هَلْ يُمْكِنُكَ أَنْ تَشْرَحَ لِي أَكْثَرَ عَنْ ${extraVocab.ar}؟`,
        reply_translit: `Fikratun rā'i‘ah! Kalāmuka wādhiḥ. Hal yumkinuka an tasyraḥa lī aktsara ‘an ${extraVocab.tr}?`,
        reply_id: `Ide yang bagus! Ucapanmu jelas. Bisakah kamu jelaskan lebih lanjut kepadaku tentang "${extraVocab.id}" (${topLabel})?`,
        praise_id: corrections.length ? "" : "Bagus! Terus berlatih merangkai kalimat dalam bahasa Arab.",
        corrections,
        practice_ar: extraVocab.ex || `أَنَا أُحِبُّ ${extraVocab.ar} كَثِيرًا.`,
        practice_id: extraVocab.exid || `Saya sangat menyukai ${extraVocab.id}.`
      };
    }

    this.learnFromExchange(raw, replyObj, topic);
    return replyObj;
  }
};

/* ---------- speech out ---------- */
function say(text){
  try{
    if (!("speechSynthesis" in window)) throw new Error("none");
    const syn = window.speechSynthesis; syn.cancel();
    const voices = syn.getVoices();
    const av = voices.find(v => /^ar/i.test(v.lang));
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "ar-SA"; u.rate = .85;
    if (av) u.voice = av;
    syn.speak(u);
  }catch(e){ toast("Pembacaan suara tidak tersedia di peramban ini."); }
}
function copyText(text, node){
  const fallback = () => {
    try{
      if (node){
        const r = document.createRange(); r.selectNodeContents(node);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      toast("Teks dipilih. Salin dengan Ctrl+C.");
    }catch(e){}
  };
  try{
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(() => toast("Tersalin ke papan klip."), fallback);
    } else fallback();
  }catch(e){ fallback(); }
}

/* ---------- navigation ---------- */
const PAGES = ["beranda", "qamus", "mualam", "muhadatsah"];
function route(){
  const id = (location.hash || "").slice(1);
  const cur = PAGES.includes(id) ? id : "beranda";
  PAGES.forEach(p => { const el = $("#p-" + p); if (el) el.hidden = p !== cur; });
  $$("[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === cur));
  closeDrawer();
  try{ window.scrollTo(0, 0); }catch(e){}
}
function go(id){ if (location.hash !== "#" + id) location.hash = id; route(); }
window.addEventListener("hashchange", route);

const drawer = $("#drawer"), scrim = $("#scrim"), menuBtn = $("#menuBtn");
function openDrawer(){
  drawer.removeAttribute("inert"); drawer.classList.add("open"); scrim.classList.add("show");
  menuBtn.setAttribute("aria-expanded", "true");
  const first = $(".nav-item", drawer); if (first) first.focus();
}
function closeDrawer(){
  if (!drawer.classList.contains("open")) return;
  drawer.classList.remove("open"); scrim.classList.remove("show");
  drawer.setAttribute("inert", ""); menuBtn.setAttribute("aria-expanded", "false");
}
menuBtn.addEventListener("click", openDrawer);
$("#drawerClose").addEventListener("click", () => { closeDrawer(); menuBtn.focus(); });
scrim.addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer.classList.contains("open")){ closeDrawer(); menuBtn.focus(); } });
$$("[data-nav]").forEach(b => b.addEventListener("click", () => go(b.dataset.nav)));
$$("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
$("#qamusBtn").addEventListener("click", () => {
  if (location.hash === "#qamus") openQamus();
  else go("qamus");
});

/* ---------- VIRTUAL ARABIC KEYBOARD ---------- */
const VK_ROWS = [
  ["َ","ُ","ِ","ً","ٌ","ٍ","ْ","ّ","ـ"],
  ["ض","ص","ث","ق","ف","غ","ع","ه","خ","ح","ج","د"],
  ["ش","س","ي","ب","ل","ا","ت","ن","م","ك","ط"],
  ["ئ","ء","ؤ","ر","لا","ى","ة","و","ز","ظ","ذ"],
  ["أ","إ","آ","؟","،","؛"]
];
function buildVirtualKeyboard(container, targetInput){
  container.replaceChildren();
  VK_ROWS.forEach((row, rIdx) => {
    const rowEl = h("div", {class: "vk-row"});
    row.forEach(ch => {
      const btn = h("button", {
        type: "button",
        class: "vk-key" + (rIdx === 0 ? " harakat" : ""),
        onclick: () => {
          const start = targetInput.selectionStart ?? targetInput.value.length;
          const end = targetInput.selectionEnd ?? targetInput.value.length;
          const val = targetInput.value;
          targetInput.value = val.slice(0, start) + ch + val.slice(end);
          targetInput.focus();
          targetInput.setSelectionRange(start + ch.length, start + ch.length);
          targetInput.dispatchEvent(new Event("input"));
        }
      }, rIdx === 0 && ch !== "ـ" ? "ـ" + ch : ch);
      rowEl.append(btn);
    });
    if (rIdx === VK_ROWS.length - 1){
      rowEl.append(
        h("button", {type: "button", class: "vk-key wide", onclick: () => {
          const start = targetInput.selectionStart ?? targetInput.value.length;
          const end = targetInput.selectionEnd ?? targetInput.value.length;
          targetInput.value = targetInput.value.slice(0, start) + " " + targetInput.value.slice(end);
          targetInput.focus();
          targetInput.setSelectionRange(start + 1, start + 1);
        }}, "Spasi"),
        h("button", {type: "button", class: "vk-key wide", onclick: () => {
          const start = targetInput.selectionStart ?? targetInput.value.length;
          const end = targetInput.selectionEnd ?? targetInput.value.length;
          if (start !== end){
            targetInput.value = targetInput.value.slice(0, start) + targetInput.value.slice(end);
            targetInput.setSelectionRange(start, start);
          } else if (start > 0){
            targetInput.value = targetInput.value.slice(0, start - 1) + targetInput.value.slice(start);
            targetInput.setSelectionRange(start - 1, start - 1);
          }
          targetInput.focus();
        }}, "⌫ Hapus")
      );
    }
    container.append(rowEl);
  });
}

/* ---------- BERANDA: kosakata ---------- */
const VOCAB = [
  {t:"islami", ar:"صَلَاةٌ", tr:"shalātun", id:"salat", en:"prayer", pos:"Isim", root:"ص-ل-و", plural:"صَلَوَاتٌ", ex:"أُصَلِّي الظُّهْرَ فِي الْمَسْجِدِ.", exid:"Saya salat Zuhur di masjid."},
  {t:"islami", ar:"مَسْجِدٌ", tr:"masjidun", id:"masjid", en:"mosque", pos:"Isim", root:"س-ج-د", plural:"مَسَاجِدُ", ex:"الْمَسْجِدُ قَرِيبٌ مِنْ بَيْتِي.", exid:"Masjid dekat dari rumahku."},
  {t:"islami", ar:"قُرْآنٌ", tr:"qur'ānun", id:"Al-Qur'an", en:"Quran", pos:"Isim", root:"ق-ر-أ", plural:"-", ex:"أَقْرَأُ الْقُرْآنَ كُلَّ يَوْمٍ.", exid:"Saya membaca Al-Qur'an setiap hari."},
  {t:"islami", ar:"صِيَامٌ", tr:"shiyāmun", id:"puasa", en:"fasting", pos:"Isim", root:"ص-و-م", plural:"-", ex:"الصِّيَامُ فِي رَمَضَانَ وَاجِبٌ.", exid:"Puasa di bulan Ramadan itu wajib."},
  {t:"islami", ar:"زَكَاةٌ", tr:"zakātun", id:"zakat", en:"alms", pos:"Isim", root:"ز-ك-و", plural:"زَكَوَاتٌ", ex:"أُؤَدِّي الزَّكَاةَ كُلَّ سَنَةٍ.", exid:"Saya menunaikan zakat setiap tahun."},
  {t:"islami", ar:"حَجٌّ", tr:"hajjun", id:"haji", en:"pilgrimage", pos:"Isim", root:"ح-ج-ج", plural:"حِجَجٌ", ex:"ذَهَبَ جَدِّي إِلَى مَكَّةَ لِلْحَجِّ.", exid:"Kakekku pergi ke Mekah untuk berhaji."},
  {t:"islami", ar:"دُعَاءٌ", tr:"du'ā'un", id:"doa", en:"supplication", pos:"Isim", root:"د-ع-و", plural:"أَدْعِيَةٌ", ex:"أَدْعُو اللهَ بَعْدَ الصَّلَاةِ.", exid:"Saya berdoa kepada Allah setelah salat."},
  {t:"islami", ar:"وُضُوءٌ", tr:"wudhū'un", id:"wudu", en:"ablution", pos:"Isim", root:"و-ض-أ", plural:"-", ex:"أَتَوَضَّأُ قَبْلَ الصَّلَاةِ.", exid:"Saya berwudu sebelum salat."},
  {t:"islami", ar:"إِيمَانٌ", tr:"īmānun", id:"iman", en:"faith", pos:"Isim", root:"أ-م-ن", plural:"-", ex:"الْإِيمَانُ نُورٌ فِي الْقَلْبِ.", exid:"Iman adalah cahaya di dalam hati."},
  {t:"islami", ar:"صَدَقَةٌ", tr:"shadaqatun", id:"sedekah", en:"charity", pos:"Isim", root:"ص-د-ق", plural:"صَدَقَاتٌ", ex:"أُعْطِي الْفَقِيرَ صَدَقَةً.", exid:"Saya memberi sedekah kepada orang miskin."},
  {t:"islami", ar:"صَبْرٌ", tr:"shabrun", id:"sabar", en:"patience", pos:"Isim", root:"ص-ب-ر", plural:"-", ex:"الصَّبْرُ مِفْتَاحُ الْفَرَجِ.", exid:"Sabar adalah kunci kelapangan."},
  {t:"islami", ar:"شُكْرٌ", tr:"syukrun", id:"syukur", en:"gratitude", pos:"Isim", root:"ش-ك-ر", plural:"-", ex:"أَشْكُرُ اللهَ عَلَى نِعَمِهِ.", exid:"Saya bersyukur kepada Allah atas nikmat-Nya."},
  {t:"islami", ar:"أَذَانٌ", tr:"adzānun", id:"azan", en:"call to prayer", pos:"Isim", root:"أ-ذ-ن", plural:"-", ex:"أَسْمَعُ الْأَذَانَ مِنَ الْمَسْجِدِ.", exid:"Saya mendengar azan dari masjid."},
  {t:"islami", ar:"تَوْبَةٌ", tr:"taubatun", id:"tobat", en:"repentance", pos:"Isim", root:"ت-و-ب", plural:"-", ex:"التَّوْبَةُ تَمْحُو الذُّنُوبَ.", exid:"Tobat menghapus dosa-dosa."},
  {t:"sosial", ar:"أُسْرَةٌ", tr:"usratun", id:"keluarga", en:"family", pos:"Isim", root:"أ-س-ر", plural:"أُسَرٌ", ex:"أُسْرَتِي كَبِيرَةٌ.", exid:"Keluargaku besar."},
  {t:"sosial", ar:"جَارٌ", tr:"jārun", id:"tetangga", en:"neighbor", pos:"Isim", root:"ج-و-ر", plural:"جِيرَانٌ", ex:"جَارِي طَيِّبٌ.", exid:"Tetanggaku baik hati."},
  {t:"sosial", ar:"صَدِيقٌ", tr:"shadīqun", id:"teman", en:"friend", pos:"Isim", root:"ص-د-ق", plural:"أَصْدِقَاءُ", ex:"صَدِيقِي يُسَاعِدُنِي.", exid:"Temanku membantuku."},
  {t:"sosial", ar:"مُجْتَمَعٌ", tr:"mujtama'un", id:"masyarakat", en:"society", pos:"Isim", root:"ج-م-ع", plural:"مُجْتَمَعَاتٌ", ex:"نَعِيشُ فِي مُجْتَمَعٍ مُتَعَاوِنٍ.", exid:"Kami hidup dalam masyarakat yang saling membantu."},
  {t:"sosial", ar:"تَعَاوُنٌ", tr:"ta'āwunun", id:"gotong royong", en:"cooperation", pos:"Isim", root:"ع-و-ن", plural:"-", ex:"التَّعَاوُنُ يَجْمَعُ النَّاسَ.", exid:"Gotong royong mempersatukan orang."},
  {t:"sosial", ar:"مَدْرَسَةٌ", tr:"madrasatun", id:"sekolah", en:"school", pos:"Isim", root:"د-ر-س", plural:"مَدَارِسُ", ex:"أَذْهَبُ إِلَى الْمَدْرَسَةِ صَبَاحًا.", exid:"Saya pergi ke sekolah pada pagi hari."},
  {t:"sosial", ar:"سُوقٌ", tr:"sūqun", id:"pasar", en:"market", pos:"Isim", root:"س-و-ق", plural:"أَسْوَاقٌ", ex:"أَشْتَرِي الْخُضَارَ مِنَ السُّوقِ.", exid:"Saya membeli sayuran dari pasar."},
  {t:"sosial", ar:"عَمَلٌ", tr:"'amalun", id:"pekerjaan", en:"work", pos:"Isim", root:"ع-م-ل", plural:"أَعْمَالٌ", ex:"أَبِي يُحِبُّ عَمَلَهُ.", exid:"Ayahku menyukai pekerjaannya."},
  {t:"sosial", ar:"زِيَارَةٌ", tr:"ziyāratun", id:"kunjungan", en:"visit", pos:"Isim", root:"ز-و-ر", plural:"زِيَارَاتٌ", ex:"زُرْتُ جَدَّتِي أَمْسِ.", exid:"Aku mengunjungi nenekku kemarin."},
  {t:"sosial", ar:"ضَيْفٌ", tr:"dhaifun", id:"tamu", en:"guest", pos:"Isim", root:"ض-ي-ف", plural:"ضُيُوفٌ", ex:"نُكْرِمُ الضَّيْفَ.", exid:"Kami memuliakan tamu."},
  {t:"sosial", ar:"احْتِرَامٌ", tr:"ihtirāmun", id:"rasa hormat", en:"respect", pos:"Isim", root:"ح-ر-م", plural:"-", ex:"أَحْتَرِمُ مُعَلِّمِي.", exid:"Saya menghormati guruku."},
  {t:"sosial", ar:"صِدْقٌ", tr:"shidqun", id:"kejujuran", en:"honesty", pos:"Isim", root:"ص-د-ق", plural:"-", ex:"أُحِبُّ الصِّدْقَ فِي الْكَلَامِ.", exid:"Saya menyukai kejujuran dalam berbicara."},
  {t:"sosial", ar:"صِحَّةٌ", tr:"shihhatun", id:"kesehatan", en:"health", pos:"Isim", root:"ص-ح-ح", plural:"-", ex:"أُحَافِظُ عَلَى صِحَّتِي.", exid:"Saya menjaga kesehatanku."},
  {t:"sosial", ar:"مُسَاعَدَةٌ", tr:"musā'adatun", id:"bantuan", en:"help", pos:"Isim", root:"س-ع-د", plural:"مُسَاعَدَاتٌ", ex:"أَطْلُبُ الْمُسَاعَدَةَ مِنْ أَخِي.", exid:"Saya meminta bantuan dari kakak/adikku."}
];
function wordCard(w, tag){
  return h("article", {class: "word"},
    h("div", {class: "word-top"},
      tag ? h("span", {class: "tag " + tag.k}, tag.t) : h("span"),
      h("div", {style: "display:flex;gap:4px"},
        h("button", {class: "icon-btn", type: "button", title: "Simpan ke Favorit", onclick: () => toggleFavorite(w)}, "★"),
        h("button", {class: "icon-btn", type: "button", "aria-label": "Dengarkan kata " + (w.id || ""), onclick: () => say(w.ar)}, icon("speaker")))),
    h("p", {class: "ar word-ar", lang: "ar", dir: "rtl"}, w.ar),
    h("p", {class: "tr"}, w.tr || ""),
    h("p", {class: "mean"}, w.id || ""),
    (w.pos || w.root) ? h("p", {class: "exid", style: "font-size:.82rem"}, `${w.pos || ""} ${w.root && w.root !== "-" ? "• Akar: " + w.root : ""} ${w.plural && w.plural !== "-" ? "• Jamak/Tasrif: " + w.plural : ""}`) : null,
    w.ex ? h("div", {class: "ex"},
      h("div", {class: "ai-row"},
        h("p", {class: "ar", lang: "ar", dir: "rtl", style: "flex:1"}, w.ex),
        h("button", {class: "icon-btn", type: "button", "aria-label": "Dengarkan contoh kalimat", onclick: () => say(w.ex)}, icon("speaker"))),
      h("p", {class: "exid"}, w.exid || "")) : null
  );
}
function renderVocab(f){
  const g = $("#vocabGrid"); g.replaceChildren();
  VOCAB.filter(w => f === "all" || w.t === f).forEach(w => g.append(wordCard(w, {k: w.t, t: w.t === "islami" ? "Islami" : "Sosial"})));
}
$$("#vocabFilter .chip").forEach(b => b.addEventListener("click", () => {
  $$("#vocabFilter .chip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderVocab(b.dataset.f);
}));
renderVocab("all");

const LOCAL_TOPICS = {
  kesehatan: [
    {ar:"صِحَّةٌ", tr:"shihhatun", id:"kesehatan", en:"health", pos:"Isim", root:"ص-ح-ح", ex:"الصِّحَّةُ تَاجٌ عَلَى رُؤُوسِ الْأَصِحَّاءِ.", exid:"Kesehatan adalah mahkota di atas kepala orang-orang sehat."},
    {ar:"طَبِيبٌ", tr:"thabībun", id:"dokter", en:"doctor", pos:"Isim", root:"ط-ب-ب", plural:"أَطِبَّاءُ", ex:"يَفْحَصُ الطَّبِيبُ الْمَرِيضَ.", exid:"Dokter memeriksa pasien."},
    {ar:"مُسْتَشْفَى", tr:"mustasyfā", id:"rumah sakit", en:"hospital", pos:"Isim", root:"ش-ف-ي", plural:"مُسْتَشْفَيَاتٌ", ex:"ذَهَبَ أَخِي إِلَى الْمُسْتَشْفَى.", exid:"Saudaraku pergi ke rumah sakit."},
    {ar:"دَوَاءٌ", tr:"dawā'un", id:"obat", en:"medicine", pos:"Isim", root:"د-و-ي", plural:"أَدْوِيَةٌ", ex:"أَتَنَاوَلُ الدَّوَاءَ بَعْدَ الْأَكْلِ.", exid:"Saya minum obat setelah makan."},
    {ar:"رِيَاضَةٌ", tr:"riyādhatun", id:"olahraga", en:"sport", pos:"Isim", root:"ر-و-ض", ex:"الرِّيَاضَةُ مُفِيدَةٌ لِلْجِسْمِ.", exid:"Olahraga bermanfaat bagi tubuh."},
    {ar:"غِذَاءٌ", tr:"ghidzā'un", id:"nutrisi / makanan", en:"nutrition", pos:"Isim", root:"غ-ذ-و", ex:"نَحْتَاجُ إِلَى غِذَاءٍ صِحِّيٍّ.", exid:"Kita membutuhkan makanan sehat."},
    {ar:"نَوْمٌ", tr:"nawmun", id:"tidur", en:"sleep", pos:"Isim", root:"ن-و-م", ex:"النَّوْمُ الْمُبَكِّرُ يُرِيحُ الْبَدَنَ.", exid:"Tidur lebih awal mengistirahatkan tubuh."},
    {ar:"نَظَافَةٌ", tr:"nazhāfatun", id:"kebersihan", en:"cleanliness", pos:"Isim", root:"ن-ظ-ف", ex:"النَّظَافَةُ مِنَ الْإِيمَانِ.", exid:"Kebersihan adalah sebagian dari iman."}
  ],
  teknologi: [
    {ar:"حَاسُوبٌ", tr:"ḥāsūbun", id:"komputer", en:"computer", pos:"Isim", root:"ح-س-ب", plural:"حَوَاسِيبُ", ex:"أَسْتَخْدِمُ الْحَاسُوبَ لِلْعَمَلِ.", exid:"Saya menggunakan komputer untuk bekerja."},
    {ar:"هَاتِفٌ ذَكِيٌّ", tr:"hātifun dzakiyyun", id:"ponsel pintar", en:"smartphone", pos:"Isim", root:"ه-ت-ف", ex:"الْهَاتِفُ الذَّكِيُّ مُفِيدٌ لِلتَّعَلُّمِ.", exid:"Ponsel pintar bermanfaat untuk belajar."},
    {ar:"إِنْتَرْنِت", tr:"intarnit", id:"internet", en:"internet", pos:"Isim", root:"-", ex:"نَبْحَثُ عَنِ الْمَعْلُومَاتِ فِي الْإِنْتَرْنِت.", exid:"Kami mencari informasi di internet."},
    {ar:"بَرْمَجَةٌ", tr:"barmajatun", id:"pemrograman", en:"programming", pos:"Isim", root:"ب-ر-م-ج", ex:"أَتَعَلَّمُ لُغَةَ الْبَرْمَجَةِ.", exid:"Saya belajar bahasa pemrograman."},
    {ar:"ذَكَاءٌ اصْطِنَاعِيٌّ", tr:"dzakā'un ishthinā‘iyyun", id:"kecerdasan buatan", en:"artificial intelligence", pos:"Isim", root:"ذ-ك-و", ex:"الذَّكَاءُ الِاصْطِنَاعِيُّ يُسَاعِدُ النَّاسَ.", exid:"Kecerdasan buatan membantu manusia."},
    {ar:"تَطْبِيقٌ", tr:"tathbīqun", id:"aplikasi", en:"application", pos:"Isim", root:"ط-ب-ق", plural:"تَطْبِيقَاتٌ", ex:"هَذَا تَطْبِيقٌ لِتَعَلُّمِ الْعَرَبِيَّةِ.", exid:"Ini adalah aplikasi untuk belajar bahasa Arab."},
    {ar:"بَيَانَاتٌ", tr:"bayānātun", id:"data", en:"data", pos:"Isim", root:"ب-ي-ن", ex:"نَحْفَظُ الْبَيَانَاتِ بِأَمَانٍ.", exid:"Kami menyimpan data dengan aman."},
    {ar:"شَبَكَةٌ", tr:"syabakatun", id:"jaringan", en:"network", pos:"Isim", root:"ش-ب-ك", plural:"شَبَكَاتٌ", ex:"الشَّبَكَةُ سَرِيعَةٌ الْيَوْمَ.", exid:"Jaringannya cepat hari ini."}
  ],
  perjalanan: [
    {ar:"سَفَرٌ", tr:"safarun", id:"perjalanan", en:"travel", pos:"Isim", root:"س-ف-ر", plural:"أَسْفَارٌ", ex:"السَّفَرُ يَزِيدُ الْخِبْرَةَ.", exid:"Perjalanan menambah pengalaman."},
    {ar:"مَطَارٌ", tr:"mathārun", id:"bandara", en:"airport", pos:"Isim", root:"ط-ي-ر", plural:"مَطَارَاتٌ", ex:"وَصَلْنَا إِلَى الْمَطَارِ مُبَكِّرًا.", exid:"Kami tiba di bandara lebih awal."},
    {ar:"طَائِرَةٌ", tr:"thā'iratun", id:"pesawat", en:"airplane", pos:"Isim", root:"ط-ي-ر", plural:"طَائِرَاتٌ", ex:"سَافَرْتُ بِالطَّائِرَةِ إِلَى جَاكَرْتَا.", exid:"Saya bepergian dengan pesawat ke Jakarta."},
    {ar:"جَوَازُ السَّفَرِ", tr:"jawāzu as-safar", id:"paspor", en:"passport", pos:"Isim", root:"ج-و-ز", ex:"أُجَهِّزُ جَوَازَ السَّفَرِ قَبْلَ الرِّحْلَةِ.", exid:"Saya menyiapkan paspor sebelum perjalanan."},
    {ar:"فُنْدُقٌ", tr:"funduqun", id:"hotel", en:"hotel", pos:"Isim", root:"ف-ن-د-ق", plural:"فَنَادِقُ", ex:"نَزَلْنَا فِي فُنْدُقٍ جَمِيلٍ.", exid:"Kami menginap di hotel yang bagus."},
    {ar:"تَذْكِرَةٌ", tr:"tadzkiratun", id:"tiket", en:"ticket", pos:"Isim", root:"ذ-ك-ر", plural:"تَذَاكِرُ", ex:"اِشْتَرَيْتُ تَذْكِرَةَ السَّفَرِ.", exid:"Saya membeli tiket perjalanan."},
    {ar:"حَقِيبَةٌ", tr:"ḥaqībatun", id:"koper / tas", en:"suitcase", pos:"Isim", root:"ح-ق-ب", plural:"حَقَائِبُ", ex:"حَقِيبَتِي ثَقِيلَةٌ جِدًّا.", exid:"Koperku sangat berat."},
    {ar:"خَرِيطَةٌ", tr:"kharīthatun", id:"peta", en:"map", pos:"Isim", root:"خ-ر-ط", plural:"خَرَائِطُ", ex:"نَنْظُرُ إِلَى الْخَرِيطَةِ لِمَعْرِفَةِ الطَّرِيقِ.", exid:"Kami melihat peta untuk mengetahui jalan."}
  ]
};

async function makeTopic(topic){
  topic = String(topic || "").trim();
  const st = $("#topicStatus"), btn = $("#topicBtn");
  if (!topic){ st.className = "status err"; st.textContent = "Tulis topik terlebih dahulu."; return; }
  st.className = "status"; st.textContent = "AI sedang menyusun kosakata…"; btn.disabled = true;

  const low = topic.toLowerCase();
  let list = LOCAL_TOPICS[low] || Object.entries(LOCAL_TOPICS).find(([k]) => low.includes(k) || k.includes(low))?.[1];
  if (!list){
    const trRes = await GoogleTranslateBridge.translate(topic, "id-ar");
    list = [
      {ar: trRes.arabic, tr: trRes.translit, id: topic, en: trRes.meaning_en, pos: trRes.pos, root: trRes.root, ex: trRes.example_ar, exid: trRes.example_id},
      ...shuffle(VOCAB).slice(0, 7)
    ];
  }
  const g = $("#topicGrid"); g.replaceChildren();
  list.forEach(w => g.append(wordCard(w, {k: "ai", t: topic.slice(0, 24)})));
  SelfEvolvingAI.learnVocab(list, topic);
  st.textContent = list.length + " kosakata untuk topik “" + topic + "” siap dipelajari.";
  btn.disabled = false;
}
$("#topicForm").addEventListener("submit", e => { e.preventDefault(); makeTopic($("#topicIn").value); });
$$("#topicChips .chip").forEach(b => b.addEventListener("click", () => { $("#topicIn").value = b.textContent; makeTopic(b.textContent); }));

/* ---------- QAMUS DATABASE & GOOGLE TRANSLATE ENGINE ---------- */
const QAMUS_DICT = [
  {id:"selamat pagi", en:"good morning", ar:"صَبَاحُ الْخَيْرِ", tr:"shabāḥul khair", pos:"Harf / Ungkapan", root:"ص-ب-ح", plural:"-", ex:"صَبَاحُ الْخَيْرِ يَا أُسْتَاذُ.", exid:"Selamat pagi wahai guru.", note:"Dijawab dengan صَبَاحُ النُّورِ (shabāḥun nūr)."},
  {id:"selamat sore", en:"good evening", ar:"مَسَاءُ الْخَيْرِ", tr:"masā'ul khair", pos:"Harf / Ungkapan", root:"م-س-و", plural:"-", ex:"مَسَاءُ الْخَيْرِ يَا صَدِيقِي.", exid:"Selamat sore wahai temanku.", note:"Dijawab dengan مَسَاءُ النُّورِ (masā'un nūr)."},
  {id:"terima kasih", en:"thank you", ar:"شُكْرًا جَزِيلًا", tr:"syukran jazīlan", pos:"Isim", root:"ش-ك-ر", plural:"-", ex:"شُكْرًا جَزِيلًا عَلَى مُسَاعَدَتِكَ.", exid:"Terima kasih banyak atas bantuanmu.", note:"Bisa dijawab dengan عَفْوًا (‘afwan) atau وَإِيَّاكُمْ."},
  {id:"sama-sama", en:"you're welcome", ar:"عَفْوًا", tr:"‘afwan", pos:"Isim", root:"ع-ف-و", plural:"-", ex:"عَفْوًا، هَذَا وَاجِبِي.", exid:"Sama-sama, ini kewajibanku.", note:"Juga bermakna 'permisi' atau 'maaf'."},
  {id:"maaf", en:"sorry", ar:"أَعْتَذِرُ", tr:"a‘tadziru", pos:"Fi'il", root:"ع-ذ-ر", plural:"اِعْتَذَرَ - يَعْتَذِرُ", ex:"أَعْتَذِرُ عَنْ تَأَخُّرِي.", exid:"Saya mohon maaf atas keterlambatan saya.", note:"Bentuk isim: آسِفٌ (laki-laki) / آسِفَةٌ (perempuan)."},
  {id:"apa kabar", en:"how are you", ar:"كَيْفَ حَالُكَ؟", tr:"kaifa ḥāluka?", pos:"Harf / Ungkapan", root:"ح-و-ل", plural:"-", ex:"السَّلَامُ عَلَيْكُمْ، كَيْفَ حَالُكَ؟", exid:"Assalamu'alaikum, apa kabarmu?", note:"Untuk perempuan: كَيْفَ حَالُكِ؟ (kaifa ḥāluki?)."},
  {id:"saya baik", en:"i am fine", ar:"أَنَا بِخَيْرٍ، الْحَمْدُ لِلَّهِ", tr:"anā bikhairin, al-ḥamdulillāh", pos:"Harf / Ungkapan", root:"خ-ي-ر", plural:"-", ex:"أَنَا بِخَيْرٍ، الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ.", exid:"Saya baik, segala puji bagi Allah Tuhan semesta alam.", note:"Ungkapan syukur saat ditanya kabar."},
  {id:"menulis", en:"write", ar:"يَكْتُبُ", tr:"yaktubu", pos:"Fi'il", root:"ك-ت-ب", plural:"كَتَبَ - يَكْتُبُ - اُكْتُبْ", ex:"يَكْتُبُ الطَّالِبُ الدَّرْسَ فِي الدَّفْتَرِ.", exid:"Siswa itu menulis pelajaran di buku tulis.", note:"Fi'il madhi: كَتَبَ (telah menulis)."},
  {id:"membaca", en:"read", ar:"يَقْرَأُ", tr:"yaqra'u", pos:"Fi'il", root:"ق-ر-أ", plural:"قَرَأَ - يَقْرَأُ - اِقْرَأْ", ex:"أَقْرَأُ الْكِتَابَ فِي الْمَكْتَبَةِ.", exid:"Saya membaca buku di perpustakaan.", note:"Fi'il madhi: قَرَأَ (telah membaca)."},
  {id:"pergi", en:"go", ar:"يَذْهَبُ", tr:"yadzhabu", pos:"Fi'il", root:"ذ-ه-ب", plural:"ذَهَبَ - يَذْهَبُ - اِذْهَبْ", ex:"أَذْهَبُ إِلَى الْجَامِعَةِ صَبَاحًا.", exid:"Saya pergi ke universitas pada pagi hari.", note:"Sering diikuti huruf jar إِلَى (ke)."},
  {id:"belajar", en:"study / learn", ar:"يَتَعَلَّمُ", tr:"yata‘allamu", pos:"Fi'il", root:"ع-ل-م", plural:"تَعَلَّمَ - يَتَعَلَّمُ - تَعَلَّمْ", ex:"أَتَعَلَّمُ اللُّغَةَ الْعَرَبِيَّةَ بِشَغَفٍ.", exid:"Saya belajar bahasa Arab dengan penuh semangat.", note:"Masdar: تَعَلُّمٌ (pembelajaran)."},
  {id:"berbicara", en:"speak", ar:"يَتَكَلَّمُ", tr:"yatakallamu", pos:"Fi'il", root:"ك-ل-م", plural:"تَكَلَّمَ - يَتَكَلَّمُ - تَكَلَّمْ", ex:"هَلْ تَتَكَلَّمُ اللُّغَةَ الْعَرَبِيَّةَ؟", exid:"Apakah kamu berbicara bahasa Arab?", note:"Sinonim: يَتَحَدَّثُ (yataḥaddatsu)."},
  {id:"rumah", en:"house", ar:"بَيْتٌ", tr:"baitun", pos:"Isim", root:"ب-ي-ت", plural:"بُيُوتٌ", ex:"بَيْتِي قَرِيبٌ مِنَ الْمَسْجِدِ.", exid:"Rumahku dekat dari masjid.", note:"Sinonim: مَنْزِلٌ (manzilun)."},
  {id:"buku", en:"book", ar:"كِتَابٌ", tr:"kitābun", pos:"Isim", root:"ك-ت-ب", plural:"كُتُبٌ", ex:"هَذَا كِتَابٌ مُفِيدٌ جِدًّا.", exid:"Ini adalah buku yang sangat bermanfaat.", note:""},
  {id:"pena", en:"pen", ar:"قَلَمٌ", tr:"qalamun", pos:"Isim", root:"ق-ل-م", plural:"أَقْلَامٌ", ex:"أَكْتُبُ الرِّسَالَةَ بِالْقَلَمِ.", exid:"Saya menulis surat dengan pena.", note:""},
  {id:"air", en:"water", ar:"مَاءٌ", tr:"mā'un", pos:"Isim", root:"م-و-ه", plural:"مِيَاهٌ", ex:"أَشْرَبُ الْمَاءَ النَّقِيَّ.", exid:"Saya minum air yang jernih.", note:""},
  {id:"ilmu", en:"knowledge", ar:"عِلْمٌ", tr:"‘ilmun", pos:"Isim", root:"ع-ل-م", plural:"عُلُومٌ", ex:"طَلَبُ الْعِلْمِ فَرِيضَةٌ.", exid:"Menuntut ilmu adalah kewajiban.", note:""},
  {id:"guru", en:"teacher", ar:"مُعَلِّمٌ", tr:"mu‘allimun", pos:"Isim", root:"ع-ل-م", plural:"مُعَلِّمُونَ", ex:"يَشْرَحُ الْمُعَلِّمُ الدَّرْسَ بِوُضُوحٍ.", exid:"Guru menjelaskan pelajaran dengan jelas.", note:"Perempuan: مُعَلِّمَةٌ."},
  {id:"murid", en:"student", ar:"طَالِبٌ", tr:"thālibun", pos:"Isim", root:"ط-ل-ب", plural:"طُلَّابٌ", ex:"الطَّالِبُ الْمُجْتَهِدُ يَنْجَحُ.", exid:"Siswa yang rajin akan berhasil.", note:"Perempuan: طَالِبَةٌ."}
];

function getAllCombinedVocab(){
  return [
    ...QAMUS_DICT,
    ...VOCAB.map(v => ({ id: v.id, en: v.en || v.id, ar: v.ar, tr: v.tr, pos: v.pos || "Isim", root: v.root || "-", plural: v.plural || "-", ex: v.ex || "", exid: v.exid || "", note: "" })),
    ...SelfEvolvingAI.state.learnedVocab.map(v => ({ id: v.id, en: v.en || v.id, ar: v.ar, tr: v.tr, pos: v.pos || "Isim", root: v.root || "-", plural: v.plural || "-", ex: v.ex || "", exid: v.exid || "", note: "Tersimpan di Kamus Lokal" }))
  ];
}

function findExactLocalEntry(q){
  const qLow = q.trim().toLowerCase();
  const qNoHar = stripHarakat(q);
  const all = getAllCombinedVocab();
  return all.find(item =>
    stripHarakat(item.ar) === qNoHar ||
    item.id.toLowerCase() === qLow ||
    item.en.toLowerCase() === qLow
  ) || null;
}

function localQamusLookup(txt, dir){
  const q = txt.trim();
  const qLow = q.toLowerCase();
  const qNoHar = stripHarakat(q);
  const isArabicInput = hasAr(q) || dir === "ar-id" || dir === "ar-iden";
  const combined = getAllCombinedVocab();

  let exact = findExactLocalEntry(q);
  if (!exact){
    exact = combined.find(item =>
      (qNoHar.length >= 2 && stripHarakat(item.ar).includes(qNoHar)) ||
      (qLow.length >= 3 && (item.id.toLowerCase().includes(qLow) || item.en.toLowerCase().includes(qLow)))
    );
  }

  if (exact){
    return {
      engine: "Database Qamus Lokal",
      lang: isArabicInput ? "Arab" : "Indonesia / Inggris",
      arabic: exact.ar,
      translit: exact.tr,
      meaning_id: exact.id,
      meaning_en: exact.en,
      pos: exact.pos || "Isim",
      root: exact.root || "-",
      plural_tasrif: exact.plural || "-",
      example_ar: exact.ex || "",
      example_id: exact.exid || "",
      words: [exact],
      note: exact.note || ""
    };
  }

  return {
    engine: "Database Qamus Lokal (Offline)",
    lang: isArabicInput ? "Arab" : "Indonesia / Inggris",
    arabic: isArabicInput ? q : "لَمْ يُعْثَرْ عَلَى تَرْجَمَةٍ مُطَابِقَةٍ",
    translit: isArabicInput ? "" : "Lam yu‘tsar ‘alā tarjamatin muthābiqah",
    meaning_id: isArabicInput ? "Kata belum tersedia secara offline. Pastikan koneksi internet aktif untuk Google Translate." : `Kata "${q}" belum ada di kamus offline.`,
    meaning_en: isArabicInput ? "Not found offline." : `"${q}" not found offline.`,
    pos: "-",
    root: "-",
    plural_tasrif: "-",
    example_ar: "",
    example_id: "",
    words: [],
    note: ""
  };
}

/* ---------- FAVORITES / BOOKMARKS ---------- */
function getFavorites(){ return store.get("mk.favorites", []); }
function toggleFavorite(item){
  if (!item || !item.ar) return;
  let favs = getFavorites();
  const key = stripHarakat(item.ar);
  const idx = favs.findIndex(f => stripHarakat(f.ar) === key);
  if (idx >= 0){
    favs.splice(idx, 1);
    toast("Dihapus dari Favorit.");
  } else {
    favs.unshift({
      ar: item.ar,
      tr: item.tr || item.translit || "",
      id: item.id || item.meaning_id || "",
      en: item.en || item.meaning_en || "",
      pos: item.pos || "Isim",
      root: item.root || "-",
      plural: item.plural || item.plural_tasrif || "-",
      ex: item.ex || item.example_ar || "",
      exid: item.exid || item.example_id || ""
    });
    toast("Disimpan ke Kosakata Favorit ★");
  }
  store.set("mk.favorites", favs);
  renderFavorites();
}

function renderFavorites(){
  const favs = getFavorites();
  const cnt = $("#favCount");
  if (cnt) cnt.textContent = favs.length;
  const grid = $("#favGrid");
  if (!grid) return;
  grid.replaceChildren();
  if (!favs.length){
    grid.append(h("div", {class: "card", style: "padding:24px;grid-column:1/-1;text-align:center"},
      h("p", {class: "status"}, "Belum ada kosakata favorit. Tekan ikon bintang (★) pada hasil terjemahan atau kartu kosakata untuk menyimpannya.")));
    return;
  }
  favs.forEach(w => grid.append(wordCard(w, {k: "gold", t: "Favorit"})));
}

function renderLocalDb(){
  const all = getAllCombinedVocab();
  const cnt = $("#dbCount");
  if (cnt) cnt.textContent = all.length;
  const grid = $("#dbGrid");
  if (!grid) return;
  const q = ($("#dbSearch")?.value || "").trim().toLowerCase();
  const posFilter = $("#dbTypeFilter")?.value || "all";

  const filtered = all.filter(item => {
    const matchPos = posFilter === "all" || (item.pos || "").toLowerCase().includes(posFilter.toLowerCase());
    if (!matchPos) return false;
    if (!q) return true;
    return stripHarakat(item.ar).includes(stripHarakat(q)) ||
           (item.id || "").toLowerCase().includes(q) ||
           (item.en || "").toLowerCase().includes(q) ||
           (item.root || "").toLowerCase().includes(q) ||
           (item.tr || "").toLowerCase().includes(q);
  });

  grid.replaceChildren();
  filtered.slice(0, 60).forEach(w => grid.append(wordCard(w, {k: "islami", t: w.pos || "Kosakata"})));
}
$("#dbSearch")?.addEventListener("input", renderLocalDb);
$("#dbTypeFilter")?.addEventListener("change", renderLocalDb);

/* ---------- FULL PAGE QAMUS & GOOGLE TRANSLATE LOGIC ---------- */
let lastFullResult = null;
const qpIn = $("#qpIn"), qpDir = $("#qpDir"), qpOutPane = $("#qpOutPane"), qpStatus = $("#qpStatus");

$$(".qtab").forEach(tab => tab.addEventListener("click", () => {
  $$(".qtab").forEach(t => t.setAttribute("aria-selected", String(t === tab)));
  const target = tab.dataset.qtab;
  $("#qTabDual").hidden = target !== "dual";
  $("#qTabDb").hidden = target !== "db";
  $("#qTabFav").hidden = target !== "fav";
  if (target === "db") renderLocalDb();
  if (target === "fav") renderFavorites();
}));

$("#qpVkToggle").addEventListener("click", () => {
  const box = $("#qpVkContainer");
  if (box.hidden){
    buildVirtualKeyboard(box, qpIn);
    box.hidden = false;
  } else {
    box.hidden = true;
  }
});

$("#qpClear").addEventListener("click", () => {
  qpIn.value = "";
  qpIn.focus();
  qpStatus.textContent = "Teks dibersihkan.";
});

$("#qpSwap").addEventListener("click", () => {
  if (lastFullResult && lastFullResult.arabic){
    const wasAr = hasAr(qpIn.value);
    qpIn.value = wasAr ? (lastFullResult.meaning_id || lastFullResult.meaning_en) : lastFullResult.arabic;
    qpDir.value = wasAr ? "id-ar" : "ar-id";
    runFullTranslate();
  } else {
    toast("Terjemahkan dulu sebelum menukar bahasa.");
  }
});

$("#qpSpeak").addEventListener("click", () => {
  if (lastFullResult && lastFullResult.arabic) say(lastFullResult.arabic);
  else toast("Belum ada hasil terjemahan untuk dibacakan.");
});

$("#qpCopy").addEventListener("click", () => {
  if (lastFullResult){
    const txt = hasAr(qpIn.value) ? lastFullResult.meaning_id : lastFullResult.arabic;
    copyText(txt);
  }
});

$("#qpFavBtn").addEventListener("click", () => {
  if (lastFullResult) toggleFavorite(lastFullResult);
  else toast("Terjemahkan kata terlebih dahulu.");
});

function renderQpHist(){
  const hist = store.get("mk.qh", []);
  const box = $("#qpHistBox");
  if (!box) return;
  box.replaceChildren();
  if (!hist.length) return;
  box.append(
    h("p", {class: "status", style: "margin-bottom:8px;font-weight:600"}, "Riwayat Terjemahan Terakhir:"),
    h("div", {class: "chips"}, hist.map(x => h("button", {
      class: "chip", type: "button",
      onclick: () => { qpIn.value = x.src; runFullTranslate(); }
    }, x.src.length > 32 ? x.src.slice(0, 32) + "…" : x.src)))
  );
}

async function runFullTranslate(){
  const txt = qpIn.value.trim();
  if (!txt){
    qpStatus.className = "status err";
    qpStatus.textContent = "Masukkan kata atau kalimat terlebih dahulu.";
    return;
  }
  qpStatus.className = "status";
  qpStatus.textContent = "Menghubungkan ke Google Translate…";
  $("#qpGo").disabled = true;

  const d = await GoogleTranslateBridge.translate(txt, qpDir.value);
  lastFullResult = d;
  $("#qpOutLang").textContent = `${d.engine} • Terdeteksi: ${d.lang}`;

  const saveBtn = h("button", {
    class: "btn small gold", type: "button",
    onclick: () => {
      const added = SelfEvolvingAI.learnVocab([{
        ar: d.arabic, tr: d.translit, id: d.meaning_id, en: d.meaning_en,
        pos: d.pos, root: d.root, plural: d.plural_tasrif, ex: d.example_ar, exid: d.example_id
      }], "Google Translate");
      toast(added ? "Berhasil disimpan ke Database Kamus Lokal!" : "Kosakata ini sudah ada di Kamus Lokal.");
    }
  }, "+ Simpan ke Kamus Lokal");

  const toChatBtn = h("button", {
    class: "btn small ghost", type: "button",
    onclick: () => {
      go("muhadatsah");
      chatIn.value = d.arabic;
      chatIn.focus();
    }
  }, "Latih di Muhadatsah");

  qpOutPane.replaceChildren(
    h("div", {class: "q-output-box"},
      h("div", {},
        h("p", {class: "ar", lang: "ar", dir: "rtl", style: "font-size:2rem;font-weight:700;color:var(--accent-text);line-height:1.6"}, d.arabic),
        d.translit ? h("p", {class: "tr", style: "margin-top:2px"}, d.translit) : null
      ),
      h("div", {class: "q-tri"},
        h("div", {class: "q-tri-box"}, h("small", {}, "Bahasa Indonesia"), h("p", {class: "mean"}, d.meaning_id || "-")),
        h("div", {class: "q-tri-box"}, h("small", {}, "English"), h("p", {class: "mean"}, d.meaning_en || "-"))
      )
    ),
    h("div", {class: "q-meta-grid"},
      h("div", {class: "q-meta-item"}, h("small", {}, "Jenis Kata"), h("span", {}, d.pos || "-")),
      h("div", {class: "q-meta-item"}, h("small", {}, "Akar Kata (Root)"), h("span", {class: "ar", style: "font-size:1.1rem"}, d.root || "-")),
      h("div", {class: "q-meta-item"}, h("small", {}, "Jamak / Tasrif"), h("span", {class: "ar", style: "font-size:1.1rem"}, d.plural_tasrif || "-"))
    ),
    d.example_ar ? h("div", {class: "ex", style: "background:var(--soft);padding:10px 12px;border-radius:10px;border:0"},
      h("div", {class: "ai-row"},
        h("p", {class: "ar", lang: "ar", dir: "rtl", style: "flex:1"}, d.example_ar),
        h("button", {class: "icon-btn", type: "button", onclick: () => say(d.example_ar)}, icon("speaker"))
      ),
      h("p", {class: "exid"}, d.example_id || "")
    ) : null,
    Array.isArray(d.words) && d.words.length ? h("div", {class: "words"},
      h("small", {style: "font-weight:700;color:var(--muted)"}, "Rincian Kosakata:"),
      d.words.slice(0, 6).map(w => h("div", {},
        h("span", {class: "ar", lang: "ar", dir: "rtl"}, w.ar || ""),
        h("span", {class: "tr"}, w.tr || ""),
        h("span", {}, `${w.id || ""} / ${w.en || ""}`)
      ))
    ) : null,
    d.note ? h("p", {class: "exid"}, d.note) : null,
    h("div", {style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"}, saveBtn, toChatBtn)
  );

  qpStatus.textContent = "Terjemahan selesai (" + d.engine + ").";
  const hist = store.get("mk.qh", []).filter(x => x.src !== txt);
  hist.unshift({src: txt});
  store.set("mk.qh", hist.slice(0, 8));
  renderQpHist();
  renderQHist();
  $("#qpGo").disabled = false;
}

$("#qpGo").addEventListener("click", runFullTranslate);
qpIn.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); runFullTranslate(); } });

/* ---------- QUICK QAMUS MODAL (Pop-up dari Topbar) ---------- */
const qd = $("#qamus");
function openQamus(){
  closeDrawer();
  if (typeof qd.showModal === "function"){ if (!qd.open) qd.showModal(); } else qd.setAttribute("open", "");
  setTimeout(() => $("#qIn").focus(), 40);
}
function closeQamus(){ if (typeof qd.close === "function") qd.close(); else qd.removeAttribute("open"); }
$("#qClose").addEventListener("click", closeQamus);
qd.addEventListener("click", e => { if (e.target === qd) closeQamus(); });
$("#qIn").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); translateModal(); } });
$("#qGo").addEventListener("click", translateModal);
$("#qOpenFull").addEventListener("click", () => {
  const val = $("#qIn").value.trim();
  closeQamus();
  go("qamus");
  if (val){ qpIn.value = val; runFullTranslate(); }
});
$("#qVkToggle").addEventListener("click", () => {
  const box = $("#qVkContainer");
  if (box.hidden){ buildVirtualKeyboard(box, $("#qIn")); box.hidden = false; }
  else box.hidden = true;
});
$("#qSwap").addEventListener("click", () => {
  const arEl = $("#qArab");
  if (arEl && arEl.textContent){
    $("#qIn").value = arEl.textContent.trim();
    $("#qDir").value = "ar-iden";
    translateModal();
  } else {
    toast("Terjemahkan dulu sebelum menukar teks.");
  }
});

function renderQHist(){
  const hist = store.get("mk.qh", []);
  const box = $("#qHist");
  if (!box) return;
  box.replaceChildren();
  if (!hist.length) return;
  box.append(h("p", {class: "status", style: "margin-bottom:6px"}, "Riwayat Qamus"),
    h("div", {class: "chips"}, hist.slice(0, 5).map(x => h("button", {class: "chip", type: "button", onclick: () => { $("#qIn").value = x.src; translateModal(); }}, x.src.length > 26 ? x.src.slice(0, 26) + "…" : x.src))));
}

async function translateModal(){
  const txt = $("#qIn").value.trim(), dir = $("#qDir").value, st = $("#qStatus"), out = $("#qOut"), btn = $("#qGo");
  if (!txt){ st.className = "status err"; st.textContent = "Tulis teks yang ingin diterjemahkan."; return; }
  st.className = "status"; st.textContent = "Menerjemahkan via Google Translate…"; btn.disabled = true;

  const d = await GoogleTranslateBridge.translate(txt, dir);

  out.replaceChildren(h("div", {class: "q-res"},
    h("span", {class: "tag gold", style: "align-self:flex-start"}, `${d.engine} • ${d.lang}`),
    h("p", {class: "ar big", lang: "ar", dir: "rtl", id: "qArab"}, d.arabic),
    d.translit ? h("p", {class: "tr"}, d.translit) : null,
    h("div", {class: "q-tri"},
      h("div", {class: "q-tri-box"}, h("small", {}, "Bahasa Indonesia"), h("p", {class: "mean"}, d.meaning_id || "-")),
      h("div", {class: "q-tri-box"}, h("small", {}, "English"), h("p", {class: "mean"}, d.meaning_en || "-"))
    ),
    (d.pos || d.root) ? h("p", {class: "exid"}, `Jenis: ${d.pos || "-"} • Akar: ${d.root || "-"} • Jamak/Tasrif: ${d.plural_tasrif || "-"}`) : null,
    d.note ? h("p", {class: "exid", style: "margin-top:2px"}, d.note) : null,
    h("div", {class: "acts"},
      h("button", {class: "btn small ghost", type: "button", onclick: () => copyText(d.arabic, $("#qArab"))}, icon("copy"), "Salin Arab"),
      h("button", {class: "btn small ghost", type: "button", onclick: () => say(d.arabic)}, icon("speaker"), "Dengar"),
      h("button", {class: "btn small gold", type: "button", onclick: () => {
        SelfEvolvingAI.learnVocab([{ ar: d.arabic, tr: d.translit, id: d.meaning_id, en: d.meaning_en, pos: d.pos, root: d.root, plural: d.plural_tasrif }], "Qamus");
        toast("Disimpan ke Kamus Lokal!");
      }}, "+ Simpan"),
      h("button", {class: "btn small ghost", type: "button", onclick: () => {
        closeQamus();
        go("muhadatsah");
        chatIn.value = d.arabic;
        chatIn.focus();
      }}, "Gunakan di Muhadatsah")
    )
  ));
  st.textContent = "Selesai.";
  const hist = store.get("mk.qh", []).filter(x => x.src !== txt);
  hist.unshift({src: txt});
  store.set("mk.qh", hist.slice(0, 8));
  renderQHist();
  renderQpHist();
  btn.disabled = false;
}
renderQHist();
renderQpHist();

/* ---------- MU'ALLAM ---------- */
const LEVELS = [
  {id: "beginner", nm: "Beginner", ar: "مُبْتَدِئٌ", d: "Salam, kata ganti, dan kosakata sehari-hari."},
  {id: "intermediate", nm: "Intermediate", ar: "مُتَوَسِّطٌ", d: "Kata tanya, pola kalimat, dan fi'il mudhari'."},
  {id: "advanced", nm: "Advanced", ar: "مُتَقَدِّمٌ", d: "Ungkapan, nahwu, serta sinonim dan antonim."}
];
const BANK = {
  beginner: [
    {q:'Apa arti kata "كِتَابٌ"?', o:["Buku","Pena","Meja","Pintu"], a:0, w:"كِتَابٌ (kitābun) berarti buku. Pena adalah قَلَمٌ, meja مَكْتَبٌ, dan pintu بَابٌ."},
    {q:'Jawaban yang tepat untuk salam "السَّلَامُ عَلَيْكُمْ" adalah ...', o:["وَعَلَيْكُمُ السَّلَامُ","صَبَاحُ الْخَيْرِ","شُكْرًا","مَعَ السَّلَامَةِ"], a:0, w:"Salam dijawab dengan وَعَلَيْكُمُ السَّلَامُ (wa ‘alaikumussalām)."},
    {q:'Bagaimana mengucapkan "terima kasih" dalam bahasa Arab?', o:["شُكْرًا","عَفْوًا","مَرْحَبًا","مَعَ السَّلَامَةِ"], a:0, w:"شُكْرًا (syukran) berarti terima kasih."},
    {q:'Arti kalimat "مَا اسْمُكَ؟" adalah ...', o:["Siapa namamu?","Dari mana asalmu?","Apa kabarmu?","Berapa usiamu?"], a:0, w:"مَا اسْمُكَ؟ (mā ismuka) berarti siapa namamu."},
    {q:'Kata ganti "saya" dalam bahasa Arab adalah ...', o:["أَنَا","أَنْتَ","هُوَ","هِيَ"], a:0, w:"أَنَا = saya, أَنْتَ = kamu (laki-laki)."},
    {q:'Apa arti "مَاءٌ"?', o:["Air","Roti","Susu","Teh"], a:0, w:"مَاءٌ (mā'un) berarti air."},
    {q:'Lawan kata dari "كَبِيرٌ" (besar) adalah ...', o:["صَغِيرٌ","طَوِيلٌ","جَمِيلٌ","جَدِيدٌ"], a:0, w:"صَغِيرٌ berarti kecil."},
    {q:'Jawaban yang cocok untuk "كَيْفَ حَالُكَ؟" adalah ...', o:["أَنَا بِخَيْرٍ، الْحَمْدُ لِلَّهِ","اسْمِي أَحْمَدُ","أَنَا مِنْ إِنْدُونِيسِيَا","أَنَا طَالِبٌ"], a:0, w:"كَيْفَ حَالُكَ؟ berarti apa kabarmu."}
  ],
  intermediate: [
    {q:'Kalimat yang benar untuk "Saya pergi ke pasar" adalah ...', o:["أَذْهَبُ إِلَى السُّوقِ","أَذْهَبُ فِي السُّوقِ","أَذْهَبُ مِنَ السُّوقِ","أَذْهَبُونَ إِلَى السُّوقِ"], a:0, w:"إِلَى berarti ke (tujuan)."},
    {q:'Kata tanya untuk "Di mana?" adalah ...', o:["أَيْنَ","مَتَى","لِمَاذَا","كَمْ"], a:0, w:"أَيْنَ = di mana, مَتَى = kapan, لِمَاذَا = mengapa, كَمْ = berapa."},
    {q:'Bentuk muannats (perempuan) dari "مُعَلِّمٌ" adalah ...', o:["مُعَلِّمَةٌ","مُعَلِّمُونَ","مُعَلِّمَانِ","مُعَلَّمٌ"], a:0, w:"Ditambah ta marbuthah: مُعَلِّمَةٌ berarti guru perempuan."},
    {q:'Jamak taksir dari "كِتَابٌ" adalah ...', o:["كُتُبٌ","كِتَابَاتٌ","كَاتِبُونَ","مَكْتَبٌ"], a:0, w:"كُتُبٌ berarti buku-buku."},
    {q:'Lengkapi: "هِيَ ____ فِي الْفَصْلِ" (Dia perempuan duduk di kelas)', o:["جَالِسَةٌ","جَالِسٌ","جَالِسُونَ","جَالِسَانِ"], a:0, w:"هِيَ adalah kata ganti perempuan tunggal, maka khabarnya muannats: جَالِسَةٌ."},
    {q:'Fi\'il mudhari\' dari "كَتَبَ" untuk subjek "saya" adalah ...', o:["أَكْتُبُ","يَكْتُبُ","نَكْتُبُ","تَكْتُبُ"], a:0, w:"Awalan أ dipakai untuk saya: أَكْتُبُ."},
    {q:'Arti "أُرِيدُ أَنْ أَتَكَلَّمَ بِالْعَرَبِيَّةِ" adalah ...', o:["Saya ingin berbicara bahasa Arab","Saya ingin menulis bahasa Arab","Saya ingin belajar di Arab","Saya sedang makan di Arab"], a:0, w:"أُرِيدُ = saya ingin, أَتَكَلَّمَ = berbicara."},
    {q:'Arti "مَتَى تَذْهَبُ إِلَى الْمَدْرَسَةِ؟" adalah ...', o:["Kapan kamu pergi ke sekolah?","Di mana sekolahmu?","Mengapa kamu pergi ke sekolah?","Dengan siapa kamu ke sekolah?"], a:0, w:"مَتَى berarti kapan."}
  ],
  advanced: [
    {q:'Arti ungkapan "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللهِ" adalah ...', o:["Tiada daya dan kekuatan kecuali dengan pertolongan Allah","Segala puji bagi Allah","Dengan nama Allah yang Maha Pengasih","Semoga Allah membalasmu dengan kebaikan"], a:0, w:"Dzikir yang menyatakan kepasrahan kepada Allah."},
    {q:'Ungkapan yang tepat untuk "Mohon maaf atas keterlambatan saya" adalah ...', o:["أَعْتَذِرُ عَنْ تَأَخُّرِي","أَشْكُرُ عَلَى تَأَخُّرِي","أُحِبُّ تَأَخُّرِي","أَذْهَبُ بِتَأَخُّرِي"], a:0, w:"أَعْتَذِرُ عَنْ berarti saya meminta maaf atas."},
    {q:'Lengkapi: "أَنَا مُهْتَمٌّ ____ تَعَلُّمِ اللُّغَةِ الْعَرَبِيَّةِ"', o:["بِ","عَنْ","مِنْ","عَلَى"], a:0, w:"اهْتَمَّ بِـ memakai huruf jar بِ."},
    {q:'Lengkapi kalimat syarat: "إِنْ تَدْرُسْ جَيِّدًا ____"', o:["تَنْجَحْ","تَنْجَحُ","يَنْجَحُ","نَجَحَ"], a:0, w:"Setelah إِنْ, fi'il syarat dan jawabnya dibaca jazm."},
    {q:'Sinonim dari "تَحَدَّثَ" adalah ...', o:["تَكَلَّمَ","سَمِعَ","كَتَبَ","نَامَ"], a:0, w:"تَحَدَّثَ dan تَكَلَّمَ sama-sama berarti berbicara."},
    {q:'Lawan kata dari "الصِّدْقُ" adalah ...', o:["الْكَذِبُ","الْأَمَانَةُ","الْعَدْلُ","الصَّبْرُ"], a:0, w:"الصِّدْقُ berarti jujur, lawannya الْكَذِبُ."},
    {q:'Pada kalimat "قَرَأَ الطَّالِبُ الْكِتَابَ", kata "الْكِتَابَ" berkedudukan sebagai ...', o:["Maf'ul bih (objek)","Fa'il (pelaku)","Mubtada' (subjek nominal)","Khabar"], a:0, w:"الْكِتَابَ dibaca manshub karena menjadi objek."},
    {q:'Kalimat yang benar adalah ...', o:["كَانَ الطَّقْسُ جَمِيلًا","كَانَ الطَّقْسُ جَمِيلٌ","كَانَ الطَّقْسَ جَمِيلًا","كَانَ الطَّقْسِ جَمِيلًا"], a:0, w:"Setelah كَانَ, isimnya marfu' dan khabarnya manshub."}
  ]
};
const QR = $("#quizRoot");
const Q = {level: null, qs: [], i: 0, picked: null, answers: []};
function prep(list){
  return shuffle(list.map(q => {
    const idx = shuffle([0, 1, 2, 3]);
    return {q: q.q, o: idx.map(k => q.o[k]), a: idx.indexOf(q.a), w: q.w};
  }));
}
function showLevels(){
  const best = store.get("mk.best", {});
  QR.replaceChildren(h("div", {class: "levels"}, LEVELS.map(L => h("article", {class: "card level"},
    h("span", {class: "ar", lang: "ar", dir: "rtl"}, L.ar),
    h("h3", {}, L.nm),
    h("p", {}, L.d),
    best[L.id] != null ? h("p", {class: "best"}, "Skor terbaik: " + best[L.id] + "%") : null,
    h("div", {class: "acts"},
      h("button", {class: "btn", type: "button", onclick: () => startQuiz(L.id, BANK[L.id])}, "Mulai"),
      h("button", {class: "btn ghost", type: "button", onclick: () => genQuiz(L)}, "Soal baru dari AI"))))),
    h("p", {class: "status", id: "quizStatus", style: "margin-top:14px", "aria-live": "polite"}));
}
function startQuiz(levelId, list){
  Q.level = levelId; Q.qs = prep(list); Q.i = 0; Q.picked = null; Q.answers = [];
  showQuestion();
}
function showQuestion(){
  const q = Q.qs[Q.i]; Q.picked = null;
  const fb = h("div", {}), nextBtn = h("button", {class: "btn", type: "button", hidden: true, style: "margin-top:14px", onclick: () => { if (Q.i + 1 >= Q.qs.length) showResult(); else { Q.i++; showQuestion(); } }}, Q.i + 1 >= Q.qs.length ? "Lihat hasil" : "Soal berikutnya");
  const opts = h("div", {class: "opts"});
  q.o.forEach((txt, i) => {
    const b = h("button", {class: "opt", type: "button"});
    mixed(b, txt);
    b.addEventListener("click", () => {
      if (Q.picked != null) return;
      Q.picked = i;
      const ok = i === q.a;
      Q.answers.push({ok, picked: i});
      $$(".opt", opts).forEach((x, k) => { x.disabled = true; if (k === q.a) x.classList.add("good"); else if (k === i) x.classList.add("bad"); });
      const why = h("span", {}); mixed(why, q.w || "");
      fb.replaceChildren(h("div", {class: "fb " + (ok ? "good" : "bad")}, h("strong", {}, ok ? "Benar." : "Belum tepat."), why));
      nextBtn.hidden = false; nextBtn.focus();
    });
    opts.append(b);
  });
  const qt = h("p", {class: "q-text"}); mixed(qt, q.q);
  const bar = h("span", {}); bar.style.width = (Q.i / Q.qs.length * 100) + "%";
  QR.replaceChildren(
    h("div", {class: "quiz-top"}, h("button", {class: "link", type: "button", onclick: showLevels}, "← Pilih level"), h("span", {class: "count"}, "Soal " + (Q.i + 1) + " dari " + Q.qs.length)),
    h("div", {class: "bar-track"}, bar),
    h("div", {class: "card q-card"}, qt, opts, fb, nextBtn));
}
function showResult(){
  const total = Q.qs.length, score = Q.answers.filter(a => a.ok).length, pct = Math.round(score / total * 100);
  const best = store.get("mk.best", {});
  if (best[Q.level] == null || pct > best[Q.level]){ best[Q.level] = pct; store.set("mk.best", best); }
  const msg = pct >= 80 ? "Sangat baik. Kamu siap mencoba level berikutnya atau berlatih langsung di Muhadatsah."
    : pct >= 50 ? "Cukup baik. Ulangi soal yang salah, lalu coba lagi."
    : "Masih perlu latihan. Pelajari kosakata di Beranda, lalu coba kembali.";
  const wrong = Q.qs.map((q, i) => ({q, a: Q.answers[i]})).filter(x => x.a && !x.a.ok);
  const review = wrong.length ? h("div", {class: "review"}, h("h3", {style: "font-size:1.1rem"}, "Yang perlu diulang"),
    wrong.map(x => { const it = h("div", {class: "it"}), a = h("p", {}), b = h("p", {style: "margin-top:4px"}); mixed(a, x.q.q); mixed(b, "Jawaban benar: " + x.q.o[x.q.a] + ". " + (x.q.w || "")); it.append(a, b); return it; })) : null;
  const L = LEVELS.find(l => l.id === Q.level);
  QR.replaceChildren(h("div", {class: "card q-card"},
    h("p", {class: "count"}, "Hasil level " + (L ? L.nm : "")),
    h("p", {class: "score"}, score + " / " + total),
    h("p", {style: "margin-top:6px"}, msg),
    review,
    h("div", {style: "display:flex;flex-wrap:wrap;gap:10px;margin-top:18px"},
      h("button", {class: "btn", type: "button", onclick: () => startQuiz(Q.level, Q.qs.map(q => ({q: q.q, o: q.o, a: q.a, w: q.w})))}, "Ulangi"),
      h("button", {class: "btn ghost", type: "button", onclick: showLevels}, "Pilih level lain"))));
}
function genQuiz(L){
  const dynamicQs = SelfEvolvingAI.state.learnedVocab.slice(0, 4).map(v => {
    const distractors = shuffle(VOCAB.filter(x => x.id !== v.id)).slice(0, 3).map(x => x.id);
    return {
      q: `Apa arti kosakata yang baru dipelajari "${v.ar}" (${v.tr})?`,
      o: [v.id, ...distractors],
      a: 0,
      w: `${v.ar} (${v.tr}) artinya ${v.id}.`
    };
  });
  const pool = shuffle([...dynamicQs, ...BANK[L.id]]).slice(0, 8);
  startQuiz(L.id, pool);
}

/* ---------- MUHADATSAH ---------- */
const CHAT_TOPICS = ["Bebas (apa pun)", "Perkenalan diri", "Di masjid", "Keluarga", "Di pasar", "Cuaca", "Cita-cita"];
const LEVEL_RULE = {
  beginner: "Pemula: kalimat sangat pendek (3 sampai 7 kata), kosakata dasar, struktur sederhana.",
  intermediate: "Menengah: kalimat sedang, boleh memakai kata sambung dan pola kalimat majemuk sederhana.",
  advanced: "Lanjutan: kalimat lebih panjang, ungkapan idiomatik, dan struktur nahwu yang lebih kaya."
};
const C = {level: "beginner", topic: CHAT_TOPICS[0], turns: [], busy: false, target: null, ctl: null};
const chat = $("#chat"), chatIn = $("#chatIn"), sendBtn = $("#sendBtn"), micBtn = $("#micBtn");
let voiceUsed = false, dictBase = "", webSpeechRec = null, webSpeechActive = false;

function scrollChat(){ chat.scrollTop = chat.scrollHeight; }
function addMsg(n){ chat.append(n); scrollChat(); return n; }
function userBubble(text, src){
  const t = h("div", {}); mixed(t, text);
  return h("div", {class: "msg user"}, t, h("span", {class: "src"}, src === "voice" ? "diucapkan" : "diketik"));
}
function setTarget(ar){
  C.target = ar || null;
  const box = $("#target");
  if (!ar){ box.hidden = true; box.replaceChildren(); return; }
  const t = h("span", {}); mixed(t, "Target ucapan: " + ar);
  box.replaceChildren(t, h("button", {class: "link", type: "button", onclick: () => setTarget(null)}, "Batalkan"));
  box.hidden = false;
}
function aiBubble(d){
  const m = h("div", {class: "msg ai"});
  m.append(h("div", {class: "ai-row"},
    h("p", {class: "ar ai-ar", lang: "ar", dir: "rtl", style: "flex:1"}, d.reply_ar),
    h("button", {class: "icon-btn", type: "button", "aria-label": "Dengarkan balasan", onclick: () => say(d.reply_ar)}, icon("speaker"))));
  if (d.reply_translit) m.append(h("p", {class: "ai-tr"}, d.reply_translit));
  if (d.reply_id) m.append(h("p", {class: "ai-id"}, d.reply_id));
  const fixes = Array.isArray(d.corrections) ? d.corrections.filter(c => c && (c.said || c.correct)) : [];
  if (fixes.length){
    const box = h("div", {class: "fix-box"}, h("h4", {}, "KOREKSI"));
    fixes.slice(0, 4).forEach(c => {
      const line = h("p", {}), note = h("p", {class: "exid"});
      line.append(h("span", {class: "said"}), " → ", h("span", {class: "right"}));
      mixed($(".said", line), c.said || ""); mixed($(".right", line), c.correct || "");
      mixed(note, c.note_id || "");
      const kind = { lafadz: "Lafadz huruf", mufradat: "Mufradat", nahwu: "Tata bahasa" }[c.type] || "Catatan";
      box.append(h("div", {class: "fix"}, h("span", {class: "kind"}, kind), line, note));
    });
    m.append(box);
  } else if (d.praise_id){
    m.append(h("p", {class: "ok-box"}, d.praise_id));
  }
  if (d.practice_ar){
    const pa = h("p", {class: "ar", lang: "ar", dir: "rtl"}, d.practice_ar);
    m.append(h("div", {class: "prac"},
      h("span", {class: "lbl"}, "Coba ucapkan kalimat ini berikutnya"),
      pa,
      d.practice_id ? h("p", {class: "exid"}, d.practice_id) : null,
      h("div", {style: "display:flex;gap:8px;flex-wrap:wrap"},
        h("button", {class: "btn small ghost", type: "button", onclick: () => say(d.practice_ar)}, icon("speaker"), "Dengar contoh"),
        h("button", {class: "btn small", type: "button", onclick: () => { setTarget(d.practice_ar); chatIn.focus(); }}, "Jadikan target"))));
  }
  return m;
}
function greet(){
  chat.replaceChildren();
  C.turns = []; setTarget(null);
  addMsg(aiBubble({
    reply_ar: "السَّلَامُ عَلَيْكُمْ! أَهْلًا وَسَهْلًا. عَنْ أَيِّ مَوْضُوعٍ تُرِيدُ أَنْ نَتَحَدَّثَ الْيَوْمَ؟",
    reply_translit: "Assalāmu ‘alaikum! Ahlan wa sahlan. ‘An ayyi mawdhū‘in turīdu an nataḥaddatsa al-yawm?",
    reply_id: "Assalamu'alaikum! Selamat datang. Topik apa yang ingin kita bicarakan hari ini?"
  }));
}
function renderTopics(){
  const box = $("#chatTopics"); box.replaceChildren();
  CHAT_TOPICS.forEach(t => box.append(h("button", {class: "chip", type: "button", "aria-pressed": String(C.topic === t), onclick: () => { C.topic = t; $("#topicCustom").value = ""; renderTopics(); }}, t)));
  $("#topicNow").textContent = "Topik saat ini: " + C.topic + ". Level: " + C.level + ".";
}
$("#topicCustom").addEventListener("keydown", e => {
  if (e.key === "Enter"){ e.preventDefault(); const v = e.target.value.trim(); if (v){ C.topic = v; renderTopics(); toast("Topik diganti ke “" + v + "”."); } }
});
$("#levelSel").addEventListener("change", e => { C.level = e.target.value; renderTopics(); });
$("#resetChat").addEventListener("click", () => {
  if (C.ctl) C.ctl.abort();
  stopAnyMic();
  greet();
  toast("Percakapan dimulai ulang.");
});

function setBusy(b){ C.busy = b; sendBtn.disabled = b; chatIn.disabled = b; }

async function send(){
  if (C.busy) return;
  clearAutoSendTimer();
  const text = chatIn.value.trim();
  if (!text){
    toast("Tulis kalimat atau klik ikon mikrofon untuk berbicara terlebih dahulu.");
    chatIn.focus();
    return;
  }
  const src = voiceUsed ? "voice" : "typed", target = C.target;
  stopAnyMic();
  addMsg(userBubble(text, src));
  chatIn.value = ""; chatIn.style.height = "auto";
  voiceUsed = false; dictBase = ""; setMicMsg("");
  setBusy(true);

  const typing = addMsg(h("div", {class: "msg ai"}, h("span", {class: "typing"}, h("span", {class: "dots"}, h("i"), h("i"), h("i")), h("span", {class: "ai-tr"}, "AI sedang menanggapi…"))));

  await new Promise(r => setTimeout(r, 320));
  typing.remove();
  const d = SelfEvolvingAI.respondOffline(text, C.topic, C.level, src, target);
  C.turns.push({role: "user", text}, {role: "ai", ar: d.reply_ar});
  if (target) setTarget(null);
  addMsg(aiBubble(d));

  setBusy(false); chatIn.focus();
}

sendBtn.addEventListener("click", send);
chatIn.addEventListener("keydown", e => {
  clearAutoSendTimer();
  if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send(); }
});
chatIn.addEventListener("input", () => {
  if (!chatIn.value.trim()){
    voiceUsed = false;
    clearAutoSendTimer();
  }
  chatIn.style.height = "auto";
  chatIn.style.height = Math.min(chatIn.scrollHeight, 140) + "px";
});

/* ---------- MICROPHONE (WEB SPEECH API + 1s SILENCE AUTO-SEND) ---------- */
const AUTO_SEND_DELAY_MS = 1000;
let autoSendTimer = null;
let autoSendRaf = null;
let autoSendDeadline = 0;

function isAutoSendEnabled(){
  const toggle = $("#autoSendToggle");
  return toggle ? Boolean(toggle.checked) : true;
}

function clearAutoSendTimer(){
  if (autoSendTimer){
    clearTimeout(autoSendTimer);
    autoSendTimer = null;
  }
  if (autoSendRaf){
    cancelAnimationFrame(autoSendRaf);
    autoSendRaf = null;
  }
  autoSendDeadline = 0;
  const bar = $("#autoSendBar");
  const fill = $("#autoSendFill");
  if (bar) bar.hidden = true;
  if (fill) fill.style.width = "0%";
}

function scheduleAutoSend(){
  clearAutoSendTimer();
  if (!isAutoSendEnabled()) return;
  const currentText = chatIn.value.trim();
  if (!currentText || C.busy) return;

  const bar = $("#autoSendBar");
  const label = $("#autoSendLabel");
  const fill = $("#autoSendFill");
  autoSendDeadline = performance.now() + AUTO_SEND_DELAY_MS;

  if (bar) bar.hidden = false;
  if (label) label.textContent = "Jeda terdeteksi — mengirim otomatis dalam 1 detik…";

  const tickProgress = () => {
    if (!autoSendDeadline) return;
    const rem = Math.max(0, autoSendDeadline - performance.now());
    const pct = Math.min(100, ((AUTO_SEND_DELAY_MS - rem) / AUTO_SEND_DELAY_MS) * 100);
    if (fill) fill.style.width = pct.toFixed(1) + "%";
    if (label && rem > 0){
      const sec = (rem / 1000).toFixed(1);
      label.textContent = `Jeda terdeteksi — auto-kirim dalam ${sec}d…`;
    }
    if (rem > 0){
      autoSendRaf = requestAnimationFrame(tickProgress);
    }
  };
  autoSendRaf = requestAnimationFrame(tickProgress);

  autoSendTimer = setTimeout(() => {
    autoSendTimer = null;
    autoSendRaf = null;
    autoSendDeadline = 0;
    if (bar) bar.hidden = true;
    if (!C.busy && chatIn.value.trim()){
      voiceUsed = true;
      send();
    }
  }, AUTO_SEND_DELAY_MS);
}

$("#cancelAutoSendBtn")?.addEventListener("click", () => {
  clearAutoSendTimer();
  toast("Auto-kirim dibatalkan. Silakan lanjut bicara atau tekan Kirim.");
});

$("#autoSendToggle")?.addEventListener("change", () => {
  if (!isAutoSendEnabled()){
    clearAutoSendTimer();
    toast("Auto-kirim jeda 1 detik dinonaktifkan.");
  } else {
    toast("Auto-kirim jeda 1 detik diaktifkan.");
    if (voiceUsed && chatIn.value.trim() && !webSpeechActive) scheduleAutoSend();
  }
});

function setMicMsg(t){ const m = $("#micMsg"); m.textContent = t; m.hidden = !t; }
function setMicVisual(state){
  micBtn.dataset.state = state;
  const active = (state === "listening" || state === "starting");
  micBtn.setAttribute("aria-pressed", String(active));
  micBtn.setAttribute("aria-label", active ? "Berhenti merekam" : "Mulai bicara bahasa Arab");
  micBtn.title = active ? "Klik untuk berhenti merekam" : "Klik untuk mulai berbicara (Bahasa Arab)";
}
function stopAnyMic(){
  clearAutoSendTimer();
  if (webSpeechRec && webSpeechActive){
    try{ webSpeechRec.stop(); }catch(e){}
  }
  webSpeechActive = false;
  setMicVisual("idle");
}
function micError(code){
  clearAutoSendTimer();
  const map = {
    "not-allowed": "Izin mikrofon ditolak oleh browser. Aktifkan izin mikrofon di bilah alamat browser, lalu coba lagi.",
    "no-speech": "Suara tidak terdeteksi. Dekatkan mikrofon dan ucapkan kalimat bahasa Arab.",
    "unavailable": "Pengenalan suara tidak didukung browser ini. Gunakan Chrome/Edge atau ketik langsung."
  };
  setMicMsg(map[code] || "Mikrofon berhenti (" + code + "). Silakan coba lagi atau ketik ucapanmu.");
}

function initWebSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "ar-SA";
  rec.continuous = false;
  rec.interimResults = true;
  rec.onstart = () => {
    clearAutoSendTimer();
    webSpeechActive = true;
    setMicVisual("listening");
    setMicMsg("");
    toast("Mikrofon aktif! Silakan berbicara dalam bahasa Arab…");
  };
  rec.onresult = (ev) => {
    // Pengguna sedang berbicara -> batalkan timer kirim sebelumnya dan tunggu jeda baru
    clearAutoSendTimer();
    let interim = "", finalTxt = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++){
      const tr = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalTxt += tr;
      else interim += tr;
    }
    if (finalTxt){
      dictBase = (dictBase + finalTxt + " ").replace(/\s{2,}/g, " ").replace(/^\s+/, "");
      chatIn.value = dictBase;
      voiceUsed = true;
      chatIn.dispatchEvent(new Event("input"));
      // Mulai hitung mundur jeda 1 detik setelah segmen ucapan final diterima
      scheduleAutoSend();
    } else if (interim){
      chatIn.value = (dictBase + interim).replace(/\s{2,}/g, " ");
      voiceUsed = true;
      chatIn.dispatchEvent(new Event("input"));
    }
  };
  rec.onspeechend = () => {
    if (voiceUsed && chatIn.value.trim()){
      scheduleAutoSend();
    }
  };
  rec.onerror = (ev) => {
    webSpeechActive = false;
    setMicVisual("idle");
    if (ev && ev.error !== "aborted") micError(ev.error);
  };
  rec.onend = () => {
    webSpeechActive = false;
    setMicVisual("idle");
    if (voiceUsed && chatIn.value.trim() && isAutoSendEnabled() && !C.busy){
      scheduleAutoSend();
    }
  };
  return rec;
}

micBtn.addEventListener("click", () => {
  if (!webSpeechRec) webSpeechRec = initWebSpeech();
  if (!webSpeechRec){
    micError("unavailable");
    toast("Browser ini tidak mendukung mikrofon speech-to-text.");
    return;
  }
  if (webSpeechActive){
    stopAnyMic();
    return;
  }
  clearAutoSendTimer();
  setMicMsg("");
  dictBase = chatIn.value.trim();
  if (dictBase) dictBase += " ";
  setMicVisual("starting");
  try{
    webSpeechRec.start();
  }catch(e){
    webSpeechActive = false;
    setMicVisual("idle");
    micError("upstream_error");
  }
});

/* init */
SelfEvolvingAI.init();
renderLocalDb();
renderFavorites();
renderTopics();
greet();
showLevels();
route();
})();
