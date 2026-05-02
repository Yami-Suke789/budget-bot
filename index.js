const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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

// Historique conversation par chat (mémoire Gemini)
const historiqueChats = {};

// ============================================================
// TELEGRAM
// ============================================================
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 3800;
  const envoyer = async (t) => {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: t, parse_mode: 'Markdown' })
    });
  };
  if (text.length <= MAX) { await envoyer(text); return; }
  let reste = text;
  while (reste.length > 0) {
    let coupe = reste.length > MAX ? reste.lastIndexOf('\n', MAX) : reste.length;
    if (coupe < MAX / 2) coupe = MAX;
    await envoyer(reste.slice(0, coupe));
    reste = reste.slice(coupe).trim();
    if (reste) await new Promise(r => setTimeout(r, 400));
  }
}

async function sendButtons(chatId, text, buttons) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons.map(ligne => ligne.map(b => ({ text: b.text, callback_data: b.data }))) }
    })
  });
}

async function answerCallback(id) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id })
  });
}

async function removeButtons(chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  });
}

// ============================================================
// SUPABASE
// ============================================================
async function getData() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
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

// ============================================================
// GÉNÉRATION FICHE
// ============================================================
async function genererFiche(nomEleve, chapitre) {
  const p = ELEVES[nomEleve];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const base = `Règles : texte brut, fractions "3/4", puissances "x^2", max 600 mots, corrigé après "=== CORRIGÉ ==="`;
  let prompt = p.ficheHebdo
    ? `Professeur maths. Fiche hebdo pour ${nomEleve} (${p.niveau}). Chapitre: ${chapitre}. ${base}. Lundi→Vendredi, 2 exos/jour. Titre: "FICHE HEBDO — ${nomEleve} — ${chapitre}"`
    : p.tda
    ? `Professeur TDA. Fiche pour ${nomEleve} (${p.niveau}). Chapitre: ${chapitre}. ${base}. Max 4 exos courts, 1 consigne par exo. Titre: "FICHE TDA — ${nomEleve} — ${chapitre}"`
    : `Professeur maths. Fiche pour ${nomEleve} (${p.niveau}). Chapitre: ${chapitre}. ${base}. 4 exos progressifs niveau ${p.niveau}. Titre: "FICHE — ${nomEleve} — ${chapitre}"`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// ENREGISTREMENTS
// ============================================================
async function enregistrerCours(chatId, nomEleve, heures, rattrapage) {
  const p = ELEVES[nomEleve];
  const gain = p.taux * heures;
  await supabase.from('cours').insert({ eleve: nomEleve, duree: p.duree, taux: p.taux, gain, chat_id: chatId, rattrapage });
  return gain;
}

async function enregistrerCoursManque(nomEleve, chatId) {
  const gain_manque = ELEVES[nomEleve].taux * 1;
  await supabase.from('cours_manques').insert({ eleve: nomEleve, gain_manque, chat_id: chatId });
  return gain_manque;
}

// ============================================================
// CERVEAU IA — GEMINI GÈRE TOUT
// ============================================================
async function cerveauIA(chatId, messageUtilisateur) {
  const data = await getData();

  // Construire historique
  if (!historiqueChats[chatId]) historiqueChats[chatId] = [];
  const historique = historiqueChats[chatId];

  // Contexte complet pour Gemini
  const systemPrompt = `Tu es L'Agent, l'assistant personnel intelligent de Nour-Dine. Tu gères ses finances et ses cours Complétude.

PERSONNALITÉ :
- Tu es comme un ami proche : naturel, direct, bienveillant, jamais robotique
- Tu comprends TOUJOURS même avec des fautes d'orthographe ou des formulations approximatives
- Tu poses des questions naturelles pour clarifier, jamais de façon mécanique
- Tu t'adaptes au contexte de la conversation

PROFIL NOUR-DINE :
- Ingénieur cadre LGM (mission Thales), départ prévu août 2026 via rupture conventionnelle
- Co-fondateur Dyneos SAS (CFA formations pro)
- Tuteur Complétude (11 élèves), objectif 1500€/mois
- Certification formateur incendie (Fo.EPI juin 2026, SSIAP 1 juillet 2026)
- Vit en Île-de-France (Carrières-sous-Poissy), en PACS
- Épargne cible : juin 12500€, août 15000€, janvier 2027 20000€ (hors tontine 13000€)

DONNÉES FINANCIÈRES TEMPS RÉEL :
- Salaire LGM : ${data.salaire}€/mois
- Beau-frère : ${BEAU_FRERE}€/mois (jusqu'en novembre 2026)
- Complétude ce mois : ${data.completude.toFixed(2)}€ / ${OBJECTIF_COMPLETUDE}€ objectif
- Total revenus ce mois : ${data.totalRevenus.toFixed(2)}€
- Charges fixes : ${TOTAL_CHARGES_FIXES.toFixed(2)}€/mois
- Dépenses variables : ${data.totalDep.toFixed(2)}€
- Solde estimé ce mois : ${data.solde.toFixed(2)}€
- Épargne actuelle : ${data.epargneBase.toLocaleString()}€
- Épargne projetée fin de mois : ${data.epargneEstimee.toFixed(2)}€
- Cours manqués ce mois : ${data.coursManques.length} cours — -${data.totalManque.toFixed(2)}€

BUDGETS CE MOIS :
${Object.entries(data.totaux).map(([k, v]) => `- ${BUDGETS[k].label}: ${v.toFixed(2)}€ / ${BUDGETS[k].max}€`).join('\n')}

ÉLÈVES COMPLÉTUDE :
${Object.entries(ELEVES).map(([n, e]) => `- ${n}: ${e.taux}€/h, ${e.niveau}${e.tda ? ', TDA' : ''}${e.ficheHebdo ? ', fiche hebdo' : ''}, ${e.question2h ? '2h possible' : '1h fixe'}${e.fiche ? ', génère fiche' : ', pas de fiche'}`).join('\n')}

COURS CE MOIS :
${data.cours.length === 0 ? 'Aucun cours enregistré' : data.cours.map(c => `- ${c.eleve}: +${c.gain.toFixed(2)}€${c.rattrapage ? ' (rattrapage)' : ''}`).join('\n')}

ACTIONS DISPONIBLES (retourne un JSON d'action en plus de ta réponse) :
Tu peux déclencher ces actions en incluant à la FIN de ta réponse un bloc JSON entre balises <action> et </action> :

1. Enregistrer un cours fait :
<action>{"type":"cours_fait","eleve":"NomEleve","heures":1ou2,"rattrapage":false}</action>

2. Enregistrer un cours manqué :
<action>{"type":"cours_manque","eleve":"NomEleve"}</action>

3. Enregistrer une dépense :
<action>{"type":"depense","montant":45,"categorie":"courses","libelle":"Leclerc"}</action>

4. Enregistrer le salaire :
<action>{"type":"salaire","montant":2625}</action>

5. Mettre à jour l'épargne :
<action>{"type":"epargne","montant":9500}</action>

6. Enregistrer une rentrée :
<action>{"type":"revenu","montant":50,"libelle":"Vinted"}</action>

7. Générer une fiche d'exercices :
<action>{"type":"fiche","eleve":"NomEleve","chapitre":"Fractions"}</action>

RÈGLES IMPORTANTES :
- Quand quelqu'un mentionne un cours, demande naturellement les infos manquantes (élève, fait ou pas, combien d'heures si applicable)
- Quand tu as toutes les infos pour une action, déclenche-la automatiquement
- Ne demande jamais plusieurs choses à la fois — une question à la fois
- Si le contexte est clair, agis directement sans demander de confirmation
- Pour les fiches : après avoir enregistré un cours, demande naturellement ce qu'ils ont vu
- Sois concis dans tes réponses texte (3-5 lignes max sauf si question complexe)
- Tu peux répondre à n'importe quelle question : prix du marché, conseils, vie quotidienne, etc.`;

  // Ajouter le message de l'utilisateur à l'historique
  historique.push({ role: 'user', parts: [{ text: messageUtilisateur }] });

  // Limiter l'historique à 20 messages
  if (historique.length > 20) historique.splice(0, historique.length - 20);

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const chat = model.startChat({
    history: historique.slice(0, -1).map(h => ({ role: h.role, parts: h.parts })),
    systemInstruction: systemPrompt,
  });

  const result = await chat.sendMessage(messageUtilisateur);
  const reponseComplete = result.response.text();

  // Ajouter la réponse à l'historique
  historique.push({ role: 'model', parts: [{ text: reponseComplete }] });

  // Extraire l'action JSON si présente
  const actionMatch = reponseComplete.match(/<action>([\s\S]*?)<\/action>/);
  const texteReponse = reponseComplete.replace(/<action>[\s\S]*?<\/action>/g, '').trim();

  return { texteReponse, action: actionMatch ? JSON.parse(actionMatch[1]) : null, data };
}

// ============================================================
// TRAITER ACTION
// ============================================================
async function traiterAction(chatId, action, data) {
  if (!action) return;

  try {
    switch (action.type) {

      case 'cours_fait': {
        const eleve = action.eleve;
        if (!ELEVES[eleve]) break;
        const gain = await enregistrerCours(chatId, eleve, action.heures || 1, action.rattrapage || false);
        const newData = await getData();
        const manque = Math.max(0, OBJECTIF_COMPLETUDE - newData.completude);
        const emoji = newData.completude >= OBJECTIF_COMPLETUDE ? '🟢' : newData.completude >= 1000 ? '🟡' : '🔴';
        await sendMessage(chatId,
          `✅ *Cours ${eleve} enregistré !*\n` +
          `💰 +${gain.toFixed(2)} €\n\n` +
          `${emoji} Complétude : *${newData.completude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n` +
          `${manque > 0 ? `⚠️ Il manque : ${manque.toFixed(0)} €` : '🎉 Objectif atteint !'}`
        );
        break;
      }

      case 'cours_manque': {
        const eleve = action.eleve;
        if (!ELEVES[eleve]) break;
        const gain_manque = await enregistrerCoursManque(eleve, chatId);
        await sendMessage(chatId,
          `❌ *Cours ${eleve} — non effectué*\n` +
          `💸 Manque à gagner : -${gain_manque.toFixed(2)} €`
        );
        break;
      }

      case 'depense': {
        const cat = action.categorie || 'divers';
        await supabase.from('depenses').insert({ montant: action.montant, categorie: cat, libelle: action.libelle || '', chat_id: chatId });
        const newData = await getData();
        const restant = BUDGETS[cat].max - newData.totaux[cat];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
        await sendMessage(chatId,
          `✅ *${action.montant} €* — ${BUDGETS[cat].label}\n` +
          `${emoji} Budget restant : *${restant.toFixed(0)} €* / ${BUDGETS[cat].max} €`
        );
        break;
      }

      case 'salaire': {
        await supabase.from('salaires').insert({ montant: action.montant, libelle: 'Salaire LGM', chat_id: chatId });
        await sendMessage(chatId, `✅ Salaire LGM enregistré : *${action.montant} €* 📊`);
        break;
      }

      case 'epargne': {
        await supabase.from('epargne').insert({ montant: action.montant, libelle: 'Mise à jour épargne', chat_id: chatId });
        await sendMessage(chatId, `✅ Épargne mise à jour : *${action.montant.toLocaleString()} €* 💎`);
        break;
      }

      case 'revenu': {
        await supabase.from('revenus').insert({ montant: action.montant, libelle: action.libelle || '', chat_id: chatId });
        await sendMessage(chatId, `✅ Rentrée *+${action.montant} €* enregistrée !`);
        break;
      }

      case 'fiche': {
        const eleve = action.eleve;
        if (!ELEVES[eleve] || !ELEVES[eleve].fiche) break;
        await sendMessage(chatId, `📝 *Génération de la fiche pour ${eleve}...*`);
        const fiche = await genererFiche(eleve, action.chapitre);
        await sendMessage(chatId, fiche);
        break;
      }
    }
  } catch (err) {
    console.error('Erreur action:', err.message);
  }
}

// ============================================================
// MESSAGES AUTO
// ============================================================
async function envoyerRappelBiHebdo() {
  const data = await getData();
  let msg = `📋 *Rappel bi-hebdo — ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
  msg += `💰 LGM: ${data.salaire}€ | Beau-frère: ${BEAU_FRERE}€ | Complétude: ${data.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€\n\n`;
  msg += `💸 *Dépenses :*\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 Solde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
  if (data.totalManque > 0) msg += `\n💸 Cours manqués: *-${data.totalManque.toFixed(0)}€*`;
  msg += `\n\n_Des dépenses ou rentrées à enregistrer ?_`;
  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  let msg = `🗓️ *SYNTHÈSE ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase()}*\n\n`;
  msg += `✅ *REVENUS: ${data.totalRevenus.toFixed(0)}€*\n• LGM: ${data.salaire}€\n• Beau-frère: ${BEAU_FRERE}€\n• Complétude: ${data.completude.toFixed(0)}€ (${data.cours.length} cours)\n`;
  if (data.revenusSupp > 0) msg += `• Autres: ${data.revenusSupp.toFixed(0)}€\n`;
  msg += `\n🔒 *CHARGES: -${TOTAL_CHARGES_FIXES.toFixed(0)}€*\n\n💸 *DÉPENSES: -${data.totalDep.toFixed(0)}€*\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
  });
  if (data.coursManques.length > 0) {
    msg += `\n📉 *COURS MANQUÉS: ${data.coursManques.length} — -${data.totalManque.toFixed(0)}€*\n`;
    data.coursManques.forEach(c => { msg += `• ${c.eleve}: -${c.gain_manque.toFixed(2)}€\n`; });
  }
  msg += `\n💰 *SOLDE NET: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*\n\n🎯 *OBJECTIFS:*\n`;
  OBJECTIFS.forEach(o => {
    const delta = data.epargneEstimee - o.montant;
    const pct = Math.min(100, Math.round((data.epargneEstimee / o.montant) * 100));
    const e = delta >= 0 ? '✅' : '⚠️';
    msg += `${e} *${o.label}*: ${o.montant.toLocaleString()}€ — ${pct}% (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}€)\n`;
  });
  await sendMessage(CHAT_ID, msg);
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
        // L'IA démarre naturellement la conversation sur le cours
        const { texteReponse, action, data } = await cerveauIA(
          CHAT_ID,
          `[SYSTÈME] Le cours de ${nomEleve} vient de se terminer. Demande naturellement à Nour-Dine s'il a fait ce cours.`
        );
        await sendMessage(CHAT_ID, texteReponse);
        if (action) await traiterAction(CHAT_ID, action, data);
      }
    }
  }, 60000);
}

