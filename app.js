/* =========================================================
   OMAD TOUR — single-file multilingual app
   Replace LOGO_SRC below with your own logo (base64 or file path)
   ========================================================= */
const LOGO_SRC = "/assets/logo.svg";

let LANG = (function(){
  try{ return localStorage.getItem("omad_lang") || "uz"; }
  catch(e){ return "uz"; }
})();
let THEME = (function(){ try{ return localStorage.getItem("omad_theme") || "light"; }catch(e){ return "light"; } })();
function applyTheme(){
  document.body.classList.toggle("theme-light", THEME === "light");
}
function toggleTheme(){
  THEME = THEME === "dark" ? "light" : "dark";
  try{ localStorage.setItem("omad_theme", THEME); }catch(e){}
  applyTheme();
  render();
}
let state = { direction:null, fromCity:null, toCity:null, fromCustom:"", toCustom:"", date:null, calMonth:new Date().getMonth(), calYear:new Date().getFullYear() };
let history = [];

/* ---------------- ADMIN / ANNOUNCEMENT ----------------
   Tap the home logo 5 times quickly to open the admin panel.
   Change ADMIN_PASSWORD below to whatever you like.

   This uses kvdb.io — a free, keyless shared storage service
   (no account/signup needed) — so anything you add in the admin
   panel (news items, visa submissions) becomes visible to EVERY
   visitor / to you from any device, not just the one you used.

   First-time setup (only needs to be done once, ever):
   1. Tap the logo 5x, enter the admin password.
   2. If no shared storage is linked yet, you'll see a
      "Ulashilgan xotira yaratish" button — tap it once.
   3. Copy the ID it shows you and send it to me (Claude) so I can
      bake it permanently into KVDB_BUCKET below and re-send the
      file — after that, every future edit is instantly shared. */
const ADMIN_PASSWORD = "Omadspb";

/* Telegram bot notification — fires when a visa-check submission comes in.
   NOTE: this token is visible in the page's public source code (any visitor
   can view it), since there is no backend to hide it behind. It can only
   send messages (it has no other permissions), and you can regenerate/revoke
   it anytime via @BotFather in Telegram if it's ever misused. */
const BOT_TOKEN = "8949050831:AAHP91glGT-3nt7iKceUckAibvtfKohMGKc";
const ADMIN_CHAT_ID = "7359558983";
function notifyAdminTelegram(text){
  if(!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text })
  }).catch(()=>{});
}
function notifyAdminTelegramPhoto(photoUrl, caption, submissionId){
  if(!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  const payload = { chat_id: ADMIN_CHAT_ID, photo: photoUrl, caption };
  if(submissionId){
    payload.reply_markup = {
      inline_keyboard: [[
        { text:"✅ Tayyor", callback_data:`status:${submissionId}:ready` },
        { text:"⏳ Hali tayyor emas", callback_data:`status:${submissionId}:pending` }
      ]]
    };
  }
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  }).catch(()=>{});
}
function isInAppBrowser(){
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|imo\b|IMO\b|WhatsApp|Snapchat|TikTok|musical_ly/i.test(ua);
}
let logoTapCount = 0;
let logoTapTimer = null;

/* ---- Shared storage: proxied through our own domain (/api/kv) so in-app
   browsers that restrict third-party requests still work — the visitor's
   browser only ever talks to our own site, never to kvdb.io directly. ---- */
function kvCacheGet(key, fallback){
  try{ const raw = localStorage.getItem("omad_cache_"+key); return raw ? JSON.parse(raw) : fallback; }catch(e){ return fallback; }
}
function kvCacheSet(key, value){
  try{ localStorage.setItem("omad_cache_"+key, JSON.stringify(value)); }catch(e){}
}
async function fetchWithRetry(url, opts, attempts){
  attempts = attempts || 2;
  let lastErr;
  for(let i=0;i<attempts;i++){
    try{
      const res = await fetch(url, Object.assign({ cache:"no-store" }, opts||{}));
      return res;
    }catch(e){
      lastErr = e;
      await new Promise(r=> setTimeout(r, 400));
    }
  }
  throw lastErr;
}
async function kvGetJSON(key, fallback){
  try{
    const res = await fetchWithRetry(`/api/kv?key=${key}`);
    if(res.status === 404) return kvCacheGet(key, fallback);
    if(!res.ok) return kvCacheGet(key, fallback);
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : fallback;
    kvCacheSet(key, parsed);
    return parsed;
  }catch(e){ return kvCacheGet(key, fallback); }
}
async function kvSetJSON(key, value){
  kvCacheSet(key, value); // always keep a local copy, so nothing is ever silently lost
  const serialized = JSON.stringify(value);
  try{
    const res = await fetchWithRetry(`/api/kv?key=${key}`, {
      method:"PUT",
      headers:{ "Content-Type":"application/json" },
      body: serialized
    }, 3);
    if(res.ok) return { ok:true, detail:"" };
    let bodyText = "";
    try{ bodyText = await res.text(); }catch(e){}
    return { ok:false, detail:`HTTP ${res.status} ${bodyText}`.slice(0,150) };
  }catch(e){ return { ok:false, detail:`network: ${e && e.message ? e.message : e}`.slice(0,150) }; }
}

/* ---- News list ---- */
async function fetchNewsList(){ return await kvGetJSON("news_list", []); }
const MAX_NEWS_ITEMS = 30;
const MAX_VISA_ITEMS = 30;

async function addNewsItem(text, imageUrl){
  let list = await fetchNewsList();
  list.unshift({ id: Date.now(), text, imageUrl: imageUrl || "", date: new Date().toLocaleDateString("uz-UZ") });
  list = list.slice(0, MAX_NEWS_ITEMS); // keep the list small enough to always fit kvdb's 16KB limit
  return await kvSetJSON("news_list", list);
}
async function deleteNewsItem(id){
  const list = await fetchNewsList();
  const filtered = list.filter(n => n.id !== id);
  return await kvSetJSON("news_list", filtered);
}
function getNewsSeenCount(){ try{ return parseInt(localStorage.getItem("omad_news_seen")||"0"); }catch(e){ return 0; } }
function setNewsSeenCount(n){ try{ localStorage.setItem("omad_news_seen", String(n)); }catch(e){} }

/* ---- Visa-check submissions ---- */
function loadImageElement(file){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = ()=>{ URL.revokeObjectURL(objectUrl); resolve(img); };
    img.onerror = (e)=>{ URL.revokeObjectURL(objectUrl); reject(e); };
    img.src = objectUrl;
  });
}
function drawToJpeg(img, maxDimension, quality){
  let { width, height } = img;
  if(width > height && width > maxDimension){
    height = Math.round(height * (maxDimension / width));
    width = maxDimension;
  } else if(height > maxDimension){
    width = Math.round(width * (maxDimension / height));
    height = maxDimension;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}
// Vercel's serverless functions hard-cap request bodies at 4.5MB. Base64
// inflates size by ~33%, and our JSON wrapper adds a little more, so we
// target a safe ceiling well under that limit and shrink automatically,
// as many times as it takes, until the result actually fits — no matter
// how large the original photo was.
const UPLOAD_SAFE_LIMIT = 2800000; // ~2.8MB of base64 text, leaves a big safety margin
async function uploadToImgbb(file){
  let base64;
  try{
    const img = await loadImageElement(file);
    const steps = [
      [1600, 0.75], [1300, 0.7], [1000, 0.6], [800, 0.5], [600, 0.45], [450, 0.4]
    ];
    base64 = drawToJpeg(img, steps[0][0], steps[0][1]);
    let i = 1;
    while(base64.length > UPLOAD_SAFE_LIMIT && i < steps.length){
      base64 = drawToJpeg(img, steps[i][0], steps[i][1]);
      i++;
    }
  }catch(e){
    // if the image can't be decoded/redrawn for any reason, fall back to the raw file
    base64 = await new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const res = await fetchWithRetry(`/api/upload-image`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ imageBase64: base64 })
  });
  const data = await res.json();
  if(data && data.url) return data.url;
  throw new Error("upload failed");
}
async function fetchVisaSubmissions(){ return await kvGetJSON("visa_submissions", []); }
async function addVisaSubmission(phone, imageUrl){
  let list = await fetchVisaSubmissions();
  const id = Date.now();
  list.unshift({ id, phone, imageUrl, date: new Date().toLocaleString("uz-UZ"), status:"new" });
  list = list.slice(0, MAX_VISA_ITEMS); // keep the list small enough to always fit kvdb's 16KB limit
  const result = await kvSetJSON("visa_submissions", list);
  return { id, saved: result.ok, detail: result.detail };
}
async function deleteVisaSubmission(id){
  const list = await fetchVisaSubmissions();
  const filtered = list.filter(n => n.id !== id);
  return await kvSetJSON("visa_submissions", filtered);
}
async function updateVisaStatus(id, status){
  const list = await fetchVisaSubmissions();
  const item = list.find(n => n.id === id);
  if(item) item.status = status;
  return await kvSetJSON("visa_submissions", list);
}
function getMyVisaIds(){ try{ return JSON.parse(localStorage.getItem("omad_my_visa_ids")||"[]"); }catch(e){ return []; } }
function addMyVisaId(id){
  const ids = getMyVisaIds();
  ids.push(id);
  try{ localStorage.setItem("omad_my_visa_ids", JSON.stringify(ids)); }catch(e){}
}
function getSeenVisaStatuses(){ try{ return JSON.parse(localStorage.getItem("omad_seen_visa_status")||"{}"); }catch(e){ return {}; } }
function setSeenVisaStatus(id, status){
  const seen = getSeenVisaStatuses();
  seen[id] = status;
  try{ localStorage.setItem("omad_seen_visa_status", JSON.stringify(seen)); }catch(e){}
}

