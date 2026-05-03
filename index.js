const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MODELE = 'gemini-3-flash-preview';

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

// État conversation
const sessions = {};

// ============================================================
// TELEGRAM
// ============================================================
async function send(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;
  const post = async (t) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: 'Markdown' })
    });
    const j = await r.json();
    if (!j.ok) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: t })
      });
    }
  };
  if (text.length <= MAX) { await post(text); return; }
  let reste = text;
  while (reste.length > 0) {
    let c = reste.length > MAX ? reste.lastIndexOf('\n', MAX) : reste.length;
    if (c < MAX / 2) c = Math.min(MAX, reste.length);
    await post(reste.slice(0, c));
    reste = reste.slice(c).trim();
    if (reste) await new Promise(r => setTimeout(r, 500));
  }
}

async function sendBtns(chatId, text, buttons) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons.map(row => row.map(b => ({ text: b.t, callback_data: b.d }))) }
    })
  });
}

async function answerCB(id) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id })
  });
}

async function removeBtns(chatId, msgId) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
  });
}

// ============================================================
// SUPABASE
// ============================================================
async function getData() {
  const debut = new Date();
  debut.setUTCDate(1);
  debut.setUTCHours(0, 0, 0, 0);
  const iso = debut.toISOString();

  const [d1, d2, d3, d4, d5, d6] = await Promise.all([
    supabase.from('depenses').select('*').gte('created_at', iso),
    supabase.from('cours').select('*').gte('created_at', iso),
    supabase.from('cours_manques').select('*').gte('created_at', iso),
    supabase.from('revenus').select('*').gte('created_at', iso),
    supabase.from('salaires').select('*').gte('created_at', iso).order('created_at', { ascending: false }).limit(1),
    supabase.from('epargne').select('*').order('created_at', { ascending: false }).limit(1),
  ]);

  const depenses = d1.data || [];
  const cours = d2.data || [];
  const coursManques = d3.data || [];
  const revenus = d4.data || [];
  const salaire = d5.data?.length > 0 ? d5.data[0].montant : SALAIRE_LGM_DEFAULT;
  const epargneBase = d6.data?.length > 0 ? d6.data[0].montant : EPARGNE_DEPART;

  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });

  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const totalManque = coursManques.reduce((s, c) => s + c.gain_manque, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const epargneEstimee = epargneBase + solde;

  return { depenses, cours, coursManques, revenus, totaux, totalDep, completude, totalManque, revenusSupp, totalRevenus, solde, epargneEstimee, salaire, epargneBase };
}

async function saveCours(chatId, eleve, heures, rattrapage) {
  const p = ELEVES[eleve];
  const gain = p.taux * heures;
  const { error } = await supabase.from('cours').insert({ eleve, duree: p.duree, taux: p.taux, gain, chat_id: String(chatId), rattrapage });
  if (error) console.error('saveCours error:', error);
  return gain;
}

async function saveCoursManque(chatId, eleve) {
  const gain_manque = ELEVES[eleve].taux;
  const { error } = await supabase.from('cours_manques').insert({ eleve, gain_manque, chat_id: String(chatId) });
  if (error) console.error('saveCoursManque error:', error);
  return gain_manque;
}

async function saveDepense(chatId, montant, categorie, libelle) {
  const { error } = await supabase.from('depenses').insert({ montant, categorie, libelle, chat_id: String(chatId) });
  if (error) console.error('saveDepense error:', error);
}

async function saveSalaire(chatId, montant) {
  const { error } = await supabase.from('salaires').insert({ montant, libelle: 'Salaire LGM', chat_id: String(chatId) });
  if (error) console.error('saveSalaire error:', error);
}

async function saveEpargne(chatId, montant) {
  const { error } = await supabase.from('epargne').insert({ montant, libelle: 'Epargne', chat_id: String(chatId) });
  if (error) console.error('saveEpargne error:', error);
}