// ============================================================
// API DASHBOARD (données temps réel)
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getData();
    res.json({
      salaire: data.salaire,
      beau_frere: BEAU_FRERE,
      completude: data.completude,
      objectif_completude: OBJECTIF_COMPLETUDE,
      total_revenus: data.totalRevenus,
      charges_fixes: TOTAL_CHARGES_FIXES,
      total_dep: data.totalDep,
      solde: data.solde,
      epargne_base: data.epargneBase,
      epargne_estimee: data.epargneEstimee,
      total_manque: data.totalManque,
      nb_cours: data.cours.length,
      nb_cours_manques: data.coursManques.length,
      cours: data.cours,
      cours_manques: data.coursManques,
      totaux: data.totaux,
      budgets: BUDGETS,
      objectifs: OBJECTIFS,
      charges_detail: CHARGES_FIXES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WEBHOOK TELEGRAM
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;

  // Callbacks (boutons) — plus utilisés dans la nouvelle archi mais gardés pour compatibilité
  if (body.callback_query) {
    await answerCallback(body.callback_query.id);
    await removeButtons(body.callback_query.message.chat.id, body.callback_query.message.message_id);
    // On passe le callback comme message texte à l'IA
    const chatId = body.callback_query.message.chat.id;
    const data_cb = body.callback_query.data;
    const { texteReponse, action, data } = await cerveauIA(chatId, `[Utilisateur a cliqué: ${data_cb}]`);
    if (texteReponse) await sendMessage(chatId, texteReponse);
    if (action) await traiterAction(chatId, action, data);
    return;
  }

  const msg = body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();

  try {
    // Commandes spéciales
    if (texte === '/start') {
      historiqueChats[chatId] = []; // Reset historique
      await sendMessage(chatId,
        `👋 Salut Nour-Dine ! Je suis *L'Agent*.\n\n` +
        `Parle-moi naturellement — je comprends tout !\n\n` +
        `💸 _"J'ai fait le plein, 60€"_\n` +
        `📚 _"Cours avec Margaux ce matin"_\n` +
        `❓ _"Est-ce que je peux m'offrir un vélo ?"_\n` +
        `📊 _"Montre-moi mon bilan"_\n\n` +
        `Le dashboard en temps réel est disponible sur :\n` +
        `🌐 https://budget-bot-production-eaaf.up.railway.app/dashboard`
      );
      return;
    }

    if (texte === '/reset') {
      historiqueChats[chatId] = [];
      await sendMessage(chatId, `🔄 Conversation réinitialisée !`);
      return;
    }

    // Tout passe par le cerveau IA
    const { texteReponse, action, data } = await cerveauIA(chatId, texte);
    if (texteReponse) await sendMessage(chatId, texteReponse);
    if (action) await traiterAction(chatId, action, data);

  } catch (err) {
    console.error('Erreur webhook:', err.message);
    await sendMessage(chatId, "❌ Erreur, réessaie dans quelques secondes.");
  }
});