/* ---------------- TRANSLATIONS ---------------- */
const T = {
  uz:{
    greeting:"Assalomu alaykum! Sizni \"Omad Tour\" xizmatida ko'rganimizdan mamnunmiz.",
    aviabiletSub:"Yo'nalishni tanlang, joriy narxlar va bron qilish imkoniyati",
    vizaSub:"Natijani tekshiring, konsullik bilan bog'laning",
    notarialSub:"Tarjima, ishonchnoma, sug'urta va boshqa xizmatlar",
    guruhlarSub:"Narxlar, yangiliklar va konsullik guruhlari",
    manzillarSub:"Ofislarimizning manzili va joylashuvi",
    yordamSub:"Fikr va takliflaringiz uchun",
    aviabilet:"Aviachiptalar bo'limi",
    viza:"Viza natijasini tekshirish",
    notarial:"Notarial xizmatlar",
    guruhlar:"Rasmiy guruhlarimiz",
    manzillar:"Manzillarimiz",
    yordam:"Yordam",
    back:"Orqaga",
    ru_uz:"Rossiya → O'zbekiston",
    uz_ru:"O'zbekiston → Rossiya",
    other:"Boshqa davlatlar",
    chooseRuCity:"Rossiyaning qaysi shahridan jo'nashni istaysiz?",
    chooseUzCity:"O'zbekistonning qaysi shahriga borishni istaysiz?",
    chooseUzCityFrom:"O'zbekistonning qaysi shahridan jo'naysiz?",
    chooseRuCityTo:"Rossiyaning qaysi shahriga borasiz?",
    otherFromLabel:"Jo'nab ketmoqchi bo'lgan manzilingizni kiriting",
    otherToLabel:"Boradigan davlatingizni kiriting",
    otherFromPh:"Masalan: Polsha",
    aviaMenuText:"Sizga mos yo'nalishni tanlang.",
    tourServices:"Tur xizmatlari",
    tourServicesText:"Ushbu bo'limda umra ziyorati va dunyo bo'ylab tur paketlarini buyurtma qilishingiz mumkin. Quyidagi aloqa vositalaridan birini tanlang.",
    directCall:"Bevosita qo'ng'iroq qilish",
    otherToPh:"Masalan: Istanbul",
    next:"Davom etish",
    required:"Ushbu maydonni to'ldirish majburiy",
    chooseDate:"Sanani tanlang",
    chooseContact:"Aloqa vositasini tanlang",
    send:"Yuborish",
    ticketSummary:"Tanlangan yo'nalish",
    from:"Jo'nash manzili",
    to:"Borish manzili",
    date:"Sana",
    vizaText:"Ushbu bo'limda viza natijangizni tekshirishingiz, shuningdek konsullik masalalari yuzasidan Sankt-Peterburgdagi O'zbekiston Respublikasi Bosh Konsulligining rasmiy Telegram guruhiga murojaat qilishingiz mumkin. Anketa to'ldirish bo'yicha mutaxassisimiz bilan bog'lanib, elektron anketani to'ldirishingiz va natijasini tekshirtirishingiz mumkin.",
    vizaCheck:"Viza natijasini aniqlash",
    vizaGroup:"O'zbekiston Respublikasining Sankt-Peterburgdagi Bosh Konsulligi rasmiy Telegram guruhi",
    vizaExperts:"Anketa mutaxassislarimiz",
    call:"Qo'ng'iroq qilish",
    notarialText:"Assalomu alaykum! Sizga qanday notarial xizmat kerak? (Pasport tarjimasi, rozilik xati, ishonchnoma, sug'urta, DMS, OMS, yuridik yordam va hujjatlar bo'yicha ko'maklashuv.) Quyidagi aloqa vositalari orqali murojaat qiling.",
    groupsText:"Ushbu bo'limda aviachipta narxlari, konsullik e'lonlari va notarial xizmatlar yuzasidan rasmiy guruhlarimizga a'zo bo'lishingiz mumkin.",
    tgAviaGroup:"Telegram — Aviakassa guruhi",
    waAviaGroup:"WhatsApp — Aviakassa guruhi",
    consGroup:"O'zbekiston Respublikasi Konsulligining rasmiy Telegram guruhi",
    notGroup:"Notarius xizmatlari guruhi",
    addrTitle:"\"Omad Tour\" rasmiy manzillari",
    office1title:"1-ofis",
    office1:"Texnologicheskiy institut metro bekati, 4-Krasnoarmeyskaya ko'chasi, 3-uy. Domofon: 22V. \"Omad Tour\" ofisi.",
    office2title:"2-ofis",
    office2:"Dybenko metro bekati, Bolshevikov shoh ko'chasi, 24-uy, 1-bino.",
    map1:"Texnologicheskiy institut metro bekati",
    map2:"Dybenko metro bekati",
    helpText:"Siz \"Yordam\" bo'limidasiz. Ushbu bo'limda saytimiz faoliyati, xizmat sifati yoki boshqa mavzular yuzasidan fikr-mulohaza va takliflaringizni yozib qoldirishingiz mumkin. \"Omad Tour\" jamoasi sizga har doim yordam berishga tayyor.",
    helpPh:"Fikr-mulohazangizni shu yerga yozing",
    mon:["Yanvar","Fevral","Mart","Aprel","May","Iyun","Iyul","Avgust","Sentabr","Oktabr","Noyabr","Dekabr"],
    dow:["Ya","Du","Se","Ch","Pa","Ju","Sh"],
    vizaFrameNote:"Agar sahifa ushbu oynada ochilmasa",
    newsTitle:"Yangiliklar",
    loading:"Yuklanmoqda",
    contactUs:"Bog'lanish",
    vizaSubmitBtn:"Vizani biz orqali tekshirish",
    vizaSubmitText:"Anketa yoki pasport rasmingizni yuklang va telefon raqamingizni qoldiring — mutaxassisimiz tez orada siz bilan bog'lanadi.",
    vizaAttention:"Iltimos, anketangizning surati va rasmini yuboring",
    yourPhone:"Telefon raqami",
    uploadPhoto:"Hujjat rasmini yuklash",
    submitSuccess:"So'rovingiz qabul qilindi. Tez orada siz bilan bog'lanamiz.",
    submitFail:"Yuborishda xatolik yuz berdi. Internet aloqasini tekshirib, qayta urinib ko'ring.",
    helpFieldLabel:"Fikr-mulohazangiz",
    myVisaStatus:"So'rovim holati",
    statusNewTitle:"Ko'rib chiqilmoqda",
    statusNewText:"So'rovingiz mutaxassisimizga yuborildi. Iltimos, ko'rib chiqib javob berilishini kuting.",
    statusReadyTitle:"Natija tayyor",
    statusReadyText:"Anketangiz bo'yicha natija tayyor. Vizani olish uchun O'zbekiston Respublikasi Bosh Konsulligiga shaxsan tashrif buyurib, konsul bilan uchrashishingiz kerak. Eslatib o'tamiz: bizning xizmatimiz faqat anketa to'ldirishdan iborat — vizaning o'zini faqat Konsullikning o'zi beradi.",
    statusPendingTitle:"Hali tayyor emas",
    statusPendingText:"So'rovingiz hali ko'rib chiqilmoqda, iltimos, biroz kuting. Xohlasangiz, Sankt-Peterburgdagi O'zbekiston Respublikasi Bosh Konsulligining rasmiy Telegram guruhiga murojaat qilishingiz yoki ular bilan uchrashuv so'rashingiz mumkin.",
    noVisaRequest:"Sizda hali yuborilgan so'rov mavjud emas.",
    inAppWarning:"Diqqat: siz saytni ilova ichidagi brauzerda (masalan, Telegram, WhatsApp, Imo) ochyapsiz. Ba'zi ilovalar bunday brauzerlarda tashqi xizmatlarga ulanishni cheklaydi, bu esa rasm yuklash yoki so'rov yuborishga xalaqit berishi mumkin. Eng ishonchli natija uchun ushbu havolani telefoningizning asosiy brauzerida (Safari yoki Chrome) oching.",
    copyLink:"Havolani nusxalash",
    linkCopied:"Havola nusxalandi",
    langName:"O'zbek tili"
  },
  ru:{
    greeting:"Здравствуйте! Рады приветствовать вас на платформе \"Omad Tour\".",
    aviabiletSub:"Выберите направление, актуальные цены и бронирование",
    vizaSub:"Проверка результата, связь с консульством",
    notarialSub:"Перевод, доверенность, страхование и другие услуги",
    guruhlarSub:"Цены, новости и консульские группы",
    manzillarSub:"Адреса и расположение наших офисов",
    yordamSub:"Для ваших отзывов и предложений",
    aviabilet:"Раздел авиабилетов",
    viza:"Проверка результата визы",
    notarial:"Нотариальные услуги",
    guruhlar:"Официальные группы",
    manzillar:"Наши адреса",
    yordam:"Помощь",
    back:"Назад",
    ru_uz:"Россия → Узбекистан",
    uz_ru:"Узбекистан → Россия",
    other:"Другие страны",
    chooseRuCity:"Из какого города России вы планируете вылет?",
    chooseUzCity:"В какой город Узбекистана вы направляетесь?",
    chooseUzCityFrom:"Из какого города Узбекистана вы вылетаете?",
    chooseRuCityTo:"В какой город России вы направляетесь?",
    otherFromLabel:"Укажите пункт отправления",
    otherToLabel:"Укажите страну назначения",
    otherFromPh:"Например: Польша",
    aviaMenuText:"Выберите подходящее направление.",
    tourServices:"Туристические услуги",
    tourServicesText:"В этом разделе вы можете заказать туристические пакеты для паломничества Умра, а также туры по всему миру. Выберите один из указанных ниже способов связи.",
    directCall:"Прямой звонок",
    otherToPh:"Например: Стамбул",
    next:"Продолжить",
    required:"Данное поле обязательно для заполнения",
    chooseDate:"Выберите дату",
    chooseContact:"Выберите способ связи",
    send:"Отправить",
    ticketSummary:"Выбранный маршрут",
    from:"Пункт отправления",
    to:"Пункт назначения",
    date:"Дата",
    vizaText:"В этом разделе вы можете проверить результат визы, а по консульским вопросам — обратиться в официальную Telegram-группу Генерального консульства Республики Узбекистан в Санкт-Петербурге. Вы также можете связаться с нашим специалистом для заполнения электронной анкеты и проверки результата.",
    vizaCheck:"Проверить результат визы",
    vizaGroup:"Официальная Telegram-группа Генерального консульства Республики Узбекистан в Санкт-Петербурге",
    vizaExperts:"Наши специалисты по анкетам",
    call:"Позвонить",
    notarialText:"Здравствуйте! Какая нотариальная услуга вам необходима? (Перевод паспорта, заявление о согласии, доверенность, страхование, ДМС, ОМС, юридическая помощь, содействие в оформлении документов.) Обратитесь по указанным ниже контактам.",
    groupsText:"В этом разделе вы можете подписаться на официальные группы с ценами на авиабилеты, консульскими объявлениями и информацией о нотариальных услугах.",
    tgAviaGroup:"Telegram — группа «Авиакасса»",
    waAviaGroup:"WhatsApp — группа «Авиакасса»",
    consGroup:"Официальная Telegram-группа Консульства Республики Узбекистан",
    notGroup:"Группа нотариальных услуг",
    addrTitle:"Официальные адреса \"Omad Tour\"",
    office1title:"Офис 1",
    office1:"Станция метро «Технологический институт», 4-я Красноармейская улица, дом 3. Домофон: 22В. Офис «Omad Tour».",
    office2title:"Офис 2",
    office2:"Станция метро «Дыбенко», проспект Большевиков, дом 24, корпус 1.",
    map1:"Станция метро «Технологический институт»",
    map2:"Станция метро «Дыбенко»",
    helpText:"Вы находитесь в разделе «Помощь». Здесь вы можете оставить отзыв о работе сайта, сообщить о недостатках в обслуживании или поделиться предложениями. Команда «Omad Tour» всегда готова вам помочь.",
    helpPh:"Оставьте ваш отзыв здесь",
    mon:["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"],
    dow:["Пн","Вт","Ср","Чт","Пт","Сб","Вс"],
    vizaFrameNote:"Если страница не открывается в этом окне",
    newsTitle:"Новости",
    loading:"Загрузка",
    contactUs:"Связаться",
    vizaSubmitBtn:"Проверить визу через нас",
    vizaSubmitText:"Загрузите фотографию анкеты или паспорта и оставьте номер телефона — наш специалист свяжется с вами в ближайшее время.",
    vizaAttention:"Пожалуйста, отправьте фотографию вашей анкеты",
    yourPhone:"Номер телефона",
    uploadPhoto:"Загрузить фотографию документа",
    submitSuccess:"Ваша заявка принята. Мы свяжемся с вами в ближайшее время.",
    submitFail:"Произошла ошибка при отправке. Проверьте подключение к интернету и повторите попытку.",
    helpFieldLabel:"Ваш отзыв",
    myVisaStatus:"Статус моей заявки",
    statusNewTitle:"На рассмотрении",
    statusNewText:"Ваша заявка отправлена нашему специалисту. Пожалуйста, дождитесь рассмотрения и ответа.",
    statusReadyTitle:"Результат готов",
    statusReadyText:"Результат по вашей анкете готов. Для получения визы вам необходимо лично посетить Генеральное консульство Республики Узбекистан и встретиться с консулом. Обращаем внимание: наша услуга заключается только в заполнении анкеты — саму визу выдаёт исключительно Консульство.",
    statusPendingTitle:"Пока не готово",
    statusPendingText:"Ваша заявка ещё рассматривается, пожалуйста, подождите. При желании вы можете обратиться в официальную Telegram-группу Генерального консульства Республики Узбекистан в Санкт-Петербурге или запросить встречу.",
    noVisaRequest:"У вас пока нет отправленных заявок.",
    inAppWarning:"Внимание: вы открыли сайт во встроенном браузере приложения (например, Telegram, WhatsApp, Imo). Некоторые приложения ограничивают подключение к внешним сервисам в таком браузере, что может помешать загрузке фото или отправке заявки. Для надёжной работы откройте эту ссылку в основном браузере телефона (Safari или Chrome).",
    copyLink:"Скопировать ссылку",
    linkCopied:"Ссылка скопирована",
    langName:"Русский"
  },
  en:{
    greeting:"Welcome. We are pleased to have you with \"Omad Tour\".",
    aviabiletSub:"Select a route, view current prices and book",
    vizaSub:"Check your result, contact the consulate",
    notarialSub:"Translation, power of attorney, insurance and more",
    guruhlarSub:"Prices, news and consular groups",
    manzillarSub:"Addresses and locations of our offices",
    yordamSub:"For your feedback and suggestions",
    aviabilet:"Flight Tickets",
    viza:"Check Visa Result",
    notarial:"Notary Services",
    guruhlar:"Official Groups",
    manzillar:"Our Addresses",
    yordam:"Help",
    back:"Back",
    ru_uz:"Russia → Uzbekistan",
    uz_ru:"Uzbekistan → Russia",
    other:"Other Countries",
    chooseRuCity:"From which city in Russia would you like to depart?",
    chooseUzCity:"Which city in Uzbekistan are you travelling to?",
    chooseUzCityFrom:"From which city in Uzbekistan are you departing?",
    chooseRuCityTo:"Which city in Russia are you travelling to?",
    otherFromLabel:"Please enter your departure location",
    otherToLabel:"Please enter your destination country",
    otherFromPh:"Example: Poland",
    aviaMenuText:"Please select the route that applies to you.",
    tourServices:"Tour Services",
    tourServicesText:"In this section you may order Umrah pilgrimage packages as well as tour packages worldwide. Please choose one of the contact options below.",
    directCall:"Direct Call",
    otherToPh:"Example: Istanbul",
    next:"Continue",
    required:"This field is required",
    chooseDate:"Please select a date",
    chooseContact:"Please select a contact method",
    send:"Send",
    ticketSummary:"Selected route",
    from:"Departure",
    to:"Destination",
    date:"Date",
    vizaText:"In this section you may check your visa result. For consular inquiries, please contact the official Telegram group of the Consulate General of the Republic of Uzbekistan in Saint Petersburg. You may also contact our specialist to complete the electronic application form and verify the result.",
    vizaCheck:"Check Visa Result",
    vizaGroup:"Official Telegram group of the Consulate General of the Republic of Uzbekistan in Saint Petersburg",
    vizaExperts:"Our Application Specialists",
    call:"Call",
    notarialText:"Hello. Which notary service do you require? (Passport translation, letter of consent, power of attorney, insurance, DMS, OMS, legal assistance, or document support.) Please contact us using the details below.",
    groupsText:"In this section you may join our official groups for flight ticket prices, consular announcements, and notary services.",
    tgAviaGroup:"Telegram — Aviakassa Group",
    waAviaGroup:"WhatsApp — Aviakassa Group",
    consGroup:"Official Telegram group of the Consulate of the Republic of Uzbekistan",
    notGroup:"Notary Services Group",
    addrTitle:"Official Addresses of \"Omad Tour\"",
    office1title:"Office 1",
    office1:"Tekhnologicheskiy Institut metro station, 4th Krasnoarmeyskaya Street, building 3. Intercom: 22B. \"Omad Tour\" office.",
    office2title:"Office 2",
    office2:"Dybenko metro station, Bolshevikov Avenue, building 24, block 1.",
    map1:"Tekhnologicheskiy Institut Metro Station",
    map2:"Dybenko Metro Station",
    helpText:"You are in the Help section. Here you may leave feedback regarding our website, service quality, or any other matter. The \"Omad Tour\" team is always ready to assist you.",
    helpPh:"Please write your feedback here",
    mon:["January","February","March","April","May","June","July","August","September","October","November","December"],
    dow:["Mo","Tu","We","Th","Fr","Sa","Su"],
    vizaFrameNote:"If the page does not open in this window",
    newsTitle:"News",
    loading:"Loading",
    contactUs:"Contact Us",
    vizaSubmitBtn:"Check Your Visa Through Us",
    vizaSubmitText:"Please upload a photo of your application form or passport and leave your phone number — our specialist will contact you shortly.",
    vizaAttention:"Please send a photo of your application form",
    yourPhone:"Phone Number",
    uploadPhoto:"Upload Document Photo",
    submitSuccess:"Your request has been received. We will contact you shortly.",
    submitFail:"An error occurred while sending. Please check your internet connection and try again.",
    helpFieldLabel:"Your Feedback",
    myVisaStatus:"My Request Status",
    statusNewTitle:"Under Review",
    statusNewText:"Your request has been sent to our specialist. Please wait for it to be reviewed and answered.",
    statusReadyTitle:"Result Ready",
    statusReadyText:"The result of your application is ready. To receive your visa, please visit the Consulate General of the Republic of Uzbekistan in person and meet with the consul. Please note: our service covers only the completion of the application form — the visa itself is issued solely by the Consulate.",
    statusPendingTitle:"Not Ready Yet",
    statusPendingText:"Your request is still being reviewed — please wait a little longer. If you wish, you may contact the official Telegram group of the Consulate General of the Republic of Uzbekistan in Saint Petersburg, or request a meeting.",
    noVisaRequest:"You have not submitted any requests yet.",
    inAppWarning:"Please note: you are viewing this site inside an app's built-in browser (e.g. Telegram, WhatsApp, Imo). Some apps restrict connections to external services in this mode, which may prevent photo uploads or request submissions. For the most reliable experience, please open this link in your phone's main browser (Safari or Chrome).",
    copyLink:"Copy Link",
    linkCopied:"Link copied",
    langName:"English"
  }
};