async function saveRevenu(chatId, montant, libelle) {
  const { error } = await supabase.from('revenus').insert({ montant, libelle, chat_id: String(chatId) });
  if (error) console.error('saveRevenu error:', error);
}

// ============================================================
// GEMINI — UNIQUEMENT POUR PARLER
// ============================================================
async function geminiParle(chatId, message, data) {
  const model = genAI.getGenerativeModel({ model: MODELE });

  const ctx = `Tu es L'Agent, assistant personnel de Nour-Dine. Naturel, direct, bienveillant. Max 4 lignes.
Finances: LGM ${data.salaire}€, Beau-frere ${BEAU_FRERE}€, Completude ${data.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€, Solde ${data.solde.toFixed(0)}€, Epargne ${data.epargneBase}€
Eleves: ${Object.entries(ELEVES).map(([n,e]) => `${n} ${e.taux}€/h`).join(', ')}
Reponds naturellement en francais. Jamais de JSON ni de balises.`;

  const result = await model.generateContent(ctx + '\n\nMessage: ' + message);
  return result.response.text();
}

async function geminiGenFiche(eleve, chapitre) {
  const p = ELEVES[eleve];
  const model = genAI.getGenerativeModel({ model: MODELE });
  const base = `Texte brut uniquement. Fractions: "3/4". Puissances: "x^2". Max 600 mots. Corrige apres "=== CORRIGE ==="`;
  let prompt = p.ficheHebdo
    ? `Professeur maths. Fiche hebdo pour ${eleve} (${p.niveau}). Chapitre: ${chapitre}. ${base}. Lundi-Vendredi, 2 exos/jour.`
    : p.tda
    ? `Professeur TDA. Fiche pour ${eleve} (${p.niveau}). Chapitre: ${chapitre}. ${base}. Max 4 exos courts.`
    : `Professeur maths. Fiche pour ${eleve} (${p.niveau}). Chapitre: ${chapitre}. ${base}. 4 exos progressifs.`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// DÉTECTION RAPIDE (sans IA)
// ============================================================
function trouverEleve(texte) {
  const t = texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const nom of Object.keys(ELEVES)) {
    if (t.includes(nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return nom;
  }
  return null;
}

function trouverMontant(texte) {
  const m = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

function trouverCategorie(texte) {
  const t = texte.toLowerCase();
  if (/essence|plein|carburant|station|total|esso/.test(t)) return 'essence';
  if (/leclerc|courses|carrefour|lidl|cora|supermarche|aldi/.test(t)) return 'courses';
  if (/resto|restaurant|mcdo|burger|pizza|kebab|sushi/.test(t)) return 'restos';
  if (/medecin|pharmacie|docteur|sante|doctolib/.test(t)) return 'sante';
  if (/ikea|maison|bricolage|castorama/.test(t)) return 'maison';
  if (/garage|voiture|reparation|pneu|peage/.test(t)) return 'voiture';
  if (/vetement|zara|shopping|coiffeur|hm/.test(t)) return 'shopping';
  if (/cinema|loisir|concert|sport|sortie/.test(t)) return 'loisirs';
  return null;
}

// ============================================================
// RÉSUMÉ COMPLÉTUDE
// ============================================================
async function resumeCompletude(chatId) {
  const data = await getData();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - data.completude);
  const pct = Math.min(100, Math.round((data.completude / OBJECTIF_COMPLETUDE) * 100));
  const emoji = data.completude >= OBJECTIF_COMPLETUDE ? '🟢' : data.completude >= 1000 ? '🟡' : '🔴';
  await send(chatId,
    `${emoji} Completude: *${data.completude.toFixed(0)}€* / ${OBJECTIF_COMPLETUDE}€ (${pct}%)\n` +
    `${manque > 0 ? `⚠️ Il manque: *${manque.toFixed(0)}€*` : '🎉 Objectif atteint !'}`
  );
}

// ============================================================
// TRAITEMENT CALLBACK BOUTONS
// ============================================================
async function traiterCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data;

  await answerCB(cb.id);
  await removeBtns(chatId, msgId);

  const session = sessions[chatId] || {};

  // OUI/NON cours
  if (data === 'cours_oui' || data === 'cours_non') {
    const eleve = session.eleve;
    if (!eleve) return;

    if (data === 'cours_non') {
      const gain_manque = await saveCoursManque(chatId, eleve);
      delete sessions[chatId];
      await send(chatId, `❌ Cours ${eleve} non effectue\n💸 Manque a gagner: *-${gain_manque.toFixed(2)}€*`);
      return;
    }

    // Oui — demander 2h ou 1h si applicable
    if (ELEVES[eleve].question2h) {
      sessions[chatId] = { ...session, etape: 'question2h' };
      await sendBtns(chatId, `✅ Cours avec *${eleve}*\n\nC'etait la seance a 2h ?`, [
        [{ t: '2h (1ère séance)', d: 'h2' }, { t: '1h (séance suivante)', d: 'h1' }],
        [{ t: '❌ Annuler', d: 'annuler' }]
      ]);
    } else {
      const gain = await saveCours(chatId, eleve, ELEVES[eleve].duree, session.rattrapage || false);
      sessions[chatId] = { ...session, etape: 'chapitre' };
      await send(chatId, `✅ Cours ${eleve} enregistre ! *+${gain.toFixed(2)}€*`);
      await resumeCompletude(chatId);
      if (ELEVES[eleve].fiche) {
        await send(chatId, `📝 Qu'avez-vous vu aujourd'hui avec ${eleve} ?`);
      } else {
        delete sessions[chatId];
      }
    }
    return;
  }

  // 2h ou 1h
  if (data === 'h2' || data === 'h1') {
    const eleve = session.eleve;
    if (!eleve) return;
    const heures = data === 'h2' ? 2 : 1;
    const gain = await saveCours(chatId, eleve, heures, session.rattrapage || false);
    await send(chatId, `✅ Cours ${eleve} enregistre ! *+${gain.toFixed(2)}€*`);
    await resumeCompletude(chatId);
    if (ELEVES[eleve].fiche) {
      sessions[chatId] = { ...session, etape: 'chapitre' };
      await send(chatId, `📝 Qu'avez-vous vu aujourd'hui avec ${eleve} ?`);
    } else {
      delete sessions[chatId];
    }
    return;
  }

  // Catégorie dépense
  if (data.startsWith('cat_')) {
    const cat = data.replace('cat_', '');
    const montant = session.montant;
    if (!montant) return;
    await saveDepense(chatId, montant, cat, session.libelle || '');
    const newData = await getData();
    const restant = BUDGETS[cat].max - newData.totaux[cat];
    const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
    delete sessions[chatId];
    await send(chatId, `✅ *${montant}€* — ${BUDGETS[cat].label}\n${emoji} Restant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
    return;
  }

  // Annuler
  if (data === 'annuler') {
    delete sessions[chatId];
    await send(chatId, '❌ Action annulee.');
    return;
  }
}

// ============================================================
// WEBHOOK PRINCIPAL
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;

  // Callback bouton
  if (body.callback_query) {
    await traiterCallback(body.callback_query).catch(e => console.error('CB error:', e.message));
    return;
  }

  const msg = body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();
  const session = sessions[chatId] || {};

  try {

    // /start
    if (texte === '/start') {
      delete sessions[chatId];
      await send(chatId,
        `👋 Salut Nour-Dine ! Je suis *L'Agent*.\n\n` +
        `Parle-moi naturellement !\n\n` +
        `📚 _"cours avec Margaux"_ → signaler un cours\n` +
        `💸 _"Leclerc 45€"_ → dépense\n` +
        `❓ N'importe quelle question !\n\n` +
        `🌐 Dashboard: https://budget-bot-production-eaaf.up.railway.app/dashboard`
      );
      return;
    }

    // /reset
    if (texte === '/reset') {
      delete sessions[chatId];
      await send(chatId, '🔄 Conversation reinitialisee !');
      return;
    }

    // /bilan
    if (texte === '/bilan') {
      const data = await getData();
      let msg = `📊 *Bilan ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      Object.entries(data.totaux).forEach(([k, v]) => {
        const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      msg += `\n💰 *Solde: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
      await send(chatId, msg);
      return;
    }

    // /completude
    if (texte === '/completude') {
      const data = await getData();
      let msg = `📚 *Completude ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      msg += `🟢 *${data.completude.toFixed(2)}€* / ${OBJECTIF_COMPLETUDE}€\n`;
      msg += `Cours: ${data.cours.length}\n`;
      if (data.cours.length > 0) {
        msg += `\n*Detail:*\n`;
        data.cours.forEach(c => { msg += `• ${c.eleve}${c.rattrapage ? ' (rattrapage)' : ''}: +${c.gain.toFixed(2)}€\n`; });
      }
      if (data.coursManques.length > 0) {
        msg += `\n❌ *Manques:*\n`;
        data.coursManques.forEach(c => { msg += `• ${c.eleve}: -${c.gain_manque.toFixed(2)}€\n`; });
      }
      await send(chatId, msg);
      return;
    }

    // /objectifs
    if (texte === '/objectifs') {
      const data = await getData();
      let msg = `🎯 *Objectifs epargne*\n\n💼 Actuelle: *${data.epargneBase.toLocaleString()}€*\n📈 Projection: *${data.epargneEstimee.toFixed(0)}€*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = data.epargneEstimee - o.montant;
        const pct = Math.min(100, Math.round((data.epargneEstimee / o.montant) * 100));
        msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}*: ${o.montant.toLocaleString()}€ — ${pct}%\n`;
      });
      await send(chatId, msg);
      return;
    }

    // ── ÉTAT: attente chapitre pour fiche ──────────────────
    if (session.etape === 'chapitre' && session.eleve) {
      await send(chatId, `📝 Generation de la fiche pour ${session.eleve}...`);
      const fiche = await geminiGenFiche(session.eleve, texte);
      await send(chatId, fiche);
      delete sessions[chatId];
      return;
    }

    // ── ÉTAT: attente montant après catégorie ──────────────
    if (session.etape === 'attente_montant' && session.cat) {
      const montant = trouverMontant(texte);
      if (montant) {
        await saveDepense(chatId, montant, session.cat, texte);
        const newData = await getData();
        const restant = BUDGETS[session.cat].max - newData.totaux[session.cat];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[session.cat].max * 0.2 ? '🟡' : '🟢';
        delete sessions[chatId];
        await send(chatId, `✅ *${montant}€* — ${BUDGETS[session.cat].label}\n${emoji} Restant: *${restant.toFixed(0)}€* / ${BUDGETS[session.cat].max}€`);
      } else {
        await send(chatId, 'Envoie juste le montant, ex: *45*');
      }
      return;
    }

    // ── DÉTECTION COURS ────────────────────────────────────
    const eleve = trouverEleve(texte);
    const isCours = /cours|rattrapage|seance/i.test(texte);
    const isPasFait = /pas fait|absent|annule|pas pu|rate/i.test(texte);

    if (eleve && isCours) {
      const rattrapage = /rattrapage/i.test(texte);

      if (isPasFait) {
        // Cours manqué direct
        const gain_manque = await saveCoursManque(chatId, eleve);
        await send(chatId, `❌ Cours ${eleve} non effectue\n💸 Manque: *-${gain_manque.toFixed(2)}€*`);
        return;
      }

      // Demander si fait ou pas
      sessions[chatId] = { eleve, rattrapage, etape: 'confirmation' };
      await sendBtns(chatId,
        `📚 Cours avec *${eleve}*${rattrapage ? ' _(rattrapage)_' : ''} — effectue ?`,
        [
          [{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }],
          [{ t: '↩️ Annuler', d: 'annuler' }]
        ]
      );
      return;
    }

    // ── DÉTECTION DÉPENSE ──────────────────────────────────
    const montant = trouverMontant(texte);
    const cat = trouverCategorie(texte);

    if (montant && montant > 0 && montant < 5000 && !isCours) {
      if (cat) {
        // Catégorie détectée → enregistre direct
        await saveDepense(chatId, montant, cat, texte);
        const newData = await getData();
        const restant = BUDGETS[cat].max - newData.totaux[cat];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
        await send(chatId, `✅ *${montant}€* — ${BUDGETS[cat].label}\n${emoji} Restant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
      } else {
        // Catégorie inconnue → propose boutons
        sessions[chatId] = { montant, libelle: texte, etape: 'choix_cat' };
        const cats = Object.entries(BUDGETS);
        const rows = [];
        for (let i = 0; i < cats.length; i += 3) {
          rows.push(cats.slice(i, i + 3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
        }
        rows.push([{ t: '↩️ Annuler', d: 'annuler' }]);
        await sendBtns(chatId, `💸 *${montant}€* — Quelle catégorie ?`, rows);
      }
      return;
    }

    // ── DÉTECTION SALAIRE ──────────────────────────────────
    if (/salaire|lgm|paie/i.test(texte) && montant && montant > 1000) {
      await saveSalaire(chatId, montant);
      await send(chatId, `✅ Salaire LGM enregistre: *${montant}€* 📊`);
      return;
    }

    // ── DÉTECTION ÉPARGNE ──────────────────────────────────
    if (/epargne|épargne|economies/i.test(texte) && montant && montant > 1000) {
      await saveEpargne(chatId, montant);
      await send(chatId, `✅ Epargne mise a jour: *${montant.toLocaleString()}€* 💎`);
      return;
    }

    // ── DÉTECTION REVENU ───────────────────────────────────
    if (/recu|vinted|remboursement|rentree|participation/i.test(texte) && montant) {
      await saveRevenu(chatId, montant, texte);
      await send(chatId, `✅ Rentree *+${montant}€* enregistree !`);
      return;
    }

    // ── GEMINI RÉPOND (questions générales) ────────────────
    const data = await getData();
    const reponse = await geminiParle(chatId, texte, data);
    await send(chatId, reponse);

  } catch (err) {
    console.error('Erreur webhook:', err.message);
    await send(chatId, 'Erreur technique, reessaie.');
  }
});

