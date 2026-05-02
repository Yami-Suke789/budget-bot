const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// ============================================================
// CONSTANTES
// ============================================================
const SALAIRE_LGM_DEFAULT = 2500;
const BEAU_FRERE = 320;
const OBJECTIF_COMPLETUDE = 1500;
const EPARGNE_DEPART = 9000;

const CHARGES_FIXES = {
  'Loyer': 832.46, 'Tontine 1': 500, 'Tontine 2': 500,
  'Virement mère': 150, 'Place parking': 50, 'Malakoff mutuelle': 57.03,
  'ENI énergie': 39.40, 'Bouygues mobile': 17.99, 'Bouygues box': 24,
  'Basic Fit': 22.99, 'Assurance habitation': 8.46, 'Assurance auto': 64.24,
  'Salle sport femme': 44, 'Canal+ frère': 13, 'Cours arabe': 31,
  'Claude.ai': 21.60, 'Helloasso': 12.55, 'Stripe asso': 10,
  'Disney+': 6.99, 'Crunchyroll': 8.99, 'Cotisation bancaire': 18.30,
};
const TOTAL_CHARGES_FIXES = Object.values(CHARGES_FIXES).reduce((a, b) => a + b, 0);

const BUDGETS = {
  essence:  { label: '⛽ Essence',  max: 300 },
  courses:  { label: '🛒 Courses',  max: 650 },
  restos:   { label: '🍽️ Restos',   max: 80  },
  sante:    { label: '🏥 Santé',    max: 60  },
  maison:   { label: '🏠 Maison',   max: 50  },
  voiture:  { label: '🚗 Voiture',  max: 50  },
  shopping: { label: '👗 Shopping', max: 50  },
  loisirs:  { label: '🎉 Loisirs',  max: 50  },
  divers:   { label: '📦 Divers',   max: 50  },
};
const TOTAL_BUDGETS_MAX = Object.values(BUDGETS).reduce((a, b) => a + b.max, 0);

const OBJECTIFS = [
  { label: 'Fin juin 2026', montant: 12500 },
  { label: 'Fin août 2026', montant: 15000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

const ELEVES = {
  'Amel':        { niveau: '5e',  taux: 21.04, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 1, heure: 17, minute: 0  },
  'Benjamin':    { niveau: '5e',  taux: 24.30, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 2, heure: 18, minute: 0  },
  'Guillaume':   { niveau: '5e',  taux: 23.88, duree: 1.5, tda: true,  ficheHebdo: false, question2h: true,  fiche: true,  jour: 3, heure: 17, minute: 30 },
  'Margaux':     { niveau: '3e',  taux: 26.60, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 4, heure: 16, minute: 0  },
  'Nélia':       { niveau: '3e',  taux: 26.60, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 4, heure: 17, minute: 30 },
  'Hélène':      { niveau: '5e',  taux: 24.30, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 8,  minute: 0  },
  'Noélie':      { niveau: 'CE2', taux: 25.78, duree: 1.0, tda: false, ficheHebdo: false, question2h: false, fiche: false, jour: 6, heure: 10, minute: 0  },
  'Mathéo':      { niveau: '3e',  taux: 23.66, duree: 1.5, tda: false, ficheHebdo: true,  question2h: true,  fiche: true,  jour: 6, heure: 11, minute: 30 },
  'Anne-Gaëlle': { niveau: '3e',  taux: 24.08, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 13, minute: 0  },
  'Saïda':       { niveau: '5e',  taux: 25.56, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 6, heure: 15, minute: 0  },
  'Serena':      { niveau: '5e',  taux: 23.04, duree: 1.5, tda: false, ficheHebdo: false, question2h: true,  fiche: true,  jour: 0, heure: 13, minute: 0, uneSemaineSurDeux: true },
};

let etatConversation = null;

// ============================================================
// TELEGRAM HELPERS
// ============================================================

// Message texte simple
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;
  if (text.length <= MAX) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    return;
  }
  const parties = [];
  let reste = text;
  while (reste.length > MAX) {
    let coupe = reste.lastIndexOf('\n', MAX);
    if (coupe < MAX / 2) coupe = MAX;
    parties.push(reste.slice(0, coupe));
    reste = reste.slice(coupe).trim();
  }
  if (reste) parties.push(reste);
  for (const partie of parties) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: partie, parse_mode: 'Markdown' })
    });
    await new Promise(r => setTimeout(r, 400));
  }
}