/* ---------------- CITY DATA ---------------- */
const RU_CITIES = [
  { id:"moskva", flag:"🇷🇺", name:{uz:"Moskva",ru:"Москва",en:"Moscow"},
    airports:[
      {id:"svo", name:{uz:"Sheremetyevo",ru:"Шереметьево",en:"Sheremetyevo"}},
      {id:"dme", name:{uz:"Domodedovo",ru:"Домодедово",en:"Domodedovo"}},
      {id:"vko", name:{uz:"Vnukovo",ru:"Внуково",en:"Vnukovo"}},
      {id:"zia", name:{uz:"Jukovskiy",ru:"Жуковский",en:"Zhukovsky"}}
    ]},
  { id:"spb", flag:"🇷🇺", name:{uz:"Sankt-Peterburg",ru:"Санкт-Петербург",en:"Saint Petersburg"} },
  { id:"ekb", flag:"🇷🇺", name:{uz:"Yekaterinburg",ru:"Екатеринбург",en:"Yekaterinburg"} },
  { id:"nsk", flag:"🇷🇺", name:{uz:"Novosibirsk",ru:"Новосибирск",en:"Novosibirsk"} },
  { id:"kzn", flag:"🇷🇺", name:{uz:"Qozon",ru:"Казань",en:"Kazan"} },
  { id:"ufa", flag:"🇷🇺", name:{uz:"Ufa",ru:"Уфа",en:"Ufa"} },
  { id:"krd", flag:"🇷🇺", name:{uz:"Krasnodar",ru:"Краснодар",en:"Krasnodar"} },
  { id:"oms", flag:"🇷🇺", name:{uz:"Omsk",ru:"Омск",en:"Omsk"} },
  { id:"rnd", flag:"🇷🇺", name:{uz:"Rostov",ru:"Ростов",en:"Rostov"} },
  { id:"vog", flag:"🇷🇺", name:{uz:"Volgograd",ru:"Волгоград",en:"Volgograd"} },
  { id:"che", flag:"🇷🇺", name:{uz:"Chelyabinsk",ru:"Челябинск",en:"Chelyabinsk"} },
  { id:"kja", flag:"🇷🇺", name:{uz:"Krasnoyarsk",ru:"Красноярск",en:"Krasnoyarsk"} }
];
const UZ_CITIES = [
  { id:"tas", flag:"🇺🇿", name:{uz:"Toshkent",ru:"Ташкент",en:"Tashkent"} },
  { id:"sam", flag:"🇺🇿", name:{uz:"Samarqand",ru:"Самарканд",en:"Samarkand"} },
  { id:"buh", flag:"🇺🇿", name:{uz:"Buxoro",ru:"Бухара",en:"Bukhara"} },
  { id:"nam", flag:"🇺🇿", name:{uz:"Namangan",ru:"Наманган",en:"Namangan"} },
  { id:"and", flag:"🇺🇿", name:{uz:"Andijon",ru:"Андижан",en:"Andijan"} },
  { id:"fer", flag:"🇺🇿", name:{uz:"Farg'ona",ru:"Фергана",en:"Fergana"} },
  { id:"nav", flag:"🇺🇿", name:{uz:"Navoiy",ru:"Навои",en:"Navoi"} },
  { id:"urg", flag:"🇺🇿", name:{uz:"Urganch",ru:"Ургенч",en:"Urgench"} },
  { id:"ter", flag:"🇺🇿", name:{uz:"Termiz",ru:"Термез",en:"Termez"} },
  { id:"qar", flag:"🇺🇿", name:{uz:"Qarshi",ru:"Карши",en:"Karshi"} }
];