// ============================================================
// ROUTE DASHBOARD HTML
// ============================================================
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>L'Agent — Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f13; color: #e8e8f0; min-height: 100vh; padding: 1rem; }
  .header { text-align: center; padding: 1.5rem 0 1rem; }
  .header h1 { font-size: 1.4rem; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
  .header p { font-size: 0.75rem; color: #666; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; max-width: 420px; margin: 0 auto; }
  .card { background: #1a1a22; border-radius: 16px; padding: 1rem; border: 1px solid #2a2a36; }
  .card.full { grid-column: 1 / -1; }
  .card-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-bottom: 6px; }
  .card-value { font-size: 1.6rem; font-weight: 700; }
  .card-sub { font-size: 0.7rem; color: #666; margin-top: 4px; }
  .green { color: #4ade80; }
  .amber { color: #fbbf24; }
  .red { color: #f87171; }
  .progress-bar { height: 6px; background: #2a2a36; border-radius: 3px; overflow: hidden; margin: 8px 0 4px; }
  .progress-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
  .budget-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #2a2a36; font-size: 0.8rem; }
  .budget-item:last-child { border-bottom: none; }
  .budget-bar { width: 60px; height: 4px; background: #2a2a36; border-radius: 2px; overflow: hidden; }
  .budget-fill { height: 100%; border-radius: 2px; }
  .objectif-item { padding: 10px 0; border-bottom: 1px solid #2a2a36; }
  .objectif-item:last-child { border-bottom: none; }
  .objectif-header { display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 6px; }
  .cours-list { max-height: 150px; overflow-y: auto; }
  .cours-item { display: flex; justify-content: space-between; font-size: 0.75rem; padding: 4px 0; border-bottom: 1px solid #2a2a36; }
  .cours-item:last-child { border-bottom: none; }
  .refresh-btn { position: fixed; bottom: 1.5rem; right: 1.5rem; background: #6366f1; color: white; border: none; border-radius: 50%; width: 48px; height: 48px; font-size: 1.2rem; cursor: pointer; box-shadow: 0 4px 12px rgba(99,102,241,0.4); }
  .last-update { text-align: center; font-size: 0.65rem; color: #444; margin-top: 1rem; padding-bottom: 4rem; }
  .tab-bar { display: flex; gap: 6px; max-width: 420px; margin: 0 auto 1rem; background: #1a1a22; border-radius: 12px; padding: 4px; }
  .tab { flex: 1; text-align: center; padding: 6px; font-size: 0.7rem; border-radius: 8px; cursor: pointer; color: #666; transition: all 0.2s; }
  .tab.active { background: #2a2a36; color: #fff; font-weight: 500; }
  .section { display: none; max-width: 420px; margin: 0 auto; }
  .section.active { display: block; }
</style>
</head>
<body>
<div class="header">
  <h1>🤖 L'Agent</h1>
  <p id="mois">Chargement...</p>
</div>

<div class="tab-bar">
  <div class="tab active" onclick="setTab('apercu')">Aperçu</div>
  <div class="tab" onclick="setTab('completude')">Complétude</div>
  <div class="tab" onclick="setTab('budgets')">Budgets</div>
  <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
</div>

<div class="section active" id="tab-apercu">
  <div class="grid">
    <div class="card">
      <div class="card-label">Épargne actuelle</div>
      <div class="card-value green" id="epargne-base">—</div>
      <div class="card-sub">Réelle sur compte</div>
    </div>
    <div class="card">
      <div class="card-label">Projection fin mois</div>
      <div class="card-value" id="epargne-estimee">—</div>
      <div class="card-sub">Épargne + solde</div>
    </div>
    <div class="card">
      <div class="card-label">Revenus ce mois</div>
      <div class="card-value green" id="revenus">—</div>
    </div>
    <div class="card">
      <div class="card-label">Dépenses variables</div>
      <div class="card-value red" id="depenses">—</div>
    </div>
    <div class="card full">
      <div class="card-label">Solde estimé ce mois</div>
      <div class="card-value" id="solde">—</div>
      <div class="progress-bar"><div class="progress-fill" id="solde-bar" style="width:0%;background:#4ade80"></div></div>
      <div class="card-sub" id="solde-sub">Revenus - Charges - Dépenses</div>
    </div>
  </div>
</div>

<div class="section" id="tab-completude">
  <div class="grid">
    <div class="card full">
      <div class="card-label">Complétude ce mois</div>
      <div class="card-value green" id="completude-val">—</div>
      <div class="progress-bar"><div class="progress-fill" id="completude-bar" style="width:0%"></div></div>
      <div class="card-sub" id="completude-sub">— / 1 500 €</div>
    </div>
    <div class="card">
      <div class="card-label">Cours effectués</div>
      <div class="card-value" id="nb-cours">—</div>
    </div>
    <div class="card">
      <div class="card-label">Cours manqués</div>
      <div class="card-value red" id="nb-manques">—</div>
      <div class="card-sub" id="manques-val">—</div>
    </div>
    <div class="card full">
      <div class="card-label">Détail des cours</div>
      <div class="cours-list" id="cours-list">—</div>
    </div>
  </div>
</div>

<div class="section" id="tab-budgets">
  <div class="grid">
    <div class="card full" id="budgets-list">Chargement...</div>
  </div>
</div>

<div class="section" id="tab-objectifs">
  <div class="grid">
    <div class="card full" id="objectifs-list">Chargement...</div>
  </div>
</div>

<button class="refresh-btn" onclick="charger()" title="Actualiser">↻</button>
<div class="last-update" id="last-update">—</div>

<script>
let tabActif = 'apercu';

function setTab(tab) {
  tabActif = tab;
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', ['apercu','completude','budgets','objectifs'][i] === tab);
  });
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
}

function pct(v, max) { return Math.min(100, Math.round((v / max) * 100)); }
function couleur(v, max) { const p = pct(v, max); return p >= 100 ? '#f87171' : p >= 80 ? '#fbbf24' : '#4ade80'; }
function fmt(n) { return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'; }

async function charger() {
  try {
    const res = await fetch('/api/dashboard');
    const d = await res.json();

    const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('mois').textContent = mois.charAt(0).toUpperCase() + mois.slice(1);

    // APERÇU
    document.getElementById('epargne-base').textContent = fmt(d.epargne_base);
    const epargneEl = document.getElementById('epargne-estimee');
    epargneEl.textContent = fmt(d.epargne_estimee);
    epargneEl.className = 'card-value ' + (d.epargne_estimee >= 12500 ? 'green' : d.epargne_estimee >= 10000 ? 'amber' : 'red');

    document.getElementById('revenus').textContent = fmt(d.total_revenus);

    const depEl = document.getElementById('depenses');
    depEl.textContent = '-' + fmt(d.total_dep);

    const soldeEl = document.getElementById('solde');
    soldeEl.textContent = (d.solde >= 0 ? '+' : '') + fmt(d.solde);
    soldeEl.className = 'card-value ' + (d.solde >= 500 ? 'green' : d.solde >= 0 ? 'amber' : 'red');
    const soldePct = Math.min(100, Math.max(0, (d.solde / 1500) * 100));
    document.getElementById('solde-bar').style.width = soldePct + '%';
    document.getElementById('solde-bar').style.background = d.solde >= 500 ? '#4ade80' : d.solde >= 0 ? '#fbbf24' : '#f87171';
    document.getElementById('solde-sub').textContent = fmt(d.total_revenus) + ' - ' + fmt(d.charges_fixes) + ' - ' + fmt(d.total_dep);

    // COMPLÉTUDE
    document.getElementById('completude-val').textContent = fmt(d.completude);
    const cp = pct(d.completude, d.objectif_completude);
    document.getElementById('completude-bar').style.width = cp + '%';
    document.getElementById('completude-bar').style.background = cp >= 100 ? '#4ade80' : cp >= 60 ? '#fbbf24' : '#f87171';
    document.getElementById('completude-sub').textContent = fmt(d.completude) + ' / ' + fmt(d.objectif_completude) + ' (' + cp + '%)';
    document.getElementById('nb-cours').textContent = d.nb_cours;
    document.getElementById('nb-manques').textContent = d.nb_cours_manques;
    document.getElementById('manques-val').textContent = '-' + fmt(d.total_manque) + ' manqués';

    const coursList = document.getElementById('cours-list');
    if (d.cours.length === 0) {
      coursList.innerHTML = '<div style="color:#666;font-size:0.75rem;padding:8px 0">Aucun cours ce mois</div>';
    } else {
      coursList.innerHTML = d.cours.map(c =>
        '<div class="cours-item"><span>' + c.eleve + (c.rattrapage ? ' <span style="color:#666">(rattrapage)</span>' : '') + '</span><span class="green">+' + c.gain.toFixed(2) + ' €</span></div>'
      ).join('');
    }

    // BUDGETS
    const budgetsEl = document.getElementById('budgets-list');
    budgetsEl.innerHTML = '<div class="card-label" style="margin-bottom:12px">Dépenses variables</div>';
    Object.entries(d.totaux).forEach(([k, v]) => {
      const b = d.budgets[k];
      const p = pct(v, b.max);
      const col = p >= 100 ? '#f87171' : p >= 80 ? '#fbbf24' : '#4ade80';
      budgetsEl.innerHTML += '<div class="budget-item">' +
        '<span>' + b.label + '</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<div class="budget-bar"><div class="budget-fill" style="width:' + p + '%;background:' + col + '"></div></div>' +
        '<span style="color:' + col + ';min-width:70px;text-align:right">' + v.toFixed(0) + '€ / ' + b.max + '€</span>' +
        '</div></div>';
    });

    // OBJECTIFS
    const objEl = document.getElementById('objectifs-list');
    objEl.innerHTML = '<div class="card-label" style="margin-bottom:12px">Progression épargne</div>';
    d.objectifs.forEach(o => {
      const p = pct(d.epargne_estimee, o.montant);
      const col = p >= 100 ? '#4ade80' : p >= 70 ? '#fbbf24' : '#f87171';
      const delta = Math.round(d.epargne_estimee - o.montant);
      objEl.innerHTML += '<div class="objectif-item">' +
        '<div class="objectif-header">' +
        '<span>' + (delta >= 0 ? '✅' : '⚠️') + ' ' + o.label + '</span>' +
        '<span style="color:' + col + '">' + (delta >= 0 ? '+' : '') + delta.toLocaleString() + ' €</span>' +
        '</div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + p + '%;background:' + col + '"></div></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:0.65rem;color:#666;margin-top:4px">' +
        '<span>Projection: ' + Math.round(d.epargne_estimee).toLocaleString() + ' €</span>' +
        '<span>Objectif: ' + o.montant.toLocaleString() + ' €</span>' +
        '</div></div>';
    });

    document.getElementById('last-update').textContent = 'Actualisé à ' + new Date().toLocaleTimeString('fr-FR');
  } catch(e) {
    console.error(e);
    document.getElementById('last-update').textContent = 'Erreur de chargement';
  }
}

charger();
setInterval(charger, 30000); // Auto-refresh toutes les 30 secondes
</script>
</body>
</html>`);
});

// ============================================================
// DÉMARRAGE
// ============================================================
app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