// Message avec boutons inline
async function sendButtons(chatId, text, buttons) {
  // buttons = [[{text, data}, ...], [...]] — tableau de lignes de boutons
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const inline_keyboard = buttons.map(ligne =>
    ligne.map(btn => ({ text: btn.text, callback_data: btn.data }))
  );
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    })
  });
}

// Répondre à un callback (édite le message ou envoie une réponse)
async function answerCallback(callbackQueryId, text = '') {
  await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text })
  });
}

// Supprimer les boutons d'un message après clic
async function removeButtons(chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  });
}

// ============================================================
// BOUTONS PRÉDÉFINIS
// ============================================================
const BTN_OUI_NON = [[{ text: '✅ Oui', data: 'oui' }, { text: '❌ Non', data: 'non' }]];
const BTN_2H_1H   = [[{ text: '2h (1ère séance)', data: '2h' }, { text: '1h (séance suivante)', data: '1h' }]];
const BTN_TYPE_COURS = [[{ text: '📚 Normal', data: 'normal' }, { text: '🔄 Rattrapage', data: 'rattrapage' }]];

function btnEleves() {
  const noms = Object.keys(ELEVES);
  const lignes = [];
  for (let i = 0; i < noms.length; i += 3) {
    lignes.push(noms.slice(i, i + 3).map(n => ({ text: n, data: `eleve_${n}` })));
  }
  return lignes;
}

function btnCategories() {
  const cats = Object.entries(BUDGETS);
  const lignes = [];
  for (let i = 0; i < cats.length; i += 3) {
    lignes.push(cats.slice(i, i + 3).map(([k, b]) => ({ text: b.label, data: `cat_${k}` })));
  }
  return lignes;
}

// ============================================================
// PROGRESSION
// ============================================================
function barreProgression(valeur, max) {
  const pct = Math.min(100, Math.round((valeur / max) * 100));
  const emoji = pct >= 100 ? '✅' : pct >= 75 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
  return `${emoji} ${pct}% (${Math.round(valeur)}€ / ${max.toLocaleString()}€)`;
}