/* ---------------- ICONS ---------------- */
const ICONS = {
  bell:'<svg viewBox="0 0 24 24"><path d="M12 3c-3.3 0-5.5 2.5-5.5 5.8v3.4c0 .5-.2 1-.5 1.4l-1.3 1.6c-.5.6-.1 1.5.7 1.5h13.2c.8 0 1.2-.9.7-1.5l-1.3-1.6c-.3-.4-.5-.9-.5-1.4V8.8C17.5 5.5 15.3 3 12 3z" fill="currentColor"/><path d="M9.7 19a2.3 2.3 0 004.6 0h-4.6z" fill="currentColor"/></svg>',
  megaphone:'<svg viewBox="0 0 24 24"><path d="M3 10v4a1 1 0 001 1h2l1.4 4.3a1 1 0 00.95.7H10a1 1 0 00.95-1.3L9.6 15H10l9 4V5l-9 4H4a1 1 0 00-1 1z" fill="currentColor"/></svg>',
  attach:'<svg viewBox="0 0 24 24"><path d="M8 12.5l6.5-6.5a3 3 0 014.2 4.2L11.5 17.4a5 5 0 01-7-7L12 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  sun:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 2.5v2.3M12 19.2v2.3M21.5 12h-2.3M4.8 12H2.5M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6"/></g></svg>',
  moon:'<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" fill="currentColor"/></svg>',
  plane:'<svg viewBox="0 0 24 24"><path d="M21.5 3.5c.6 0 .9.5.7 1.1L17.4 18c-.2.6-1 .7-1.4.2l-3.1-4.3-4.3-3.1c-.5-.4-.4-1.2.2-1.4l12.7-5.9z" fill="#fbe9f0"/><path d="M12.9 13.9L9 21l-1.3-3.5L4.2 16.2 12.9 13.9z" fill="#fbe9f0" opacity=".75"/></svg>',
  visa:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.4" fill="none" stroke="#fbe9f0" stroke-width="1.5"/><circle cx="8" cy="10.2" r="2" fill="#fbe9f0"/><path d="M5 16c.6-1.8 2-2.6 3-2.6s2.4.8 3 2.6" stroke="#fbe9f0" stroke-width="1.4" stroke-linecap="round" fill="none"/><path d="M14 8.8h5.2M14 12h5.2M14 15.2h3.4" stroke="#fbe9f0" stroke-width="1.4" stroke-linecap="round"/></svg>',
  notary:'<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" fill="none" stroke="#fbe9f0" stroke-width="1.5" stroke-linejoin="round"/><path d="M15 3v4h4" stroke="#fbe9f0" stroke-width="1.5" stroke-linejoin="round" fill="none"/><circle cx="9.5" cy="14" r="2.5" stroke="#fbe9f0" stroke-width="1.3" fill="none"/><path d="M8.3 16.2L6.6 20l2.9-1 2.9 1-1.7-3.8" stroke="#fbe9f0" stroke-width="1.2" stroke-linejoin="round" fill="none"/></svg>',
  group:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" fill="#fbe9f0"/><circle cx="17" cy="9.5" r="2.4" fill="#fbe9f0" opacity=".65"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6" stroke="#fbe9f0" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M15.2 14.3c2.6.2 4.3 2.6 4.3 5.7" stroke="#fbe9f0" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".65"/></svg>',
  pin:'<svg viewBox="0 0 24 24"><path d="M12 22s7.5-7 7.5-12.5S16.6 2 12 2 4.5 4.9 4.5 9.5 12 22 12 22z" fill="#fbe9f0"/><circle cx="12" cy="9.6" r="3" fill="#0a1a4d"/></svg>',
  help:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#fbe9f0" stroke-width="1.5"/><path d="M9.2 9.4a2.9 2.9 0 015.6.9c0 1.9-2.7 2.2-2.7 4.1" stroke="#fbe9f0" stroke-width="1.6" stroke-linecap="round" fill="none"/><circle cx="12" cy="17.4" r="1" fill="#fbe9f0"/></svg>',
  telegram:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#2AABEE"/><path d="M17.5 7.2L15.7 17c-.14.6-.5.75-1 .46l-2.8-2.06-1.35 1.3c-.15.15-.28.28-.56.28l.2-2.86 5.2-4.7c.23-.2-.05-.32-.35-.12l-6.4 4-2.77-.87c-.6-.19-.6-.6.13-.88l10.8-4.16c.5-.18.94.12.78.9z" fill="#fff"/></svg>',
  whatsapp:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#25D366"/><path d="M12 5.5a6.5 6.5 0 00-5.6 9.8L5.5 18.5l3.3-.9A6.5 6.5 0 1012 5.5z" fill="#fff"/><path d="M9.4 8.9c.15-.32.3-.33.44-.33.12 0 .26 0 .37.02.13.02.29-.05.45.36.17.44.58 1.5.63 1.6.05.1.08.22 0 .35-.07.14-.1.22-.2.34-.1.12-.22.27-.31.36-.1.1-.21.2-.1.4.12.2.53.9 1.15 1.44.8.7 1.46.93 1.66 1.03.2.1.32.09.44-.05.13-.14.53-.6.67-.8.14-.2.28-.17.46-.1.19.07 1.2.57 1.4.68.2.1.33.15.38.25.05.1.05.55-.14 1.08-.19.52-1.1.98-1.5 1.02-.4.04-.75.2-2.53-.55-2.14-.9-3.5-3.1-3.6-3.25-.1-.14-.86-1.13-.86-2.16 0-1.03.53-1.53.7-1.75z" fill="#25D366"/></svg>',
  sms:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#7B61FF"/><path d="M7 8.5h10a1 1 0 011 1V15a1 1 0 01-1 1H10l-3 2v-2H7a1 1 0 01-1-1V9.5a1 1 0 011-1z" fill="#fff"/></svg>',
  max:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#3D3DFF"/><path d="M6.5 15.5V9l3.4 4.2L13.3 9v6.5M15.3 9v6.5h2.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  imo:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#12B7F5"/><path d="M6 15.5V9.2c0-.4.5-.6.8-.3l5.2 5.1 5.2-5.1c.3-.3.8-.1.8.3v6.3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#e8354f"/><path d="M8 7.3c.2-.5.6-.8 1.1-.8h1c.4 0 .8.3.9.7l.5 1.6c.1.4 0 .8-.3 1l-.7.6c.5 1.2 1.5 2.2 2.7 2.7l.6-.7c.2-.3.6-.4 1-.3l1.6.5c.4.1.7.5.7.9v1c0 .5-.3.9-.8 1.1-3.6 1.1-7.9-3.2-8.8-8.3z" fill="#fff"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,.15)"/><path d="M9 15l6-6M10 8h5v5" stroke="#fbe9f0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
function iconCircle(svg){ return `<span class="icon-circle">${svg}</span>`; }

/* ---------------- CONTACTS (fixed data) ---------------- */
const AVIA_CONTACTS = { telegram:"@OMAD_TOUR9094", whatsapp:"+79811939094", max:"https://max.ru/u/f9LHodD0cOLLpEmAWC_I3iUUWcn5IO6DFYg0IVz4jEXfm6BJP6OL-L7V0jk", sms:"+79811939094" };
const VISA_LINK = "https://visa.mfa.uz/ruxsat/view";
const VISA_GROUP_LINK = "https://t.me/+i8I6ByH_CUVhOWQy";
const VISA_EXPERTS = { whatsapp:"+79379499094", telegram:"@AVIAKASSA9094", imo:"https://s.imoim.net/YjQs3q", max:"https://max.ru/u/f9LHodD0cOJaELTBZjr7sN80Fj00VmAedMQocRbVn-m6rT9ghyijTCqXh-Y", call:"+79379499094" };
const NOTARIAL_CONTACTS = { whatsapp:"+79516772147", telegram:"@Azazello1989", call:"+79516772147" };
const TOUR_CONTACTS = { telegram:"@kassauzpiter", whatsapp:"+7 960 258 7430", max:"https://max.ru/u/f9LHodD0cOK2bI0WOsyRYbB6SdG1U7rUqtPR9PKAz2C9N-YCIgtI8ifkbL0", call:"+7 960 258 7430" };
const GROUP_LINKS = {
  tgAvia:"https://t.me/+OW_pzYSHjIA5NmQy",
  waAvia:"https://chat.whatsapp.com/KgnvfhpMYso6lSX3kbNd4l?mode=gi_t",
  consGroup: VISA_GROUP_LINK,
  notary:"https://t.me/biletispbuz"
};
const MAP_LINKS = { m1:"https://yandex.ru/maps/-/CLaRUCPW", m2:"https://yandex.ru/maps/-/CLBoFJ8I" };
const HELP_EMAIL = "omadru@bk.ru";

/* ---------------- HELPERS ---------------- */
function t(key){ return T[LANG][key] || key; }
function escapeHtml(str){
  if(str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function cityName(c){ return c.name[LANG]; }
function telHref(num){ return "tel:" + num.replace(/[^\d+]/g,""); }
function smsHref(num, body){ return "sms:" + num.replace(/[^\d+]/g,"") + (body ? ("?body="+encodeURIComponent(body)) : ""); }
function waHref(num, body){ return "https://wa.me/" + num.replace(/[^\d]/g,"") + (body ? ("?text="+encodeURIComponent(body)) : ""); }
function tgHref(handle){ return handle.startsWith("http") ? handle : "https://t.me/" + handle.replace("@",""); }

function pushScreen(name, opts){ history.push({name, opts}); render(); }
function goBack(){ if(history.length>1){ history.pop(); render(); } }
function goHome(){ resetBookingState(); history = [{name:"home"}]; render(); }

function setLang(l){
  if(!["uz","ru","en"].includes(l)) return;
  LANG = l;
  try{ localStorage.setItem("omad_lang", LANG); }catch(e){}
  document.documentElement.lang = LANG;
  render();
}


/* ---------------- UX HELPERS ---------------- */
let toastTimer = null;
function showToast(message){
  let toast = document.getElementById("appToast");
  if(!toast){
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove("show"), 2600);
}
function safeOpen(url){
  if(!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
function announceConnection(){
  if(!navigator.onLine) showToast(
    LANG==="uz" ? "Internet aloqasi yo‘q. Ba’zi funksiyalar ishlamasligi mumkin."
    : LANG==="ru" ? "Нет подключения к интернету. Некоторые функции могут быть недоступны."
    : "You are offline. Some features may be unavailable."
  );
}
function resetBookingState(){
  state.direction = null;
  state.fromCity = null;
  state.toCity = null;
  state.fromCustom = "";
  state.toCustom = "";
  state.date = null;
  const now = new Date();
  state.calMonth = now.getMonth();
  state.calYear = now.getFullYear();
}


function fx(uz, ru, en){
  return LANG==="uz" ? uz : LANG==="ru" ? ru : en;
}

function persistBookingDraft(){
  try{
    localStorage.setItem("omad_booking_draft", JSON.stringify({
      direction:state.direction, fromCity:state.fromCity, toCity:state.toCity,
      fromCustom:state.fromCustom, toCustom:state.toCustom, date:state.date
    }));
  }catch(e){}
}

function saveRecentRoute(){
  const from = state.fromCity || state.fromCustom;
  const to = state.toCity || state.toCustom;
  if(!from || !to) return;
  const item = {from, to, date: state.date || "", direction: state.direction || ""};
  try{
    const list = JSON.parse(localStorage.getItem("omad_recent_routes") || "[]");
    const next = [item, ...list.filter(x => !(x.from===item.from && x.to===item.to))].slice(0,5);
    localStorage.setItem("omad_recent_routes", JSON.stringify(next));
  }catch(e){}
}
function getRecentRoutes(){
  try{ return JSON.parse(localStorage.getItem("omad_recent_routes") || "[]"); }
  catch(e){ return []; }
}
let shareSheetClose = null;
let shareSheetTrigger = null;

function shareOmad(){
  const data = {
    title: "Omad Tour",
    text: fx("Omad Tour — aviachipta, viza va tur xizmatlari", "Omad Tour — авиабилеты, визы и туры", "Omad Tour — flights, visas and tour services"),
    url: window.location.href
  };
  if(navigator.share){
    navigator.share(data).catch(()=>{});
  }else{
    navigator.clipboard?.writeText(window.location.href);
    showToast(fx("Havola nusxalandi.", "Ссылка скопирована.", "Link copied."));
  }
}
function openQuickActions(){
  if(shareSheetClose){
    shareSheetClose();
    return;
  }
  const el = document.createElement("div");
  el.id = "shareSheet";
  el.className = "share-sheet";
  el.innerHTML = `
    <div class="share-head">
      <h3>${fx("Tezkor amallar","Быстрые действия","Quick actions")}</h3>
      <button class="share-close" id="shareCloseBtn" type="button" aria-label="${fx("Tezkor amallar oynasini yopish","Закрыть окно быстрых действий","Close quick actions")}" title="${fx("Yopish","Закрыть","Close")}">✕</button>
    </div>
    <div class="share-actions">
      <button class="glass-btn" id="shareNowBtn">${iconCircle(ICONS.link)}<span class="label">${fx("Ulashish","Поделиться","Share")}</span></button>
      <button class="glass-btn" id="copyNowBtn">${iconCircle(ICONS.link)}<span class="label">${fx("Havolani nusxalash","Скопировать ссылку","Copy link")}</span></button>
      <button class="glass-btn" id="supportNowBtn">${iconCircle(ICONS.help)}<span class="label">${fx("Yordam","Помощь","Support")}</span></button>
      <button class="glass-btn" id="statusNowBtn">${iconCircle(ICONS.visa)}<span class="label">${fx("Viza holati","Статус визы","Visa status")}</span></button>
    </div>
  `;
  const onOutside = (event)=>{
    if(!el.contains(event.target)) shareSheetClose?.();
  };
  shareSheetTrigger = document.activeElement;
  shareSheetClose = ()=>{
    document.removeEventListener("mousedown", onOutside, true);
    if(el.isConnected) el.remove();
    shareSheetClose = null;
    const focusTarget = shareSheetTrigger;
    shareSheetTrigger = null;
    if(focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
  };
  document.body.appendChild(el);
  document.addEventListener("mousedown", onOutside, true);
  el.querySelector("#shareCloseBtn").onclick = ()=> shareSheetClose?.();
  el.querySelector("#shareNowBtn").onclick = ()=>{ shareOmad(); shareSheetClose?.(); };
  el.querySelector("#copyNowBtn").onclick = async ()=>{
    try{
      await navigator.clipboard.writeText(window.location.href);
      showToast(fx("Havola nusxalandi.","Ссылка скопирована.","Link copied."));
    }catch(e){}
    shareSheetClose?.();
  };
  el.querySelector("#supportNowBtn").onclick = ()=>{ shareSheetClose?.(); pushScreen("help", {}); };
  el.querySelector("#statusNowBtn").onclick = ()=>{ shareSheetClose?.(); pushScreen("myVisaStatus", {}); };
  el.querySelector("#shareNowBtn")?.focus();
}

/* ---------------- RENDER ---------------- */
function render(){
  const app = document.getElementById("app");
  const cur = history[history.length-1];
  app.innerHTML = screenHTML(cur.name, cur.opts||{});
  bindEvents(cur.name, cur.opts||{});
}

function topbar(showBack){
  return `<div class="topbar">
    ${showBack ? `<button class="back-btn" id="backBtn">← ${t('back')}</button>` : `<div></div>`}
    <div class="spacer"></div>
    <div class="lang-switch">
      <button class="lang-btn ${LANG==='uz'?'active':''}" data-lang="uz">UZ 🇺🇿</button>
      <button class="lang-btn ${LANG==='ru'?'active':''}" data-lang="ru">RU 🇷🇺</button>
      <button class="lang-btn ${LANG==='en'?'active':''}" data-lang="en">EN 🇬🇧</button>
    </div>
  </div>`;
}

function screenHTML(name, opts){
  switch(name){
    case "home": return homeScreen();
    case "admin": return adminScreen();
    case "news": return newsScreen();
    case "vizaSubmitForm": return vizaSubmitFormScreen();
    case "myVisaStatus": return myVisaStatusScreen();
    case "aviaMenu": return aviaMenuScreen();
    case "tourServices": return tourServicesScreen();
    case "cityStep": return cityStepScreen(opts);
    case "otherCountry": return otherCountryScreen(opts);
    case "calendar": return calendarScreen(opts);
    case "contact": return contactScreen(opts);
    case "viza": return vizaScreen();
    case "notarial": return notarialScreen();
    case "groups": return groupsScreen();
    case "addresses": return addressesScreen();
    case "help": return helpScreen();
    default: return homeScreen();
  }
}

function homeScreen(){
  const unread = Math.max(0, (parseInt(localStorage.getItem("omad_news_cache_count")||"0")) - getNewsSeenCount());
  const draft = (()=>{ try{ return JSON.parse(localStorage.getItem("omad_booking_draft") || "null"); }catch(e){ return null; } })();
  const hasDraft = !!(draft && (draft.fromCity || draft.fromCustom));
  return `<div class="screen active">
    <div class="topbar">
      <button class="bell-btn" id="newsBellBtn" aria-label="${fx("Yangiliklar","Новости","News")}" title="${fx("Yangiliklar","Новости","News")}">${ICONS.bell}${unread>0 ? `<span class="badge" id="newsBadge">${unread}</span>` : `<span class="badge" id="newsBadge" style="display:none;"></span>`}</button>
      <button class="bell-btn" id="themeToggleBtn" style="margin-left:8px;" aria-label="${fx("Mavzuni almashtirish","Сменить тему","Toggle theme")}" title="${fx("Mavzuni almashtirish","Сменить тему","Toggle theme")}">${THEME==='dark' ? ICONS.sun : ICONS.moon}</button>
      <div class="spacer"></div>
      <div class="lang-switch">
        <button class="lang-btn ${LANG==='uz'?'active':''}" data-lang="uz">UZ 🇺🇿</button>
        <button class="lang-btn ${LANG==='ru'?'active':''}" data-lang="ru">RU 🇷🇺</button>
        <button class="lang-btn ${LANG==='en'?'active':''}" data-lang="en">EN 🇬🇧</button>
      </div>
    </div>
    <div class="home-scroll">
      <div class="logo-wrap"><div class="logo-circle" id="logoTap"><img src="${LOGO_SRC}" loading="lazy" decoding="async" onerror="this.style.display='none'; this.parentNode.innerHTML='<span style=\\'font-weight:800;font-size:12px;color:#3a0a26;text-align:center\\'>OMAD<br>TOUR</span>'"></div></div>
      ${isInAppBrowser() ? `<div class="inapp-warning" id="inappWarning">
        <span>${t('inAppWarning')}</span>
        <button class="glass-btn" id="copyLinkBtn" style="margin-top:8px;">${iconCircle(ICONS.link)}<span class="label">${t('copyLink')}</span></button>
      </div>` : ""}
      <p class="greeting">${t('greeting')}</p>
      <div class="menu-list">
        <button class="glass-btn accent-1" data-go="aviaMenu">${iconCircle(ICONS.plane)}<span class="label-col"><span class="label">${t('aviabilet')}</span><span class="sub">${t('aviabiletSub')}</span></span><span class="arrow">→</span></button>
        <button class="glass-btn accent-2" data-go="viza">${iconCircle(ICONS.visa)}<span class="label-col"><span class="label">${t('viza')}</span><span class="sub">${t('vizaSub')}</span></span><span class="arrow">→</span></button>
        <button class="glass-btn accent-3" data-go="notarial">${iconCircle(ICONS.notary)}<span class="label-col"><span class="label">${t('notarial')}</span><span class="sub">${t('notarialSub')}</span></span><span class="arrow">→</span></button>
        <button class="glass-btn accent-4" data-go="groups">${iconCircle(ICONS.group)}<span class="label-col"><span class="label">${t('guruhlar')}</span><span class="sub">${t('guruhlarSub')}</span></span><span class="arrow">→</span></button>
        <button class="glass-btn accent-5" data-go="addresses">${iconCircle(ICONS.pin)}<span class="label-col"><span class="label">${t('manzillar')}</span><span class="sub">${t('manzillarSub')}</span></span><span class="arrow">→</span></button>
        <button class="glass-btn accent-6" data-go="help">${iconCircle(ICONS.help)}<span class="label-col"><span class="label">${t('yordam')}</span><span class="sub">${t('yordamSub')}</span></span><span class="arrow">→</span></button>
      </div>
      <div class="home-tools">
        <button class="tool-card" id="quickActionsBtn">
          <span class="tool-icon">${iconCircle(ICONS.link)}</span>
          <span><span class="tool-title">${fx("Tezkor amallar","Быстрые действия","Quick actions")}</span><span class="tool-sub">${fx("Ulashish, yordam, holat","Ссылка, помощь, статус","Share, support, status")}</span></span>
        </button>
        <button class="tool-card" id="visaStatusHomeBtn">
          <span class="tool-icon">${iconCircle(ICONS.visa)}</span>
          <span><span class="tool-title">${fx("Viza holatini tekshirish","Проверить визу","Check visa status")}</span><span class="tool-sub">${fx("Ariza natijasini ko‘ring","Проверьте результат","Track your application")}</span></span>
        </button>
        <button class="tool-card" id="faqQuickBtn">
          <span class="tool-icon">${iconCircle(ICONS.help)}</span>
          <span><span class="tool-title">${fx("Tezkor savol-javob","Быстрые вопросы","Quick FAQ")}</span><span class="tool-sub">${fx("Yordam va yo‘riqnomalar","Подсказки и поддержка","Help and guidance")}</span></span>
        </button>
        <button class="tool-card" id="officeHoursBtn">
          <span class="tool-icon">${iconCircle(ICONS.phone)}</span>
          <span><span class="tool-title">${fx("Aloqa vaqtlari","Часы связи","Contact hours")}</span><span class="tool-sub">${fx("Ish vaqti va tez bog‘lanish","Время работы и контакт","Office hours & contact")}</span></span>
        </button>
      </div>
      ${hasDraft ? `<button class="glass-btn" id="resumeBookingBtn">${iconCircle(ICONS.plane)}<span class="label">${fx("Avvalgi bronni davom ettirish","Продолжить прошлое бронирование","Resume previous booking")}</span><span class="arrow">→</span></button>` : ""}
      ${(() => {
        const recent = getRecentRoutes()[0];
        return recent ? `<div class="recent-box">
          <h3>${fx("So‘nggi yo‘nalish","Последний маршрут","Recent route")}</h3>
          <div class="recent-route"><span>${escapeHtml(recent.from)} → ${escapeHtml(recent.to)}</span><small>${escapeHtml(recent.date || "")}</small></div>
        </div>` : "";
      })()}
    </div>
  </div>`;
}

function aviaMenuScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('aviabilet')}</h2>
    <div class="section-text">${t('aviaMenuText')}</div>
    <div class="menu-list" style="margin-top:6px;">
      <button class="glass-btn" data-go="cityStep" data-direction="ru-uz" data-step="0">${iconCircle(ICONS.plane)}<span class="label">${t('ru_uz')}</span><span class="arrow">→</span></button>
      <button class="glass-btn" data-go="cityStep" data-direction="uz-ru" data-step="0">${iconCircle(ICONS.plane)}<span class="label">${t('uz_ru')}</span><span class="arrow">→</span></button>
      <button class="glass-btn" data-go="otherCountry" data-step="0">${iconCircle(ICONS.plane)}<span class="label">${t('other')}</span><span class="arrow">→</span></button>
      <button class="glass-btn" data-go="tourServices">${iconCircle(ICONS.plane)}<span class="label">${t('tourServices')}</span><span class="arrow">→</span></button>
    </div>
  </div>`;
}

function cityStepScreen(opts){
  const direction = opts.direction;
  const step = opts.step || 0;
  // ru-uz: step0 = choose RU city (from), step1 = choose UZ city (to)
  // uz-ru: step0 = choose UZ city (from), step1 = choose RU city (to)
  let listData, promptKey, flagSet;
  if(direction==="ru-uz"){
    listData = step===0 ? RU_CITIES : UZ_CITIES;
    promptKey = step===0 ? "chooseRuCity" : "chooseUzCity";
  } else {
    listData = step===0 ? UZ_CITIES : RU_CITIES;
    promptKey = step===0 ? "chooseUzCityFrom" : "chooseRuCityTo";
  }
  const rows = listData.map(c => {
    if(c.airports){
      const subRows = c.airports.map(ap => `<button class="glass-btn" data-city="${c.id} - ${ap.name[LANG]}" data-direction="${direction}" data-step="${step}">${iconCircle(ICONS.plane)}<span class="label">${c.flag} ${ap.name[LANG]}</span></button>`).join("");
      return `<button class="glass-btn" data-city="${c.id}" data-direction="${direction}" data-step="${step}" data-expand="${c.id}">${iconCircle(ICONS.plane)}<span class="label">${c.flag} ${cityName(c)}</span><span class="arrow">▾</span></button>
      <div class="airport-sub" id="sub-${c.id}" style="display:none;">${subRows}</div>`;
    }
    return `<button class="glass-btn" data-city="${cityName(c)}" data-direction="${direction}" data-step="${step}">${iconCircle(ICONS.plane)}<span class="label">${c.flag} ${cityName(c)}</span></button>`;
  }).join("");

  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t(promptKey)}</h2>
    <div class="list-col">${rows}</div>
  </div>`;
}

function otherCountryScreen(opts){
  const step = opts.step || 0;
  if(step===0){
    return `<div class="screen active">
      ${topbar(true)}
      <h2 class="title">${t('other')}</h2>
      <label class="field-label" for="fromInput">${t('otherFromLabel')}<span class="required-star">*</span></label>
      <input type="text" id="fromInput" placeholder="${t('otherFromPh')}" aria-required="true" aria-describedby="fromErr" aria-invalid="false">
      <div class="error-msg" id="fromErr" role="alert">${t('required')}</div>
      <button class="primary-btn" id="otherNextBtn">${t('next')}</button>
    </div>`;
  }
  if(step===1){
    return `<div class="screen active">
      ${topbar(true)}
      <h2 class="title">${t('other')}</h2>
      <label class="field-label" for="toInput">${t('otherToLabel')}<span class="required-star">*</span></label>
      <input type="text" id="toInput" placeholder="${t('otherToPh')}" aria-required="true" aria-describedby="toErr" aria-invalid="false">
      <div class="error-msg" id="toErr" role="alert">${t('required')}</div>
      <button class="primary-btn" id="otherNextBtn2">${t('next')}</button>
    </div>`;
  }
}

function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function calendarInnerHTML(){
  const y = state.calYear, m = state.calMonth;
  const first = new Date(y,m,1).getDay(); // 0=Sun
  const offset = (first+6)%7; // make Monday first
  const total = daysInMonth(y,m);
  const today = new Date(); today.setHours(0,0,0,0);
  let cells = "";
  for(let i=0;i<offset;i++) cells += `<span class="cal-day empty" aria-hidden="true"></span>`;
  for(let d=1; d<=total; d++){
    const thisDate = new Date(y,m,d);
    const isPast = thisDate < today;
    const isSel = state.date && state.date.getFullYear()===y && state.date.getMonth()===m && state.date.getDate()===d;
    cells += `<button type="button" class="cal-day ${isPast?'past':''} ${isSel?'selected':''}" data-day="${d}" ${isPast?'disabled':''} aria-pressed="${isSel ? "true" : "false"}">${d}</button>`;
  }
  const dow = t('dow').map(d=>`<div class="cal-dow">${d}</div>`).join("");
  return `<div class="cal-head">
        <button class="cal-nav-btn" id="prevMonth">‹</button>
        <div class="cal-month-label">${t('mon')[m]} ${y}</div>
        <button class="cal-nav-btn" id="nextMonth">›</button>
      </div>
      <div class="cal-grid">${dow}${cells}</div>`;
}
function calendarScreen(opts){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('chooseDate')}</h2>
    <div class="calendar-card" id="calCard">${calendarInnerHTML()}</div>
  </div>`;
}

function buildSummaryText(){
  const from = state.direction==="other" ? state.fromCustom : state.fromCity;
  const to = state.direction==="other" ? state.toCustom : state.toCity;
  const dateStr = state.date ? `${state.date.getDate()} ${t('mon')[state.date.getMonth()]} ${state.date.getFullYear()}` : "";
  return `Omad Tour\n${t('from')}: ${from}\n${t('to')}: ${to}\n${t('date')}: ${dateStr}`;
}

let lastContactSummary = "";
function tgShareHref(text){
  return `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
}
function contactScreen(opts){
  const summary = escapeHtml(buildSummaryText()).replace(/\n/g,"<br>");
  const c = AVIA_CONTACTS;
  const bodyText = buildSummaryText();
  lastContactSummary = bodyText;
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('chooseContact')}</h2>
    <div class="contact-summary"><b>${t('ticketSummary')}:</b><br>${summary}</div>
    <div class="contact-list">
      <a class="glass-btn" href="${tgShareHref(bodyText)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">Telegram</span></a>
      <a class="glass-btn" href="${waHref(c.whatsapp, bodyText)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.whatsapp)}<span class="label">WhatsApp</span></a>
      <a class="glass-btn" href="${c.max}" target="_blank" rel="noopener noreferrer" id="contactMaxBtn">${iconCircle(ICONS.max)}<span class="label">Max</span></a>
      <a class="glass-btn" href="${smsHref(c.sms, bodyText)}">${iconCircle(ICONS.sms)}<span class="label">SMS</span></a>
    </div>
    <div class="footer-note">${LANG==='uz'?"Telegram: matn tayyor holda ochiladi — faqat \"Omad Tour\" chatini (yoki xohlagan chatni) tanlab, Yuborish tugmasini bosing. Max: matn avtomatik nusxalanadi, chatda bosib turib qo'ying (paste).":(LANG==='ru'?"Telegram: текст уже готов — просто выберите чат \"Omad Tour\" и нажмите Отправить. Max: текст копируется автоматически, вставьте его в чате (paste).":"Telegram: the text is ready — just pick the \"Omad Tour\" chat and hit Send. Max: the text is copied automatically, paste it in the chat.")}</div>
  </div>`;
}

function vizaScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('viza')}</h2>
    <div class="section-text">${t('vizaText')}</div>
    <div class="list-col">
      <a class="glass-btn" href="${VISA_LINK}">${iconCircle(ICONS.visa)}<span class="label">${t('vizaCheck')}</span></a>
      <a class="glass-btn" href="${VISA_GROUP_LINK}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">${t('vizaGroup')}</span></a>
      <button class="glass-btn glass-btn-red" data-go="vizaSubmitForm">${iconCircle(ICONS.visa)}<span class="label">${t('vizaSubmitBtn')}</span><span class="arrow">→</span></button>
      <button class="glass-btn" data-go="myVisaStatus">${iconCircle(ICONS.bell)}<span class="label">${t('myVisaStatus')}</span><span class="arrow">→</span></button>
    </div>
    <h2 class="title" style="margin-top:20px;">${t('vizaExperts')}</h2>
    <div class="list-col">
      <button class="glass-btn" id="expertsToggle">${iconCircle(ICONS.help)}<span class="label">${t('contactUs')}</span><span class="arrow" id="expertsArrow">▾</span></button>
      <div class="list-col" id="expertsList" style="display:none;">
        <a class="glass-btn" href="${waHref(VISA_EXPERTS.whatsapp)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.whatsapp)}<span class="label">WhatsApp</span></a>
        <a class="glass-btn" href="${tgHref(VISA_EXPERTS.telegram)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">Telegram</span></a>
        <a class="glass-btn" href="${VISA_EXPERTS.imo}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.imo)}<span class="label">Imo</span></a>
        <a class="glass-btn" href="${VISA_EXPERTS.max}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.max)}<span class="label">Max</span></a>
        <a class="glass-btn" href="${telHref(VISA_EXPERTS.call)}">${iconCircle(ICONS.phone)}<span class="label">${t('call')}</span></a>
      </div>
    </div>
  </div>`;
}

function tourServicesScreen(){
  const c = TOUR_CONTACTS;
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('tourServices')}</h2>
    <div class="section-text">${t('tourServicesText')}</div>
    <div class="list-col">
      <a class="glass-btn" href="${tgHref(c.telegram)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">Telegram</span></a>
      <a class="glass-btn" href="${waHref(c.whatsapp)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.whatsapp)}<span class="label">WhatsApp</span></a>
      <a class="glass-btn" href="${c.max}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.max)}<span class="label">Max</span></a>
      <a class="glass-btn" href="${telHref(c.call)}">${iconCircle(ICONS.phone)}<span class="label">${t('directCall')}</span></a>
    </div>
  </div>`;
}

function newsScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('newsTitle')}</h2>
    <div id="newsListContainer"><div class="loading-skeleton" aria-label="${t('loading')}"></div></div>
  </div>`;
}

function dropzoneHTML(prefix, label){
  return `<input type="file" id="${prefix}FileInput" accept="image/*" style="display:none;">
    <div class="upload-box" id="${prefix}Box">
      <div class="upload-empty" id="${prefix}Empty">
        <span class="upload-folder-icon">📁</span>
        <span>${label}</span>
      </div>
      <div class="upload-preview" id="${prefix}Preview" style="display:none;">
        <img id="${prefix}Thumb" src="" alt="">
        <div class="upload-info">
          <span id="${prefix}FileName"></span>
          <span id="${prefix}FileSize" class="upload-filesize"></span>
        </div>
        <button type="button" class="upload-remove" id="${prefix}RemoveBtn">✕</button>
      </div>
    </div>`;
}

function myVisaStatusScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('myVisaStatus')}</h2>
    <div id="myVisaStatusContainer"><div class="loading-skeleton" aria-label="${t('loading')}"></div></div>
  </div>`;
}

function vizaSubmitFormScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('vizaSubmitBtn')}</h2>
    <div class="section-text">${t('vizaSubmitText')}</div>
    <div class="attention-pulse">${t('vizaAttention')}</div>
    <div class="field-label" style="margin-top:0;">${t('uploadPhoto')}<span class="required-star">*</span></div>
    ${dropzoneHTML('viza', t('uploadPhoto'))}
    <div class="error-msg" id="vizaFileErr">${t('required')}</div>
    <label class="field-label" for="vizaPhoneInput">${t('yourPhone')}<span class="required-star">*</span></label>
    <input type="tel" inputmode="tel" autocomplete="tel" id="vizaPhoneInput" placeholder="+7 900 123-45-67" aria-required="true" aria-describedby="vizaPhoneErr" aria-invalid="false">
    <div class="error-msg" id="vizaPhoneErr" role="alert">${t('required')}</div>
    <button class="primary-btn" id="vizaSubmitBtnEl">${t('send')}</button>
    <div class="footer-note" id="vizaSubmitStatus" style="min-height:16px;"></div>
  </div>`;
}