// ============================================================
// MESSAGES AUTOMATIQUES
// ============================================================
async function envoyerRappelBiHebdo() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  let msg = `📋 *Rappel bi-hebdo — ${mois}*\n\n`;
  msg += `💰 LGM: ${data.salaire}€ | Beau-frere: ${BEAU_FRERE}€ | Completude: ${data.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€\n\n`;
  msg += `💸 *Depenses:*\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 Solde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
  if (data.totalManque > 0) msg += `\n💸 Manques: *-${data.totalManque.toFixed(0)}€*`;
  msg += `\n\n_Des depenses a enregistrer ?_`;
  await send(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase();
  let msg = `🗓️ *SYNTHESE ${mois}*\n\n`;
  msg += `✅ *REVENUS: ${data.totalRevenus.toFixed(0)}€*\n• LGM: ${data.salaire}€\n• Beau-frere: ${BEAU_FRERE}€\n• Completude: ${data.completude.toFixed(0)}€\n`;
  msg += `\n🔒 *CHARGES: -${TOTAL_CHARGES_FIXES.toFixed(0)}€*\n\n💸 *DEPENSES: -${data.totalDep.toFixed(0)}€*\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
  });
  msg += `\n💰 *SOLDE: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*\n\n🎯 *OBJECTIFS:*\n`;
  OBJECTIFS.forEach(o => {
    const delta = data.epargneEstimee - o.montant;
    msg += `${delta >= 0 ? '✅' : '⚠️'} ${o.label}: ${o.montant.toLocaleString()}€ (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}€)\n`;
  });
  await send(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER
// ============================================================
function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

function demarrerScheduler() {
  setInterval(() => {
    fetch(`https://budget-bot-production-eaaf.up.railway.app/`).catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const jour = now.getDay(), heure = now.getHours(), minute = now.getMinutes();

    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) await envoyerRappelBiHebdo();
    if (now.getDate() === 30 && heure === 20 && minute === 0) await envoyerSyntheseMensuelle();

    for (const [nomEleve, profil] of Object.entries(ELEVES)) {
      if (profil.jour !== jour) continue;
      if (profil.uneSemaineSurDeux && !estSemaineSerena()) continue;
      const totalMin = profil.minute + Math.floor(profil.duree * 60);
      const heureFin = profil.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        sessions[CHAT_ID] = { eleve: nomEleve, rattrapage: false, etape: 'confirmation' };
        await sendBtns(CHAT_ID,
          `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${nomEleve}* ?`,
          [
            [{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }],
            [{ t: '↩️ Annuler', d: 'annuler' }]
          ]
        );
      }
    }
  }, 60000);
}