// ============================================================
// SUPABASE
// ============================================================
async function getDepensesMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('depenses').select('*').gte('created_at', debut.toISOString());
  return data || [];
}
async function getCoursMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('cours').select('*').gte('created_at', debut.toISOString());
  return data || [];
}
async function getCoursManquesMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('cours_manques').select('*').gte('created_at', debut.toISOString());
  return data || [];
}
async function getRevenusSupplementaires() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('revenus').select('*').gte('created_at', debut.toISOString());
  return data || [];
}
async function getSalaireMois() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('salaires').select('*').gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  return data && data.length > 0 ? data[0].montant : SALAIRE_LGM_DEFAULT;
}
async function getEpargne() {
  const { data } = await supabase.from('epargne').select('*').order('created_at', { ascending: false }).limit(1);
  return data && data.length > 0 ? data[0].montant : EPARGNE_DEPART;
}
async function getTotauxParCat(depenses) {
  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });
  return totaux;
}
async function getContextFinancier() {
  const [depenses, cours, coursManques, revenus, salaire, epargneBase] = await Promise.all([
    getDepensesMois(), getCoursMois(), getCoursManquesMois(),
    getRevenusSupplementaires(), getSalaireMois(), getEpargne()
  ]);
  const totaux = await getTotauxParCat(depenses);
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const totalManque = coursManques.reduce((s, c) => s + c.gain_manque, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const epargneEstimee = epargneBase + solde;
  return { depenses, cours, coursManques, revenus, totaux, totalDep, completude, totalManque, revenusSupp, totalRevenus, solde, epargneEstimee, salaire, epargneBase };
}

// ============================================================
// MINI DASHBOARD
// ============================================================
async function envoyerMiniDashboard(chatId, ctx) {
  let msg = `📊 *Dashboard*\n━━━━━━━━━━━━━━\n`;
  msg += `🎓 Complétude :\n${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n\n`;
  const prochainObj = OBJECTIFS.find(o => ctx.epargneEstimee < o.montant);
  if (prochainObj) {
    msg += `🎯 Épargne → ${prochainObj.label} :\n${barreProgression(ctx.epargneEstimee, prochainObj.montant)}\n\n`;
  } else {
    msg += `✅ Tous les objectifs atteints ! 🎉\n\n`;
  }
  const alertes = Object.entries(ctx.totaux)
    .filter(([k, v]) => v > BUDGETS[k].max * 0.7)
    .map(([k, v]) => `${v > BUDGETS[k].max ? '🔴' : '🟡'} ${BUDGETS[k].label} : ${v.toFixed(0)}€/${BUDGETS[k].max}€`);
  if (alertes.length > 0) msg += `⚠️ *Budgets à surveiller :*\n${alertes.join('\n')}\n\n`;
  msg += `${ctx.solde >= 0 ? '🟢' : '🔴'} Solde estimé : *${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
  await sendMessage(chatId, msg);
}

// ============================================================
// COURS
// ============================================================
async function enregistrerCoursFait(chatId, nomEleve, gain, rattrapages = false) {
  await supabase.from('cours').insert({
    eleve: nomEleve, duree: ELEVES[nomEleve].duree,
    taux: ELEVES[nomEleve].taux, gain, chat_id: chatId, rattrapage: rattrapages
  });
  const ctx = await getContextFinancier();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
  const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
  let msg = `✅ Cours avec *${nomEleve}* enregistré${rattrapages ? ' _(rattrapage)_' : ''} !\n`;
  msg += `💰 Gain : *+${gain.toFixed(2)} €*\n\n`;
  msg += `${emoji} Complétude : *${ctx.completude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
  msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : `🎉 Objectif atteint !`;
  await sendMessage(chatId, msg);
  await envoyerMiniDashboard(chatId, ctx);
}

async function enregistrerCoursManque(chatId, nomEleve, gainManque) {
  await supabase.from('cours_manques').insert({ eleve: nomEleve, gain_manque: gainManque, chat_id: chatId });
  const ctx = await getContextFinancier();
  await sendMessage(chatId,
    `❌ Cours avec *${nomEleve}* non effectué\n` +
    `💸 Manque à gagner : *-${gainManque.toFixed(2)} €*\n\n` +
    `📉 Total manqué ce mois : *-${ctx.totalManque.toFixed(0)} €* (${ctx.coursManques.length} cours)`
  );
}

// ============================================================
// FICHES
// ============================================================
async function genererFiche(nomEleve, chapitre) {
  const profil = ELEVES[nomEleve];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const base = `RÈGLES : texte brut uniquement, fractions "3/4", puissances "x^2", max 600 mots, corrigé après "=== CORRIGÉ ==="`;
  let prompt = '';
  if (profil.ficheHebdo) {
    prompt = `Professeur maths. Fiche hebdomadaire pour ${nomEleve} (${profil.niveau}). Chapitre : ${chapitre}. ${base}. FORMAT : Lundi→Vendredi, 2 exercices/jour, corrigé final. Titre : "FICHE HEBDO — ${nomEleve} — ${chapitre}"`;
  } else if (profil.tda) {
    prompt = `Professeur spécialisé TDA. Fiche pour ${nomEleve} (${profil.niveau}). Chapitre : ${chapitre}. ${base}. Max 4 exercices courts, 1 consigne par exercice. Titre : "FICHE TDA — ${nomEleve} — ${chapitre}"`;
  } else {
    prompt = `Professeur maths. Fiche pour ${nomEleve} (${profil.niveau}). Chapitre : ${chapitre}. ${base}. 4 exercices progressifs niveau ${profil.niveau}. Titre : "FICHE — ${nomEleve} — ${chapitre}"`;
  }
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// DÉTECTION INTENTION IA
// ============================================================
async function detecterIntentionIA(texte, ctx) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const prompt = `Tu es le cerveau d'un assistant Telegram pour Nour-Dine. Analyse ce message et retourne UNIQUEMENT un JSON valide (sans markdown).
Élèves : ${Object.keys(ELEVES).join(', ')}
Catégories : essence, courses, restos, sante, maison, voiture, shopping, loisirs, divers
Sois TRÈS tolérant aux fautes. Exemples :
- "cours margaux" = cours_fait Margaux
- "pa pu faire helene" = cours_manque Hélène
- "leclerc 45" = depense courses 45€
- "plein 60e" = depense essence 60€
Retourne : {"intention":"depense|cours_fait|cours_manque|salaire|epargne|revenu|question|inconnu","eleve":"prénom exact ou null","montant":nombre ou null,"categorie_depense":"catégorie ou null","est_rattrapage":false,"reponse_directe":"réponse courte si question simple sinon null"}
Contexte : solde ${ctx.solde.toFixed(0)}€, épargne ${ctx.epargneBase}€, complétude ${ctx.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€
Taux : ${Object.entries(ELEVES).map(([n,e]) => `${n} ${e.taux}€/h`).join(', ')}
Message : "${texte}"`;
  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, '').trim();
    return JSON.parse(raw);
  } catch {
    return { intention: 'inconnu' };
  }
}