function notarialScreen(){
  const c = NOTARIAL_CONTACTS;
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('notarial')}</h2>
    <div class="section-text">${t('notarialText')}</div>
    <div class="list-col">
      <a class="glass-btn" href="${waHref(c.whatsapp)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.whatsapp)}<span class="label">WhatsApp</span></a>
      <a class="glass-btn" href="${tgHref(c.telegram)}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">Telegram</span></a>
      <a class="glass-btn" href="${telHref(c.call)}">${iconCircle(ICONS.phone)}<span class="label">${t('call')}</span></a>
    </div>
  </div>`;
}

function groupsScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('guruhlar')}</h2>
    <div class="section-text">${t('groupsText')}</div>
    <div class="list-col">
      <a class="glass-btn" href="${GROUP_LINKS.tgAvia}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">${t('tgAviaGroup')}</span></a>
      <a class="glass-btn" href="${GROUP_LINKS.waAvia}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.whatsapp)}<span class="label">${t('waAviaGroup')}</span></a>
      <a class="glass-btn" href="${GROUP_LINKS.consGroup}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.telegram)}<span class="label">${t('consGroup')}</span></a>
      <a class="glass-btn" href="${GROUP_LINKS.notary}" target="_blank" rel="noopener noreferrer">${iconCircle(ICONS.notary)}<span class="label">${t('notGroup')}</span></a>
    </div>
  </div>`;
}

function addressesScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('addrTitle')}</h2>
    <div class="addr-block"><b>${t('office1title')}</b><br>${t('office1')}</div>
    <div class="addr-block" style="animation-delay:.1s;"><b>${t('office2title')}</b><br>${t('office2')}</div>
    <div class="list-col">
      <a class="glass-btn" href="${MAP_LINKS.m1}" target="_blank" rel="noopener noreferrer"><span class="icon-circle" style="overflow:hidden;background:#fff;padding:4px;"><img src="${LOGO_SRC}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" onerror="this.style.display='none'; this.parentNode.innerHTML='<span style=\'font-weight:800;font-size:11px;color:#3a0a26\'>OT</span>'"></span><span class="label">${t('map1')}</span></a>
      <a class="glass-btn" href="${MAP_LINKS.m2}" target="_blank" rel="noopener noreferrer"><span class="icon-circle" style="overflow:hidden;background:#fff;padding:4px;"><img src="${LOGO_SRC}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;" onerror="this.style.display='none'; this.parentNode.innerHTML='<span style=\'font-weight:800;font-size:11px;color:#3a0a26\'>OT</span>'"></span><span class="label">${t('map2')}</span></a>
    </div>
  </div>`;
}

function adminScreen(){
  const bucketSection = `<div class="section-text" style="border-color:rgba(60,200,120,.4);"><b>✅ Ulashilgan xotira faol va serverga o'rnatilgan.</b> Barcha ma'lumotlar (yangiliklar, viza so'rovlari) endi qaysi qurilma yoki brauzerdan kirilishidan qat'iy nazar bir xilda ko'rinadi.</div>`;
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">Admin panel</h2>
    ${bucketSection}

    <h2 class="title" style="margin-top:8px;"><span class="inline-icon">${ICONS.megaphone}</span> Yangiliklar</h2>
    <textarea id="newsInput" placeholder="Yangi xabar matnini yozing..."></textarea>
    <div class="field-label" style="margin-top:0;">Rasm (ixtiyoriy)</div>
    ${dropzoneHTML('news', "Rasm qo'shish (ixtiyoriy)")}
    <button class="primary-btn" id="newsAddBtn" style="margin-bottom:14px;">Yangilik qo'shish</button>
    <div class="footer-note" id="newsAddStatus" style="min-height:16px;"></div>
    <div id="adminNewsList"><div class="footer-note">${t('loading')}</div></div>

    <h2 class="title" style="margin-top:22px;">Xavfli hudud</h2>
    <div class="section-text" style="border-color:rgba(232,53,79,.4);">Bu tugma barcha eski/sinov viza so'rovlarini butunlay o'chiradi. Faqat sinov ma'lumotlaridan tozalash uchun ishlating — haqiqiy mijoz so'rovlari kelgandan so'ng bosmang.</div>
    <button class="primary-btn" id="resetVisaBtn" style="background:#8a1c30;">Eski viza so'rovlarini tozalash</button>
    <div class="footer-note" id="resetVisaStatus" style="min-height:16px;"></div>
  </div>`;
}

function helpScreen(){
  return `<div class="screen active">
    ${topbar(true)}
    <h2 class="title">${t('yordam')}</h2>
    <div class="section-text">${t('helpText')}</div>
    <label class="field-label" for="helpInput">${t('helpFieldLabel')}<span class="required-star">*</span></label>
    <div class="help-textarea-wrap">
      <textarea id="helpInput" placeholder="${t('helpPh')}" aria-required="true" aria-describedby="helpErr" aria-invalid="false"></textarea>
      <input type="file" id="helpFileInput" accept="image/*" style="display:none;">
      <button type="button" class="help-attach-btn" id="helpAttachBtn" aria-label="${fx("Rasm biriktirish","Прикрепить изображение","Attach image")}" title="${fx("Rasm biriktirish","Прикрепить изображение","Attach image")}">${ICONS.attach}</button>
      <img id="helpAttachThumb" class="help-attach-thumb" style="display:none;">
    </div>
    <div class="error-msg" id="helpErr" role="alert">${t('required')}</div>
    <button class="primary-btn" id="helpSendBtn">${t('send')}</button>
    <div class="footer-note" id="helpStatus" style="min-height:16px;"></div>
  </div>`;
}

/* ---------------- EVENTS ---------------- */
function bindEvents(name, opts){
  document.querySelectorAll(".glass-btn").forEach(btn=>{
    btn.addEventListener("click", function(e){
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = (e.clientX - rect.left - size/2) + "px";
      ripple.style.top = (e.clientY - rect.top - size/2) + "px";
      btn.appendChild(ripple);
      setTimeout(()=> ripple.remove(), 600);
    });
  });
  document.getElementById("backBtn")?.addEventListener("click", goBack);
  document.querySelectorAll(".lang-btn").forEach(b=>{
    b.addEventListener("click", ()=> setLang(b.dataset.lang));
  });
  document.querySelectorAll("[data-go]").forEach(b=>{
    b.addEventListener("click", (e)=>{
      const go = b.dataset.go;
      if(go==="cityStep"){ pushScreen("cityStep", {direction:b.dataset.direction, step: parseInt(b.dataset.step)}); }
      else if(go==="otherCountry"){ pushScreen("otherCountry", {step:0}); }
      else { pushScreen(go, {}); }
    });
  });

  if(name==="cityStep"){
    document.querySelectorAll("[data-expand]").forEach(b=>{
      b.addEventListener("click",(e)=>{
        e.stopPropagation();
        const sub = document.getElementById("sub-"+b.dataset.expand);
        if(sub){ sub.style.display = sub.style.display==="none" ? "flex" : "none"; }
      });
    });
    document.querySelectorAll("[data-city]").forEach(b=>{
      b.addEventListener("click",(e)=>{
        if(b.hasAttribute("data-expand")) return; // handled by expand toggle
        const direction = opts.direction, step = opts.step;
        if(step===0){
          if(direction==="ru-uz") state.fromCity = b.dataset.city; else state.fromCity = b.dataset.city;
          state.direction = direction;
          pushScreen("cityStep", {direction, step:1});
        } else {
          state.toCity = b.dataset.city;
          pushScreen("calendar", {});
        }
      });
    });
  }

  if(name==="otherCountry"){
    state.direction = "other";
    if(opts.step===0){
      document.getElementById("otherNextBtn").addEventListener("click", ()=>{
        const val = document.getElementById("fromInput").value.trim();
        if(!val){ document.getElementById("fromErr").style.display="block"; document.getElementById("fromInput").setAttribute("aria-invalid","true"); return; }
        document.getElementById("fromInput").setAttribute("aria-invalid","false");
        state.fromCustom = val;
        pushScreen("otherCountry", {step:1});
      });
    } else {
      document.getElementById("otherNextBtn2").addEventListener("click", ()=>{
        const val = document.getElementById("toInput").value.trim();
        if(!val){ document.getElementById("toErr").style.display="block"; document.getElementById("toInput").setAttribute("aria-invalid","true"); return; }
        document.getElementById("toInput").setAttribute("aria-invalid","false");
        state.toCustom = val;
        pushScreen("calendar", {});
      });
    }
  }

  if(name==="calendar"){
    bindCalendarEvents();
    saveRecentRoute();
  }

  if(name==="contact"){
    document.getElementById("contactMaxBtn")?.addEventListener("click", ()=>{
      try{ navigator.clipboard?.writeText(lastContactSummary); }catch(e){}
    });
  }

  if(name==="viza"){
    document.getElementById("expertsToggle")?.addEventListener("click", ()=>{
      const list = document.getElementById("expertsList");
      const arrow = document.getElementById("expertsArrow");
      const open = list.style.display !== "none";
      list.style.display = open ? "none" : "flex";
      arrow.textContent = open ? "▾" : "▴";
    });
  }

  if(name==="help"){
    const helpFileInput = document.getElementById("helpFileInput");
    const helpAttachBtn = document.getElementById("helpAttachBtn");
    const helpAttachThumb = document.getElementById("helpAttachThumb");
    helpAttachBtn.addEventListener("click", ()=> helpFileInput.click());
    helpAttachThumb.addEventListener("click", ()=> helpFileInput.click());
    helpFileInput.addEventListener("change", ()=>{
      const file = helpFileInput.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = (e)=>{ helpAttachThumb.src = e.target.result; };
      reader.readAsDataURL(file);
      helpAttachThumb.style.display = "block";
      helpAttachBtn.style.display = "none";
    });

    document.getElementById("helpSendBtn").addEventListener("click", async ()=>{
      const val = document.getElementById("helpInput").value.trim();
      if(!val){ document.getElementById("helpErr").style.display="block"; document.getElementById("helpInput").setAttribute("aria-invalid","true"); return; }
      document.getElementById("helpInput").setAttribute("aria-invalid","false");
      const btn = document.getElementById("helpSendBtn");
      const status = document.getElementById("helpStatus");
      const file = helpFileInput.files[0];
      let bodyText = val;
      if(file){
        btn.disabled = true; btn.textContent = t('loading');
        try{
          const url = await uploadToImgbb(file);
          bodyText += `\n\n${LANG==='uz'?"Ilova qilingan rasm":(LANG==='ru'?"Прикреплённое изображение":"Attached image")}: ${url}`;
        }catch(err){
          status.textContent = t('submitFail');
        }
        btn.disabled = false; btn.textContent = t('send');
      }
      const subject = encodeURIComponent("Omad Tour — Yordam / Fikr-mulohaza");
      const body = encodeURIComponent(bodyText);
      window.location.href = `mailto:${HELP_EMAIL}?subject=${subject}&body=${body}`;
    });
  }

  if(name==="home"){
    try{
      const draft = JSON.parse(localStorage.getItem("omad_booking_draft") || "null");
      if(draft && (draft.fromCity || draft.fromCustom) && !sessionStorage.getItem("omad_draft_notice_shown")){
        sessionStorage.setItem("omad_draft_notice_shown","1");
        setTimeout(()=>showToast(fx("Avvalgi bron ma’lumotlari saqlandi.","Данные предыдущего бронирования сохранены.","Your previous booking details were saved.")),250);
      }
    }catch(e){}
    Promise.all([fetchNewsList(), fetchVisaSubmissions()]).then(([list, visaList])=>{
      try{ localStorage.setItem("omad_news_cache_count", String(list.length)); }catch(e){}
      const newsUnread = Math.max(0, list.length - getNewsSeenCount());
      const myIds = getMyVisaIds();
      const seenStatuses = getSeenVisaStatuses();
      const visaReadyUnseen = visaList.filter(n => myIds.includes(n.id) && n.status === "ready" && seenStatuses[n.id] !== "ready").length;
      const total = newsUnread + visaReadyUnseen;
      const badge = document.getElementById("newsBadge");
      if(badge){
        if(total>0){ badge.textContent = total; badge.style.display = "flex"; }
        else{ badge.style.display = "none"; }
      }
    });
    document.getElementById("newsBellBtn")?.addEventListener("click", ()=> pushScreen("news", {}));
    document.getElementById("themeToggleBtn")?.addEventListener("click", toggleTheme);
    document.getElementById("quickActionsBtn")?.addEventListener("click", openQuickActions);
    document.getElementById("visaStatusHomeBtn")?.addEventListener("click", ()=>pushScreen("myVisaStatus", {}));
    document.getElementById("faqQuickBtn")?.addEventListener("click", ()=> pushScreen("help", {}));
    document.getElementById("officeHoursBtn")?.addEventListener("click", ()=> showToast(fx("Ish vaqti: har kuni 09:00–20:00. Tez yordam uchun ‘Yordam’ bo‘limidan yozing.","Часы работы: ежедневно 09:00–20:00. Для быстрой связи используйте раздел ‘Помощь’.","Office hours: daily 09:00–20:00. Use Help for quick support.")));
    document.getElementById("resumeBookingBtn")?.addEventListener("click", ()=>{
      try{
        const draft = JSON.parse(localStorage.getItem("omad_booking_draft") || "null");
        if(draft){
          state.direction = draft.direction || null;
          state.fromCity = draft.fromCity || null;
          state.toCity = draft.toCity || null;
          state.fromCustom = draft.fromCustom || "";
          state.toCustom = draft.toCustom || "";
          state.date = draft.date ? new Date(draft.date) : null;
          pushScreen("calendar", {});
          return;
        }
      }catch(e){}
      pushScreen("aviaMenu", {});
    });
    document.getElementById("copyLinkBtn")?.addEventListener("click", (e)=>{
      try{ navigator.clipboard.writeText(window.location.href); }catch(err){}
      const btn = document.getElementById("copyLinkBtn");
      if(btn) btn.querySelector(".label").textContent = t('linkCopied');
    });
    const logo = document.getElementById("logoTap");
    logo?.addEventListener("click", ()=>{
      logoTapCount++;
      clearTimeout(logoTapTimer);
      logoTapTimer = setTimeout(()=>{ logoTapCount = 0; }, 2000);
      if(logoTapCount >= 5){
        logoTapCount = 0;
        const pass = prompt("Admin parolini kiriting:");
        if(pass === ADMIN_PASSWORD){ pushScreen("admin", {}); }
        else if(pass !== null){ alert("Parol noto'g'ri"); }
      }
    });
  }

  if(name==="news"){
    let newsListCache = [];
    fetchNewsList().then(list=>{
      newsListCache = list;
      setNewsSeenCount(list.length);
      try{ localStorage.setItem("omad_news_cache_count", String(list.length)); }catch(e){}
      const c = document.getElementById("newsListContainer");
      if(!c) return;
      if(!list.length){ c.innerHTML = `<div class="empty-state">${fx("Hozircha yangiliklar yo'q.","Пока новостей нет.","No news yet.")}</div>`; return; }
      c.innerHTML = list.map((n,i) => `<div class="news-item" data-idx="${i}">${n.imageUrl ? `<img class="news-thumb" src="${escapeHtml(n.imageUrl)}" alt="" loading="lazy" decoding="async">` : `<span class="news-thumb news-thumb-placeholder">${ICONS.megaphone}</span>`}<div class="news-row-text"><span class="news-date">${escapeHtml(n.date)}</span>${escapeHtml(n.text)}</div></div>`).join("");
      c.querySelectorAll("[data-idx]").forEach(el=>{
        el.addEventListener("click", ()=> showNewsStory(newsListCache[parseInt(el.dataset.idx)]));
      });
    });
  }

  if(name==="myVisaStatus"){
    const myIds = getMyVisaIds();
    const c = document.getElementById("myVisaStatusContainer");
    if(!myIds.length){
      c.innerHTML = `<div class="empty-state">${t('noVisaRequest')}</div>`;
    } else {
      fetchVisaSubmissions().then(list=>{
        const mine = list.filter(n => myIds.includes(n.id));
        if(!mine.length){ c.innerHTML = `<div class="empty-state">${t('noVisaRequest')}</div>`; return; }
        c.innerHTML = mine.map(n=>{
          setSeenVisaStatus(n.id, n.status);
          if(n.status === "ready"){
            return `<div class="status-card status-card-ready">
              <b>${t('statusReadyTitle')}</b>
              <p>${t('statusReadyText')}</p>
              <a class="glass-btn" href="${VISA_GROUP_LINK}" target="_blank" rel="noopener noreferrer" style="margin-top:10px;">${iconCircle(ICONS.telegram)}<span class="label">${t('vizaGroup')}</span></a>
              <span class="footer-note" style="margin:6px 0 0;">${n.date} · ID: ${n.id}</span>
            </div>`;
          }
          if(n.status === "pending"){
            return `<div class="status-card status-card-pending">
              <b>${t('statusPendingTitle')}</b>
              <p>${t('statusPendingText')}</p>
              <a class="glass-btn" href="${VISA_GROUP_LINK}" target="_blank" rel="noopener noreferrer" style="margin-top:10px;">${iconCircle(ICONS.telegram)}<span class="label">${t('vizaGroup')}</span></a>
              <span class="footer-note" style="margin:6px 0 0;">${n.date} · ID: ${n.id}</span>
            </div>`;
          }
          return `<div class="status-card status-card-new">
            <b>${t('statusNewTitle')}</b>
            <p>${t('statusNewText')}</p>
            <span class="footer-note" style="margin:6px 0 0;">${n.date} · ID: ${n.id}</span>
          </div>`;
        }).join("");
      });
    }
  }

  if(name==="vizaSubmitForm"){
    const dz = wireDropzone("viza");

    const phoneInput = document.getElementById("vizaPhoneInput");
    phoneInput.value = "+7 ";
    phoneInput.addEventListener("input", ()=>{
      phoneInput.value = formatRuPhone(phoneInput.value);
    });

    document.getElementById("vizaSubmitBtnEl").addEventListener("click", async ()=>{
      const digits = phoneInput.value.replace(/\D/g,"");
      const phoneValid = digits.length === 11 && digits.startsWith("7");
      const file = dz.getFile();
      document.getElementById("vizaPhoneErr").style.display = phoneValid ? "none" : "block";
      phoneInput.setAttribute("aria-invalid", phoneValid ? "false" : "true");
      document.getElementById("vizaFileErr").style.display = file ? "none" : "block";
      if(!phoneValid || !file) return;
      const phone = phoneInput.value.trim();
      const btn = document.getElementById("vizaSubmitBtnEl");
      const status = document.getElementById("vizaSubmitStatus");
      btn.disabled = true; btn.textContent = t('loading');
      try{
        const url = await uploadToImgbb(file);
        const { id: newId, saved, detail } = await addVisaSubmission(phone, url);
        addMyVisaId(newId);
        const caption = `Viza bo'yicha tekshiruv so'rovi keldi, ko'rib chiqing.\nTelefon: ${phone}`;
        if(saved){
          notifyAdminTelegramPhoto(url, caption, newId); // buttons will work — the record is confirmed saved
        } else {
          // couldn't save the shared record — don't send buttons that wouldn't work, and show the exact reason
          notifyAdminTelegramPhoto(url, caption + `\n\n⚠️ Diqqat: tugmalar ishlamaydi, mijozga qo'lda qo'ng'iroq qiling.\nSabab: ${detail || "noma'lum"}`, null);
        }
        status.textContent = t('submitSuccess');
        setTimeout(()=> goHome(), 1400);
      }catch(err){
        status.textContent = t('submitFail');
        btn.disabled = false; btn.textContent = t('send');
      }
    });
  }

  if(name==="admin"){
    const newsDz = wireDropzone("news");

    function renderAdminNews(){
      fetchNewsList().then(list=>{
        const c = document.getElementById("adminNewsList");
        if(!c) return;
        if(!list.length){ c.innerHTML = `<div class="empty-state">${fx("Hozircha yangiliklar yo'q","Пока новостей нет","No news yet")}</div>`; return; }
        c.innerHTML = list.map(n => `<div class="admin-row">${n.imageUrl ? `<img src="${escapeHtml(n.imageUrl)}" class="admin-row-thumb">` : ""}<span class="grow"><b>${escapeHtml(n.date)}</b> — ${escapeHtml(n.text)}</span><button class="del-btn" data-newsid="${n.id}">O'chirish</button></div>`).join("");
        c.querySelectorAll("[data-newsid]").forEach(b=>{
          b.addEventListener("click", async ()=>{
            b.textContent = "...";
            await deleteNewsItem(parseInt(b.dataset.newsid));
            renderAdminNews();
          });
        });
      });
    }
    renderAdminNews();
    document.getElementById("newsAddBtn").addEventListener("click", async ()=>{
      const input = document.getElementById("newsInput");
      const val = input.value.trim();
      const status = document.getElementById("newsAddStatus");
      if(!val) return;
      const btn = document.getElementById("newsAddBtn");
      btn.disabled = true; btn.textContent = "Qo'shilmoqda...";
      try{
        const file = newsDz.getFile();
        let imageUrl = "";
        if(file){ imageUrl = await uploadToImgbb(file); }
        await addNewsItem(val, imageUrl);
        input.value = "";
        newsDz.clear();
        status.textContent = "";
      }catch(err){
        status.textContent = "Rasm yuklashda xatolik, matn saqlandi.";
        await addNewsItem(val, "");
        input.value = "";
        newsDz.clear();
      }
      btn.disabled = false; btn.textContent = "Yangilik qo'shish";
      renderAdminNews();
    });

    document.getElementById("resetVisaBtn").addEventListener("click", async ()=>{
      if(!confirm("Barcha eski viza so'rovlari butunlay o'chiriladi. Davom etasizmi?")) return;
      const btn = document.getElementById("resetVisaBtn");
      const status = document.getElementById("resetVisaStatus");
      btn.disabled = true; btn.textContent = "Tozalanmoqda...";
      const result = await kvSetJSON("visa_submissions", []);
      status.textContent = result.ok ? "Tozalandi. Endi faqat yangi so'rovlar ko'rinadi." : `Xatolik: ${result.detail}`;
      btn.disabled = false; btn.textContent = "Eski viza so'rovlarini tozalash";
    });
  }
}