// ============================================================
// API DASHBOARD
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getData();
    res.json({
      salaire: data.salaire, beau_frere: BEAU_FRERE,
      completude: data.completude, objectif_completude: OBJECTIF_COMPLETUDE,
      total_revenus: data.totalRevenus, charges_fixes: TOTAL_CHARGES_FIXES,
      total_dep: data.totalDep, solde: data.solde,
      epargne_base: data.epargneBase, epargne_estimee: data.epargneEstimee,
      total_manque: data.totalManque, nb_cours: data.cours.length,
      nb_cours_manques: data.coursManques.length,
      cours: data.cours, cours_manques: data.coursManques,
      totaux: data.totaux, budgets: BUDGETS, objectifs: OBJECTIFS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DASHBOARD HTML
// ============================================================
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>L'Agent</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f13;color:#e8e8f0;min-height:100vh;padding:1rem}
.header{text-align:center;padding:1.2rem 0 0.8rem}
.header h1{font-size:1.3rem;font-weight:700;color:#fff}
.header p{font-size:0.7rem;color:#555;margin-top:3px}
.tabs{display:flex;gap:4px;max-width:420px;margin:0.8rem auto;background:#1a1a22;border-radius:12px;padding:4px}
.tab{flex:1;text-align:center;padding:6px 4px;font-size:0.68rem;border-radius:8px;cursor:pointer;color:#555;transition:all 0.2s}
.tab.active{background:#2a2a36;color:#fff;font-weight:600}
.section{display:none;max-width:420px;margin:0 auto}
.section.active{display:block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0.6rem}
.card{background:#1a1a22;border-radius:14px;padding:0.9rem;border:1px solid #22222e}
.card.full{grid-column:1/-1}
.label{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.07em;color:#555;margin-bottom:5px}
.value{font-size:1.5rem;font-weight:700}
.sub{font-size:0.65rem;color:#555;margin-top:3px}
.green{color:#4ade80}.amber{color:#fbbf24}.red{color:#f87171}
.bar{height:5px;background:#22222e;border-radius:3px;overflow:hidden;margin:7px 0 3px}
.fill{height:100%;border-radius:3px;transition:width 0.5s}
.row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #22222e;font-size:0.78rem}
.row:last-child{border-bottom:none}
.mini-bar{width:50px;height:4px;background:#22222e;border-radius:2px;overflow:hidden}
.mini-fill{height:100%;border-radius:2px}
.obj{padding:9px 0;border-bottom:1px solid #22222e}
.obj:last-child{border-bottom:none}
.obj-header{display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:5px}
.cours-row{display:flex;justify-content:space-between;font-size:0.72rem;padding:4px 0;border-bottom:1px solid #22222e}
.cours-row:last-child{border-bottom:none}
.refresh{position:fixed;bottom:1.2rem;right:1.2rem;background:#6366f1;color:#fff;border:none;border-radius:50%;width:44px;height:44px;font-size:1.1rem;cursor:pointer;box-shadow:0 3px 10px rgba(99,102,241,0.4)}
.updated{text-align:center;font-size:0.62rem;color:#333;padding:1rem 0 4rem}
</style>
</head>
<body>
<div class="header"><h1>🤖 L'Agent</h1><p id="mois">Chargement...</p></div>
<div class="tabs">
  <div class="tab active" onclick="setTab('apercu')">Apercu</div>
  <div class="tab" onclick="setTab('completude')">Completude</div>
  <div class="tab" onclick="setTab('budgets')">Budgets</div>
  <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
</div>
<div class="section active" id="tab-apercu">
  <div class="grid">
    <div class="card"><div class="label">Epargne actuelle</div><div class="value green" id="a-ep">—</div></div>
    <div class="card"><div class="label">Projection fin mois</div><div class="value" id="a-pr">—</div></div>
    <div class="card"><div class="label">Revenus ce mois</div><div class="value green" id="a-rv">—</div></div>
    <div class="card"><div class="label">Depenses variables</div><div class="value red" id="a-dp">—</div></div>
    <div class="card full"><div class="label">Solde estime</div><div class="value" id="a-sl">—</div><div class="bar"><div class="fill" id="a-sl-b" style="width:0%"></div></div><div class="sub" id="a-sl-d">—</div></div>
    <div class="card full"><div class="label">Completude ce mois</div><div class="value" id="a-co">—</div><div class="bar"><div class="fill" id="a-co-b" style="width:0%"></div></div><div class="sub" id="a-co-s">—</div></div>
  </div>
</div>
<div class="section" id="tab-completude">
  <div class="grid">
    <div class="card"><div class="label">Cours effectues</div><div class="value green" id="c-nb">—</div></div>
    <div class="card"><div class="label">Cours manques</div><div class="value red" id="c-mn">—</div><div class="sub" id="c-mv">—</div></div>
    <div class="card full"><div class="label" style="margin-bottom:10px">Detail cours</div><div id="c-ls">—</div></div>
    <div class="card full" id="c-mc" style="display:none"><div class="label" style="margin-bottom:10px">Cours manques</div><div id="c-ml">—</div></div>
  </div>
</div>
<div class="section" id="tab-budgets"><div class="grid"><div class="card full" id="b-ls">Chargement...</div></div></div>
<div class="section" id="tab-objectifs"><div class="grid"><div class="card full" id="o-ls">Chargement...</div></div></div>
<button class="refresh" onclick="charger()">↻</button>
<div class="updated" id="upd">—</div>
<script>
function setTab(t){document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',['apercu','completude','budgets','objectifs'][i]===t));document.querySelectorAll('.section').forEach(el=>el.classList.remove('active'));document.getElementById('tab-'+t).classList.add('active')}
function fmt(n){return Math.round(n).toLocaleString('fr-FR')+' €'}
function pct(v,m){return Math.min(100,Math.round(v/m*100))}
function col(p){return p>=100?'#f87171':p>=80?'#fbbf24':'#4ade80'}
function cs(v){return v>=500?'#4ade80':v>=0?'#fbbf24':'#f87171'}
async function charger(){
  try{
    const r=await fetch('/api/dashboard');const d=await r.json();
    const mois=new Date().toLocaleString('fr-FR',{month:'long',year:'numeric'});
    document.getElementById('mois').textContent=mois.charAt(0).toUpperCase()+mois.slice(1);
    document.getElementById('a-ep').textContent=fmt(d.epargne_base);
    const pr=document.getElementById('a-pr');pr.textContent=fmt(d.epargne_estimee);pr.className='value '+(d.epargne_estimee>=12500?'green':d.epargne_estimee>=10000?'amber':'red');
    document.getElementById('a-rv').textContent=fmt(d.total_revenus);
    document.getElementById('a-dp').textContent='-'+fmt(d.total_dep);
    const sl=document.getElementById('a-sl');sl.textContent=(d.solde>=0?'+':'')+fmt(d.solde);sl.style.color=cs(d.solde);
    const sp=Math.min(100,Math.max(0,(d.solde/1500)*100));
    document.getElementById('a-sl-b').style.cssText='width:'+sp+'%;background:'+cs(d.solde);
    document.getElementById('a-sl-d').textContent=fmt(d.total_revenus)+' - '+fmt(d.charges_fixes)+' - '+fmt(d.total_dep);
    const cp=pct(d.completude,d.objectif_completude);const co=document.getElementById('a-co');co.textContent=fmt(d.completude);co.style.color=col(cp);
    document.getElementById('a-co-b').style.cssText='width:'+cp+'%;background:'+col(cp);
    document.getElementById('a-co-s').textContent=fmt(d.completude)+' / '+fmt(d.objectif_completude)+' ('+cp+'%)';
    document.getElementById('c-nb').textContent=d.nb_cours;
    document.getElementById('c-mn').textContent=d.nb_cours_manques;
    document.getElementById('c-mv').textContent='-'+fmt(d.total_manque)+' manques';
    const cl=document.getElementById('c-ls');
    cl.innerHTML=d.cours.length===0?'<div style="color:#555;font-size:0.72rem;padding:6px 0">Aucun cours ce mois</div>':d.cours.map(c=>'<div class="cours-row"><span>'+c.eleve+(c.rattrapage?' <span style="color:#555">(rattrapage)</span>':'')+'</span><span class="green">+'+c.gain.toFixed(2)+' €</span></div>').join('');
    if(d.nb_cours_manques>0){document.getElementById('c-mc').style.display='block';document.getElementById('c-ml').innerHTML=d.cours_manques.map(c=>'<div class="cours-row"><span>'+c.eleve+'</span><span class="red">-'+c.gain_manque.toFixed(2)+' €</span></div>').join('')}
    const bl=document.getElementById('b-ls');bl.innerHTML='<div class="label" style="margin-bottom:10px">Depenses variables</div>';
    Object.entries(d.totaux).forEach(([k,v])=>{const b=d.budgets[k];const p=pct(v,b.max);const c=col(p);bl.innerHTML+='<div class="row"><span>'+b.label+'</span><div style="display:flex;align-items:center;gap:8px"><div class="mini-bar"><div class="mini-fill" style="width:'+p+'%;background:'+c+'"></div></div><span style="color:'+c+';min-width:75px;text-align:right">'+v.toFixed(0)+'€ / '+b.max+'€</span></div></div>'});
    const ol=document.getElementById('o-ls');ol.innerHTML='<div class="label" style="margin-bottom:10px">Progression epargne</div>';
    d.objectifs.forEach(o=>{const p=pct(d.epargne_estimee,o.montant);const c=col(p);const delta=Math.round(d.epargne_estimee-o.montant);ol.innerHTML+='<div class="obj"><div class="obj-header"><span>'+(delta>=0?'✅':'⚠️')+' '+o.label+'</span><span style="color:'+c+'">'+(delta>=0?'+':'')+delta.toLocaleString()+' €</span></div><div class="bar"><div class="fill" style="width:'+p+'%;background:'+c+'"></div></div><div style="display:flex;justify-content:space-between;font-size:0.62rem;color:#555;margin-top:3px"><span>'+Math.round(d.epargne_estimee).toLocaleString()+' €</span><span>'+o.montant.toLocaleString()+' €</span></div></div>'});
    document.getElementById('upd').textContent='Actualise a '+new Date().toLocaleTimeString('fr-FR');
  }catch(e){document.getElementById('upd').textContent='Erreur de chargement'}
}
charger();setInterval(charger,30000);
</script>
</body>
</html>`);
});

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent ecoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