// ============================================================
// MESSAGES AUTO
// ============================================================
async function envoyerRappelBiHebdo() {
  const ctx = await getContextFinancier();
  let msg = `📋 *Rappel bi-hebdo — ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
  msg += `💰 *Revenus :*\n• LGM : ${ctx.salaire} €${ctx.salaire === SALAIRE_LGM_DEFAULT ? ' _(par défaut)_' : ''}\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n• Complétude : ${ctx.completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n\n💸 *Dépenses :*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${e} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 Solde : *${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
  if (ctx.totalManque > 0) msg += `\n💸 Cours manqués : *-${ctx.totalManque.toFixed(0)} €*`;
  msg += `\n\n_Des dépenses ou rentrées à enregistrer ?_`;
  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const ctx = await getContextFinancier();
  let msg = `🗓️ *SYNTHÈSE ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase()}*\n\n`;
  msg += `✅ *REVENUS : ${ctx.totalRevenus.toFixed(0)} €*\n• LGM : ${ctx.salaire} €\n• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € (${ctx.cours.length} cours)\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n🔒 *CHARGES : -${TOTAL_CHARGES_FIXES.toFixed(0)} €*\n\n💸 *DÉPENSES : -${ctx.totalDep.toFixed(0)} €*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${e} ${BUDGETS[k].label} : ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
  });
  if (ctx.coursManques.length > 0) {
    msg += `\n📉 *COURS MANQUÉS : ${ctx.coursManques.length} — -${ctx.totalManque.toFixed(0)} €*\n`;
    ctx.coursManques.forEach(c => { msg += `• ${c.eleve} : -${c.gain_manque.toFixed(2)} €\n`; });
  }
  msg += `\n💰 *SOLDE NET : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n\n🎯 *OBJECTIFS :*\n`;
  OBJECTIFS.forEach(o => {
    const delta = ctx.epargneEstimee - o.montant;
    msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n${barreProgression(ctx.epargneEstimee, o.montant)}\n\n`;
  });
  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER
// ============================================================
function demarrerScheduler() {
  setInterval(() => {
    fetch(`https://budget-bot-production-eaaf.up.railway.app/`).catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) await envoyerRappelBiHebdo();
    if (now.getDate() === 30 && heure === 20 && minute === 0) await envoyerSyntheseMensuelle();

    for (const [nomEleve, profil] of Object.entries(ELEVES)) {
      if (profil.jour !== jour) continue;
      if (profil.uneSemaineSurDeux && !estSemaineSerena()) continue;
      const totalMin = profil.minute + Math.floor(profil.duree * 60);
      const heureFin = profil.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        etatConversation = { etape: 'confirmation', nomEleve, source: 'auto' };
        await sendButtons(CHAT_ID,
          `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${nomEleve}* ?`,
          BTN_OUI_NON
        );
      }
    }
  }, 60000);
}