function showNewsStory(item){
  const overlay = document.createElement("div");
  overlay.className = "story-overlay";
  overlay.innerHTML = `
    <div class="story-progress"><div class="story-progress-bar" id="storyProgressBar"></div></div>
    <button class="story-close" id="storyCloseBtn" aria-label="${fx("Yangilikni yopish","Закрыть новость","Close story")}" title="${fx("Yopish","Закрыть","Close")}">✕</button>
    ${item.imageUrl ? `<img class="story-img" src="${escapeHtml(item.imageUrl)}">` : `<div class="story-noimg">${ICONS.megaphone}</div>`}
    <div class="story-caption">${escapeHtml(item.text)}</div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>{
    const bar = document.getElementById("storyProgressBar");
    if(bar) bar.style.width = "100%";
  });
  const timer = setTimeout(()=> overlay.remove(), 5000);
  document.getElementById("storyCloseBtn").addEventListener("click", ()=>{
    clearTimeout(timer);
    overlay.remove();
  });
  overlay.addEventListener("click", (event)=>{
    if(event.target === overlay){
      clearTimeout(timer);
      overlay.remove();
    }
  });
}

function formatSize(bytes){
  if(bytes < 1024) return bytes + " B";
  if(bytes < 1024*1024) return (bytes/1024).toFixed(2) + " KB";
  return (bytes/(1024*1024)).toFixed(2) + " MB";
}
function formatRuPhone(raw){
  let digits = raw.replace(/\D/g,"");
  if(digits.startsWith("8")) digits = "7" + digits.slice(1);
  if(!digits.startsWith("7")) digits = "7" + digits;
  digits = digits.slice(0,11);
  const d = digits.slice(1);
  let out = "+7";
  if(d.length>0) out += " " + d.slice(0,3);
  if(d.length>=4) out += " " + d.slice(3,6);
  if(d.length>=7) out += "-" + d.slice(6,8);
  if(d.length>=9) out += "-" + d.slice(8,10);
  return out;
}
function wireDropzone(prefix){
  const fileInput = document.getElementById(prefix+"FileInput");
  const box = document.getElementById(prefix+"Box");
  const empty = document.getElementById(prefix+"Empty");
  const preview = document.getElementById(prefix+"Preview");
  const thumb = document.getElementById(prefix+"Thumb");
  const nameEl = document.getElementById(prefix+"FileName");
  const sizeEl = document.getElementById(prefix+"FileSize");
  const removeBtn = document.getElementById(prefix+"RemoveBtn");
  const errEl = document.getElementById(prefix+"FileErr");

  function showPreview(file){
    const reader = new FileReader();
    reader.onload = (e)=>{ thumb.src = e.target.result; };
    reader.readAsDataURL(file);
    nameEl.textContent = file.name;
    sizeEl.textContent = formatSize(file.size);
    empty.style.display = "none";
    preview.style.display = "flex";
    if(errEl) errEl.style.display = "none";
  }
  function clear(){
    fileInput.value = "";
    empty.style.display = "flex";
    preview.style.display = "none";
    thumb.src = "";
  }
  box.addEventListener("click", (e)=>{
    if(e.target === removeBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", ()=>{
    if(fileInput.files[0]) showPreview(fileInput.files[0]);
  });
  removeBtn.addEventListener("click", (e)=>{ e.stopPropagation(); clear(); });

  return { getFile: ()=> fileInput.files[0] || null, clear };
}

function bindCalendarEvents(){
  const card = document.getElementById("calCard");
  card.querySelector("#prevMonth").addEventListener("click", ()=>{
    state.calMonth--; if(state.calMonth<0){state.calMonth=11; state.calYear--;}
    card.innerHTML = calendarInnerHTML();
    bindCalendarEvents();
  });
  card.querySelector("#nextMonth").addEventListener("click", ()=>{
    state.calMonth++; if(state.calMonth>11){state.calMonth=0; state.calYear++;}
    card.innerHTML = calendarInnerHTML();
    bindCalendarEvents();
  });
  card.querySelectorAll(".cal-day:not(.empty):not(.past)").forEach(el=>{
    el.addEventListener("click", ()=>{
      state.date = new Date(state.calYear, state.calMonth, parseInt(el.dataset.day));
      pushScreen("contact", {});
    });
  });
}

/* ---------------- ANIMATED DOTS BACKGROUND ---------------- */
(function(){
  const canvas = document.getElementById("dots-canvas");
  const ctx = canvas.getContext("2d");
  let w,h,dots=[];
  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  function initDots(){
    dots = [];
    const count = Math.floor((w*h)/9000);
    for(let i=0;i<count;i++){
      dots.push({
        x:Math.random()*w, y:Math.random()*h,
        r:Math.random()*1.6+0.4,
        vx:(Math.random()-0.5)*0.25,
        vy:(Math.random()-0.5)*0.25,
        a:Math.random()*0.5+0.15
      });
    }
  }
  function tick(){
    ctx.clearRect(0,0,w,h);
    dots.forEach(d=>{
      d.x+=d.vx; d.y+=d.vy;
      if(d.x<0) d.x=w; if(d.x>w) d.x=0;
      if(d.y<0) d.y=h; if(d.y>h) d.y=0;
      ctx.beginPath();
      ctx.arc(d.x,d.y,d.r,0,Math.PI*2);
      ctx.fillStyle = document.body.classList.contains("theme-light") ? `rgba(12,28,77,${d.a*0.6})` : `rgba(255,255,255,${d.a})`;
      ctx.fill();
    });
    requestAnimationFrame(tick);
  }
  window.addEventListener("resize", ()=>{ resize(); initDots(); });
  resize(); initDots(); tick();
})();


/* ---------------- GLOBAL UX EVENTS ---------------- */
document.addEventListener("keydown", (event)=>{
  if(event.key === "Escape"){
    const story = document.querySelector(".story-overlay");
    if(story) story.remove();
    else if(shareSheetClose) shareSheetClose();
    else if(history.length > 1) goBack();
  }
});
window.addEventListener("online", ()=>showToast(
  LANG==="uz" ? "Internet qayta ulandi."
  : LANG==="ru" ? "Интернет снова подключён."
  : "You are back online."
));
window.addEventListener("offline", announceConnection);

/* ---------------- INIT ---------------- */
applyTheme();
document.documentElement.lang = LANG;
announceConnection();
history.push({name:"home"});
render();