function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

// ============================================================
// TRAITEMENT CALLBACK (boutons cliqués)
// ============================================================
async function traiterCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  await answerCallback(callbackQuery.id);
  await removeButtons(chatId, messageId);

  // ── CHOIX ÉLÈVE ─────────────────────────────────────────
  if (data.startsWith('eleve_')) {
    const nomEleve = data.replace('eleve_', '');
    if (!ELEVES[nomEleve]) return;
    etatConversation = { etape: 'cours_manuel_type', nomEleve, source: 'manuel' };
    await sendButtons(chatId, `📚 Cours avec *${nomEleve}*\n\nType de cours ?`, BTN_TYPE_COURS);
    return;
  }

  // ── TYPE COURS (normal/rattrapage) ──────────────────────
  if (data === 'normal' || data === 'rattrapage') {
    if (!etatConversation || etatConversation.etape !== 'cours_manuel_type') return;
    const { nomEleve } = etatConversation;
    const profil = ELEVES[nomEleve];
    const source = data;
    if (profil.question2h) {
      etatConversation = { etape: 'question2h', nomEleve, source };
      await sendButtons(chatId, `*C'est la séance à 2h ?*`, BTN_2H_1H);
    } else {
      const gain = profil.taux * profil.duree;
      await enregistrerCoursFait(chatId, nomEleve, gain, data === 'rattrapage');
      if (profil.fiche) {
        etatConversation = { etape: 'chapitre', nomEleve, gain, source };
        await sendMessage(chatId, `📝 *Qu'avez-vous vu avec ${nomEleve} ?*\n_Ex: Fractions, Pythagore..._`);
      } else {
        etatConversation = null;
      }
    }
    return;
  }

  // ── OUI / NON (confirmation cours auto) ─────────────────
  if (data === 'oui' || data === 'non') {
    if (!etatConversation) return;
    const { etape, nomEleve, source } = etatConversation;
    const profil = ELEVES[nomEleve];

    if (etape === 'confirmation') {
      if (data === 'oui') {
        if (profil.question2h) {
          etatConversation = { etape: 'question2h', nomEleve, source };
          await sendButtons(chatId, `✅ Super !\n\n*C'est la séance à 2h ?*`, BTN_2H_1H);
        } else {
          const gain = profil.taux * profil.duree;
          await enregistrerCoursFait(chatId, nomEleve, gain, source !== 'auto');
          etatConversation = null;
        }
      } else {
        await enregistrerCoursManque(chatId, nomEleve, profil.taux * 1);
        etatConversation = null;
      }
      return;
    }
    return;
  }

  // ── 2H / 1H ─────────────────────────────────────────────
  if (data === '2h' || data === '1h') {
    if (!etatConversation || etatConversation.etape !== 'question2h') return;
    const { nomEleve, source } = etatConversation;
    const profil = ELEVES[nomEleve];
    const gain = profil.taux * (data === '2h' ? 2 : 1);
    await enregistrerCoursFait(chatId, nomEleve, gain, source !== 'auto');
    if (profil.fiche) {
      etatConversation = { etape: 'chapitre', nomEleve, gain, source };
      await sendMessage(chatId, `📝 *Qu'avez-vous vu aujourd'hui avec ${nomEleve} ?*\n_Ex: Fractions, Pythagore, Calcul littéral..._`);
    } else {
      etatConversation = null;
    }
    return;
  }

  // ── CATÉGORIE DÉPENSE ────────────────────────────────────
  if (data.startsWith('cat_')) {
    const cat = data.replace('cat_', '');
    if (!etatConversation || etatConversation.etape !== 'attente_montant_depense') return;
    etatConversation = { etape: 'attente_montant_depense2', cat };
    await sendMessage(chatId, `${BUDGETS[cat].label} sélectionné ✅\n\n*Quel montant ?*\n_Envoie juste le nombre, ex: 45_`);
    return;
  }
}

// ============================================================
// WEBHOOK — MESSAGE TEXTE
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;

  // Callback query (bouton cliqué)
  if (body.callback_query) {
    await traiterCallback(body.callback_query);
    return;
  }

  const msg = body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();
  const texteLower = texte.toLowerCase();

  try {

    // ── ÉTATS CONVERSATION ──────────────────────────────────
    if (etatConversation) {
      const { etape, nomEleve, source } = etatConversation;
      const profil = nomEleve ? ELEVES[nomEleve] : null;

      // Chapitre pour fiche
      if (etape === 'chapitre') {
        await sendMessage(chatId, `📝 *Génération de la fiche...*`);
        try {
          const fiche = await genererFiche(nomEleve, texte);
          await sendMessage(chatId, fiche);
        } catch (err) {
          await sendMessage(chatId, `❌ Erreur génération fiche.`);
        }
        etatConversation = null;
        return;
      }

      // Montant dépense après choix catégorie
      if (etape === 'attente_montant_depense2') {
        const match = texte.match(/(\d+([.,]\d{1,2})?)/);
        if (match) {
          const montant = parseFloat(match[1].replace(',', '.'));
          const cat = etatConversation.cat;
          await supabase.from('depenses').insert({ montant, categorie: cat, libelle: texte, chat_id: chatId });
          const depenses = await getDepensesMois();
          const totaux = await getTotauxParCat(depenses);
          const restant = BUDGETS[cat].max - totaux[cat];
          const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
          await sendMessage(chatId, `✅ *${montant} €* — _${BUDGETS[cat].label}_\n${emoji} Restant : *${restant.toFixed(0)} €* / ${BUDGETS[cat].max} €`);
          const ctx = await getContextFinancier();
          await envoyerMiniDashboard(chatId, ctx);
          etatConversation = null;
        } else {
          await sendMessage(chatId, `Envoie juste le montant, ex: *45*`);
        }
        return;
      }

      // Texte libre pendant confirmation → on laisse passer à l'IA
    }

    // ── COMMANDES ───────────────────────────────────────────
    if (texte === '/start') {
      await sendMessage(chatId,
        `👋 Salut Nour-Dine ! Je suis *L'Agent*.\n\n` +
        `*📚 Complétude :*\n/cours — signaler un cours\n/completude — revenus\n/manques — cours ratés\n\n` +
        `*💰 Finances :*\n/depense — saisir une dépense\n/bilan — dépenses du mois\n/objectifs — épargne\n/synthese — bilan complet\n/charges — charges fixes\n/dashboard — vue rapide\n\n` +
        `*Ou parle-moi naturellement !*\n💸 "Leclerc 45€" → dépense\n📚 "Cours avec Margaux" → signaler\n❓ N'importe quelle question !`
      );
      return;
    }

    if (texte === '/cours') {
      await sendButtons(chatId, `📚 *Quel élève ?*`, btnEleves());
      etatConversation = null; // reset pour que le callback prenne le relai
      return;
    }

    if (texte === '/depense') {
      etatConversation = { etape: 'attente_montant_depense' };
      await sendButtons(chatId, `💸 *Quelle catégorie de dépense ?*`, btnCategories());
      return;
    }

    if (texte === '/dashboard') {
      const ctx = await getContextFinancier();
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (texte === '/bilan') {
      const ctx = await getContextFinancier();
      let message = `📊 *Bilan ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      Object.entries(ctx.totaux).forEach(([k, v]) => {
        const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        message += `${e} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      message += `\n💰 *Solde estimé : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
      await sendMessage(chatId, message);
      return;
    }

    if (texte === '/completude') {
      const ctx = await getContextFinancier();
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
      const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
      let msg = `📚 *Complétude ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      msg += `${emoji} *${ctx.completude.toFixed(2)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
      msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
      msg += `Cours : *${ctx.cours.length}*\n`;
      msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*\n` : `🎉 Objectif atteint !\n`;
      if (ctx.cours.length > 0) {
        msg += `\n*Détail :*\n`;
        ctx.cours.forEach(c => { msg += `• ${c.eleve}${c.rattrapage ? ' _(rattrapage)_' : ''} : +${c.gain.toFixed(2)} €\n`; });
      }
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/manques') {
      const ctx = await getContextFinancier();
      if (ctx.coursManques.length === 0) { await sendMessage(chatId, `✅ *Aucun cours manqué ce mois !* 🎉`); return; }
      let msg = `📉 *Cours manqués*\n\n`;
      ctx.coursManques.forEach(c => { msg += `❌ *${c.eleve}* → -${c.gain_manque.toFixed(2)} €\n`; });
      msg += `\n💸 *Total : -${ctx.totalManque.toFixed(0)} €*\n✅ Gagné : ${ctx.completude.toFixed(0)} €\n🎯 Potentiel : ${(ctx.completude + ctx.totalManque).toFixed(0)} €`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/objectifs') {
      const ctx = await getContextFinancier();
      let msg = `🎯 *Objectifs épargne*\n\n💼 Actuelle : *${ctx.epargneBase.toLocaleString()} €*\n📈 Projection : *${ctx.epargneEstimee.toFixed(0)} €*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = ctx.epargneEstimee - o.montant;
        msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n${barreProgression(ctx.epargneEstimee, o.montant)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n\n`;
      });
      msg += `_Hors tontine 13 000 € — c'est du bonus !_ 🎁`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/synthese') { await envoyerSyntheseMensuelle(); return; }

    if (texte === '/charges') {
      let msg = `🔒 *Charges fixes — ${TOTAL_CHARGES_FIXES.toFixed(0)} €/mois*\n\n`;
      Object.entries(CHARGES_FIXES).forEach(([k, v]) => { msg += `• ${k} : ${v.toFixed(2)} €\n`; });
      await sendMessage(chatId, msg);
      return;
    }

    // ── IA ANALYSE TOUS LES MESSAGES ────────────────────────
    const ctx = await getContextFinancier();
    const intention = await detecterIntentionIA(texte, ctx);

    if (intention.intention === 'cours_fait' && intention.eleve && ELEVES[intention.eleve]) {
      const eleve = intention.eleve;
      const profil = ELEVES[eleve];
      etatConversation = { etape: 'cours_manuel_type', nomEleve: eleve, source: 'manuel' };
      await sendButtons(chatId,
        `📚 Cours avec *${eleve}*${intention.est_rattrapage ? ' _(rattrapage détecté)_' : ''}\n\nType de cours ?`,
        BTN_TYPE_COURS
      );
      return;
    }

    if (intention.intention === 'cours_manque' && intention.eleve && ELEVES[intention.eleve]) {
      const gainManque = ELEVES[intention.eleve].taux * 1;
      await enregistrerCoursManque(chatId, intention.eleve, gainManque);
      return;
    }

    if (intention.intention === 'depense' && intention.montant) {
      if (intention.categorie_depense) {
        const cat = intention.categorie_depense;
        await supabase.from('depenses').insert({ montant: intention.montant, categorie: cat, libelle: texte, chat_id: chatId });
        const depenses = await getDepensesMois();
        const totaux = await getTotauxParCat(depenses);
        const restant = BUDGETS[cat].max - totaux[cat];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
        await sendMessage(chatId, `✅ *${intention.montant} €* — _${BUDGETS[cat].label}_\n${emoji} Restant : *${restant.toFixed(0)} €* / ${BUDGETS[cat].max} €`);
        await envoyerMiniDashboard(chatId, ctx);
      } else {
        // Catégorie non détectée → proposer les boutons
        etatConversation = { etape: 'attente_montant_depense2', montantDetecte: intention.montant };
        await sendButtons(chatId, `💸 *${intention.montant} € — Quelle catégorie ?*`, btnCategories());
      }
      return;
    }

    if (intention.intention === 'salaire' && intention.montant) {
      await supabase.from('salaires').insert({ montant: intention.montant, libelle: texte, chat_id: chatId });
      await sendMessage(chatId, `✅ Salaire LGM : *${intention.montant} €* 📊`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.intention === 'epargne' && intention.montant) {
      await supabase.from('epargne').insert({ montant: intention.montant, libelle: texte, chat_id: chatId });
      await sendMessage(chatId, `✅ Épargne : *${intention.montant.toLocaleString()} €* 💎`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.intention === 'revenu' && intention.montant) {
      await supabase.from('revenus').insert({ montant: intention.montant, libelle: texte, chat_id: chatId });
      await sendMessage(chatId, `✅ Rentrée *+${intention.montant} €* enregistrée !`);
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.reponse_directe) {
      await sendMessage(chatId, intention.reponse_directe);
      return;
    }

    // ── RÉPONSE IA GÉNÉRALE ─────────────────────────────────
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const coursParEleve = {};
    ctx.cours.forEach(c => {
      if (!coursParEleve[c.eleve]) coursParEleve[c.eleve] = { nb: 0, gain: 0 };
      coursParEleve[c.eleve].nb++;
      coursParEleve[c.eleve].gain += c.gain;
    });

    const contextIA = `Tu es L'Agent, assistant personnel de Nour-Dine. Direct, bienveillant, naturel. Réponds en français conversationnel, 4-6 lignes max.
Tu comprends TOUJOURS même avec des fautes. Tu peux parler de tout : finances, achats, prix marché français, conseils.

PROFIL : Ingénieur LGM (Thales), départ août 2026. Dyneos SAS. Complétude 11 élèves. Formations incendie juin-juillet. IDF, PACS.
FINANCES : LGM ${ctx.salaire}€ | Beau-frère ${BEAU_FRERE}€ | Complétude ${ctx.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€ | Revenus ${ctx.totalRevenus.toFixed(0)}€ | Charges ${TOTAL_CHARGES_FIXES.toFixed(0)}€ | Dépenses ${ctx.totalDep.toFixed(0)}€ | Solde ${ctx.solde.toFixed(0)}€ | Épargne ${ctx.epargneBase.toLocaleString()}€ | Projection ${ctx.epargneEstimee.toFixed(0)}€
ÉLÈVES : ${Object.entries(ELEVES).map(([n,e]) => `${n} ${e.taux}€/h ${e.niveau}`).join(' | ')}
CE MOIS : ${Object.entries(coursParEleve).map(([e,d]) => `${e} ${d.nb}cours +${d.gain.toFixed(0)}€`).join(', ') || 'aucun cours'}

Message : "${texte}"`;

    await sendMessage(chatId, '🤔');
    const result = await model.generateContent(contextIA);
    await sendMessage(chatId, result.response.text());

  } catch (err) {
    console.error('Erreur:', err.message);
    await sendMessage(chatId, "❌ Erreur, réessaie dans quelques secondes.");
  }
});

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
