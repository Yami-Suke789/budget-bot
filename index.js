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

// État conversation
let etatConversation = null;

// ============================================================
// HELPERS
// ============================================================

// FIX 1 : Barre de progression visuelle
function barreProgression(valeur, max, taille = 10) {
  const pct = Math.min(1, valeur / max);
  const rempli = Math.round(pct * taille);
  const vide = taille - rempli;
  const barre = '█'.repeat(rempli) + '░'.repeat(vide);
  return `[${barre}] ${Math.round(pct * 100)}%`;
}

// FIX 2 : Découpage messages longs pour Telegram (limite 4096 chars)
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const MAX = 4000;
  // Découpe proprement sur les sauts de ligne
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
  parties.push(reste);
  for (const partie of parties) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: partie, parse_mode: 'Markdown' })
    });
    await new Promise(r => setTimeout(r, 400)); // évite le rate limit Telegram
  }
}

function heureParis() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

function nomMois(date) {
  return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
}

// FIX 3 : Détection catégorie tolérante aux fautes (normalisation + alias étendue)
function normaliser(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire accents
    .replace(/[^a-z0-9 ]/g, ' ');
}

function detectCategorie(texte) {
  const t = normaliser(texte);
  const mots = t.split(/\s+/);

  const regles = [
    { cat: 'essence',  mots: ['essence', 'esso', 'station', 'carburant', 'dlg', 'arcycom', 'certas', 'relais', 'total', 'bp', 'shell', 'gazole', 'diesel'] },
    { cat: 'courses',  mots: ['leclerc', 'courses', 'carrefour', 'lidl', 'cora', 'supermarche', 'intermarche', 'aldi', 'biocoop', 'monoprix', 'u express', 'franprix', 'marche'] },
    { cat: 'restos',   mots: ['resto', 'restaurant', 'mcdonald', 'burger', 'pizza', 'panda', 'quick', 'kebab', 'sushi', 'boulangerie', 'snack', 'brasserie', 'dejeuner', 'diner'] },
    { cat: 'sante',    mots: ['medecin', 'pharmacie', 'doctolib', 'sante', 'docteur', 'opticien', 'dentiste', 'kiné', 'kine', 'hopital', 'clinique', 'mutuelle'] },
    { cat: 'maison',   mots: ['ikea', 'maison', 'bricolage', 'castorama', 'leroy', 'brico', 'amazon', 'electro', 'meuble', 'deco', 'decoration'] },
    { cat: 'voiture',  mots: ['garage', 'voiture', 'reparation', 'controle', 'peage', 'autoroute', 'vignette', 'pneu', 'vidange', 'crit air'] },
    { cat: 'shopping', mots: ['vetement', 'zara', 'shopping', 'coiffeur', 'hm', 'zalando', 'asos', 'fnac', 'darty', 'bijou', 'chaussure', 'sephora'] },
    { cat: 'loisirs',  mots: ['cinema', 'loisir', 'concert', 'spectacle', 'livre', 'jeu', 'vacances', 'voyage', 'hotel', 'museum', 'parc', 'sortie'] },
  ];

  // Score par catégorie (un mot = +1)
  const scores = {};
  for (const regle of regles) {
    scores[regle.cat] = 0;
    for (const motCle of regle.mots) {
      if (t.includes(motCle)) scores[regle.cat]++;
    }
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'divers';
}

function parseDepense(texte) {
  // Tolère "45€", "45 €", "45,50", "45.50", "45 euros"
  const match = texte.match(/(\d+([.,]\d{1,2})?)\s*(€|euros?)?/i);
  if (!match) return null;
  const montant = parseFloat(match[1].replace(',', '.'));
  if (montant <= 0 || montant >= 5000) return null;
  return { montant, cat: detectCategorie(texte) };
}

// FIX 4 : Recherche d'élève tolérante aux fautes (distance de Levenshtein simplifiée)
function distanceLev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  if (a.includes(b) || b.includes(a)) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

function trouverEleve(texte) {
  const t = normaliser(texte);
  const noms = Object.keys(ELEVES);

  // Recherche directe d'abord
  for (const nom of noms) {
    if (t.includes(normaliser(nom))) return nom;
  }

  // Recherche fuzzy : chaque mot du texte vs chaque prénom
  const mots = t.split(/\s+/).filter(m => m.length >= 3);
  let meilleur = null, meilleurDist = 3; // tolérance max 2 fautes
  for (const mot of mots) {
    for (const nom of noms) {
      const prenomNorm = normaliser(nom);
      const dist = distanceLev(mot, prenomNorm);
      if (dist < meilleurDist) {
        meilleurDist = dist;
        meilleur = nom;
      }
    }
  }
  return meilleur;
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
// FIX 5 : MINI-DASHBOARD — affiché après chaque enregistrement
// ============================================================
async function envoyerMiniDashboard(chatId, ctx) {
  const completudePct = Math.min(100, Math.round((ctx.completude / OBJECTIF_COMPLETUDE) * 100));
  const depTotale = ctx.totalDep;
  const soldeCouleur = ctx.solde >= 0 ? '🟢' : '🔴';

  let msg = `\n📊 *Dashboard rapide*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n`;
  msg += `🎓 Complétude : *${ctx.completude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n\n`;

  // Épargne vers objectif le plus proche non atteint
  const prochainObj = OBJECTIFS.find(o => ctx.epargneEstimee < o.montant);
  if (prochainObj) {
    msg += `🎯 Épargne → ${prochainObj.label} : *${ctx.epargneEstimee.toFixed(0)} €* / ${prochainObj.montant.toLocaleString()} €\n`;
    msg += `${barreProgression(ctx.epargneEstimee, prochainObj.montant)}\n\n`;
  } else {
    msg += `✅ Tous les objectifs épargne atteints ! 🎉\n\n`;
  }

  // Budgets dépassés ou proches
  const alertes = Object.entries(ctx.totaux)
    .filter(([k, v]) => v > BUDGETS[k].max * 0.7)
    .map(([k, v]) => {
      const restant = BUDGETS[k].max - v;
      const emoji = restant < 0 ? '🔴' : '🟡';
      return `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€`;
    });
  if (alertes.length > 0) {
    msg += `⚠️ *Budgets à surveiller :*\n${alertes.join('\n')}\n\n`;
  }

  msg += `${soldeCouleur} Solde estimé ce mois : *${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
  await sendMessage(chatId, msg);
}

// ============================================================
// ENREGISTRER COURS FAIT
// ============================================================
async function enregistrerCoursFait(chatId, nomEleve, gain, rattrapages = false) {
  await supabase.from('cours').insert({
    eleve: nomEleve,
    duree: ELEVES[nomEleve].duree,
    taux: ELEVES[nomEleve].taux,
    gain,
    chat_id: chatId,
    rattrapage: rattrapages
  });

  const ctx = await getContextFinancier();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
  const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
  const tag = rattrapages ? ' _(rattrapage)_' : '';

  let msg = `✅ Cours avec *${nomEleve}* enregistré${tag} !\n`;
  msg += `💰 Gain : *+${gain.toFixed(2)} €*\n\n`;
  msg += `${emoji} Complétude : *${ctx.completude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
  msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : `🎉 Objectif atteint !`;
  await sendMessage(chatId, msg);

  // FIX 5 : mini dashboard après chaque cours
  await envoyerMiniDashboard(chatId, ctx);
}

// ============================================================
// ENREGISTRER COURS MANQUÉ
// ============================================================
async function enregistrerCoursManque(chatId, nomEleve, gainManque) {
  await supabase.from('cours_manques').insert({
    eleve: nomEleve,
    gain_manque: gainManque,
    chat_id: chatId
  });

  const ctx = await getContextFinancier();
  let msg = `❌ Cours avec *${nomEleve}* non effectué\n`;
  msg += `💸 Manque à gagner : *-${gainManque.toFixed(2)} €*\n\n`;
  msg += `📉 Total manqué ce mois : *-${ctx.totalManque.toFixed(0)} €* (${ctx.coursManques.length} cours)`;
  await sendMessage(chatId, msg);
}

// ============================================================
// FIX 6 : GÉNÉRATION FICHE — découpage en parties + meilleur prompt
// ============================================================
async function genererFiche(nomEleve, chapitre) {
  const profil = ELEVES[nomEleve];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  let prompt = '';

  const baseInstructions = `
RÈGLES IMPORTANTES :
- Utilise uniquement du texte brut, pas de LaTeX, pas de formules complexes
- Écris les fractions comme "3/4", les puissances comme "x^2", les racines comme "sqrt(9)"
- Chaque exercice doit être clairement numéroté
- Le corrigé doit être séparé par une ligne "=== CORRIGÉ ==="
`;

  if (profil.ficheHebdo) {
    prompt = `Tu es un professeur de maths expert. Génère une fiche d'exercices hebdomadaire pour ${nomEleve}, élève de ${profil.niveau}.
Chapitre : ${chapitre}
${baseInstructions}
FORMAT : 5 jours (Lundi à Vendredi), 2 exercices par jour de difficulté croissante, puis corrigé complet.
Commence par : "📚 FICHE HEBDOMADAIRE — ${nomEleve} — ${chapitre}"`;
  } else if (profil.tda) {
    prompt = `Tu es un professeur de maths expert spécialisé TDA/TDAH. Génère une fiche pour ${nomEleve}, élève de ${profil.niveau}.
Chapitre : ${chapitre}
${baseInstructions}
CONSIGNES TDA : exercices très courts, 1 consigne par exercice (1 phrase maximum), maximum 4 exercices bien espacés, beaucoup d'espace blanc entre les questions, corrigé à la fin.
Commence par : "📚 FICHE TDA — ${nomEleve} — ${chapitre}"`;
  } else {
    prompt = `Tu es un professeur de maths expert. Génère une fiche d'exercices pour ${nomEleve}, élève de ${profil.niveau}.
Chapitre : ${chapitre}
${baseInstructions}
FORMAT : 5 exercices progressifs (du plus simple au plus difficile), adaptés au niveau ${profil.niveau}, corrigé complet à la fin.
Commence par : "📚 FICHE D'EXERCICES — ${nomEleve} — ${chapitre}"`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ============================================================
// MESSAGES AUTOMATIQUES
// ============================================================
async function envoyerRappelBiHebdo() {
  const ctx = await getContextFinancier();
  let msg = `📋 *Rappel bi-hebdo — ${nomMois(new Date())}*\n\n`;
  msg += `💰 *Revenus :*\n`;
  msg += `• LGM : ${ctx.salaire} €${ctx.salaire === SALAIRE_LGM_DEFAULT ? ' _(par défaut)_' : ''}\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} €\n`;
  msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n💸 *Dépenses :*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 *Solde estimé : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n`;
  if (ctx.totalManque > 0) msg += `💸 Cours manqués ce mois : *-${ctx.totalManque.toFixed(0)} €*\n`;
  msg += `\n_Des dépenses ou rentrées à enregistrer ?_`;
  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const ctx = await getContextFinancier();
  const potentielMax = ctx.completude + ctx.totalManque;
  let msg = `🗓️ *SYNTHÈSE ${nomMois(new Date()).toUpperCase()}*\n\n`;
  msg += `✅ *REVENUS : ${ctx.totalRevenus.toFixed(0)} €*\n`;
  msg += `• LGM : ${ctx.salaire} €\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${ctx.completude.toFixed(0)} € (${ctx.cours.length} cours)\n`;
  if (ctx.revenusSupp > 0) msg += `• Autres : ${ctx.revenusSupp.toFixed(0)} €\n`;
  msg += `\n🔒 *CHARGES FIXES : -${TOTAL_CHARGES_FIXES.toFixed(0)} €*\n`;
  msg += `\n💸 *DÉPENSES VARIABLES : -${ctx.totalDep.toFixed(0)} €*\n`;
  Object.entries(ctx.totaux).forEach(([k, v]) => {
    const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
  });
  msg += `\n📉 *COURS MANQUÉS : ${ctx.coursManques.length} cours — -${ctx.totalManque.toFixed(0)} €*\n`;
  if (ctx.coursManques.length > 0) {
    ctx.coursManques.forEach(c => { msg += `• ${c.eleve} : -${c.gain_manque.toFixed(2)} €\n`; });
    msg += `_Potentiel max : ${potentielMax.toFixed(0)} € | Réalisé : ${ctx.completude.toFixed(0)} €_\n`;
  }
  msg += `\n💰 *SOLDE NET : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n`;
  msg += `\n🎯 *OBJECTIFS ÉPARGNE :*\n`;
  OBJECTIFS.forEach(o => {
    const delta = ctx.epargneEstimee - o.montant;
    const pct = Math.min(100, Math.round((ctx.epargneEstimee / o.montant) * 100));
    msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
    msg += `${barreProgression(ctx.epargneEstimee, o.montant)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n\n`;
  });
  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// FIX 7 : DÉTECTION INTENTION via IA quand le texte n'est pas reconnu
// (évite que le bot réponde bêtement sur des formulations inhabituelles)
// ============================================================
async function detecterIntentionIA(texte, ctx) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `Tu es le cerveau d'un assistant Telegram personnel appelé L'Agent.
Analyse ce message de l'utilisateur et retourne UNIQUEMENT un objet JSON valide (sans markdown, sans backtick) avec :
{
  "intention": "depense" | "cours_fait" | "cours_manque" | "salaire" | "epargne" | "revenu" | "question" | "inconnu",
  "eleve": "prénom exact parmi [${Object.keys(ELEVES).join(', ')}] ou null",
  "montant": nombre ou null,
  "categorie_depense": "essence|courses|restos|sante|maison|voiture|shopping|loisirs|divers" ou null,
  "reponse_directe": "réponse courte en français si c'est une question générale, sinon null"
}

Contexte financier rapide : solde ${ctx.solde.toFixed(0)}€, épargne ${ctx.epargneBase}€, complétude ${ctx.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€.

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
// SCHEDULER
// ============================================================
function demarrerScheduler() {
  setInterval(() => {
    fetch(`https://budget-bot-production-eaaf.up.railway.app/`).catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = heureParis();
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) {
      await envoyerRappelBiHebdo();
    }

    if (now.getDate() === 30 && heure === 20 && minute === 0) {
      await envoyerSyntheseMensuelle();
    }

    for (const [nomEleve, profil] of Object.entries(ELEVES)) {
      if (profil.jour !== jour) continue;
      if (profil.uneSemaineSurDeux && !estSemaineSerena()) continue;
      const totalMin = profil.minute + Math.floor(profil.duree * 60);
      const heureFin = profil.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        etatConversation = { etape: 'confirmation', nomEleve, source: 'auto' };
        await sendMessage(CHAT_ID,
          `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${nomEleve}* ?\n\nRéponds *oui* ou *non*`
        );
      }
    }
  }, 60000);
}

// ============================================================
// WEBHOOK
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();
  const texteLower = texte.toLowerCase();

  try {

    // ── GESTION ÉTATS CONVERSATION ──────────────────────────
    if (etatConversation) {
      const { etape, nomEleve, source, data } = etatConversation;
      const profil = nomEleve ? ELEVES[nomEleve] : null;

      if (etape === 'confirmation') {
        // FIX 8 : accepte oui/non + variantes naturelles
        const estOui = /^(oui|yes|ok|ouais|yep|yop|fait|c'est fait|fait cours|✅|👍)$/i.test(texteLower);
        const estNon = /^(non|no|pas fait|absent|annulé|annule|nope|nan|❌|👎)$/i.test(texteLower);

        if (estOui) {
          if (profil.question2h) {
            etatConversation = { etape: 'question2h', nomEleve, source };
            await sendMessage(chatId, `✅ Super !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
          } else {
            const gain = profil.taux * profil.duree;
            await enregistrerCoursFait(chatId, nomEleve, gain, source === 'manuel');
            etatConversation = null;
          }
          return;
        }
        if (estNon) {
          const gainManque = profil.taux * 1;
          await enregistrerCoursManque(chatId, nomEleve, gainManque);
          etatConversation = null;
          return;
        }
        // Si ni oui ni non, on redemande gentiment
        await sendMessage(chatId, `Je n'ai pas compris 😅 Réponds juste *oui* ou *non* — as-tu fait cours avec *${nomEleve}* ?`);
        return;
      }

      if (etape === 'question2h') {
        const estOui = /^(oui|yes|ok|ouais|yep|2h|deux heures|✅|👍)$/i.test(texteLower);
        const estNon = /^(non|no|1h|une heure|nope|nan|❌|👎)$/i.test(texteLower);

        if (estOui || estNon) {
          const heuresPay = estOui ? 2 : 1;
          const gain = profil.taux * heuresPay;
          await enregistrerCoursFait(chatId, nomEleve, gain, source === 'manuel');

          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve, gain, source };
            await sendMessage(chatId,
              `📝 *Qu'avez-vous vu aujourd'hui avec ${nomEleve} ?*\n\n_Exemples : Fractions, Théorème de Pythagore, Calcul littéral..._`
            );
          } else {
            etatConversation = null;
          }
          return;
        }
        await sendMessage(chatId, `Réponds *oui* (2h) ou *non* (1h) 🙂`);
        return;
      }

      if (etape === 'chapitre') {
        await sendMessage(chatId, `📝 *Génération de la fiche en cours...*\n_Ça peut prendre quelques secondes_`);
        try {
          const fiche = await genererFiche(nomEleve, texte);
          await sendMessage(chatId, fiche); // sendMessage gère le découpage automatiquement
        } catch (err) {
          await sendMessage(chatId, `❌ Erreur lors de la génération de la fiche. Réessaie avec /fiche`);
        }
        etatConversation = null;
        return;
      }

      if (etape === 'cours_manuel_nom') {
        const eleve = trouverEleve(texte);
        if (eleve) {
          etatConversation = { etape: 'cours_manuel_type', nomEleve: eleve, source: 'manuel' };
          await sendMessage(chatId,
            `📚 Cours avec *${eleve}*\n\nC'est un *rattrapage* ou un cours *normal* supplémentaire ?\n\nRéponds *rattrapage* ou *normal*`
          );
        } else {
          await sendMessage(chatId, `❓ Je n'ai pas reconnu le prénom.\n\nMes élèves : ${Object.keys(ELEVES).join(', ')}`);
        }
        return;
      }

      if (etape === 'cours_manuel_type') {
        const estRattrapage = texteLower.includes('rattrapage');
        if (profil.question2h) {
          etatConversation = { etape: 'question2h', nomEleve, source: estRattrapage ? 'rattrapage' : 'manuel' };
          await sendMessage(chatId, `*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
        } else {
          const gain = profil.taux * profil.duree;
          await enregistrerCoursFait(chatId, nomEleve, gain, true);
          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve, gain, source: 'manuel' };
            await sendMessage(chatId, `📝 *Qu'avez-vous vu avec ${nomEleve} ?*`);
          } else {
            etatConversation = null;
          }
        }
        return;
      }
    }

    // ── COMMANDES ───────────────────────────────────────────

    if (texte === '/start') {
      await sendMessage(chatId,
        `👋 Salut Nour-Dine ! Je suis *L'Agent*, ton assistant personnel.\n\n` +
        `*📚 Complétude :*\n` +
        `• /cours — signaler un cours fait\n` +
        `• /completude — revenus du mois\n` +
        `• /manques — cours ratés\n\n` +
        `*💰 Finances :*\n` +
        `• /bilan — dépenses du mois\n` +
        `• /objectifs — progression épargne\n` +
        `• /synthese — bilan complet\n` +
        `• /charges — charges fixes\n` +
        `• /dashboard — vue d'ensemble\n\n` +
        `*Saisie rapide (écris naturellement) :*\n` +
        `💸 _"Leclerc 45€"_ → dépense courses\n` +
        `💸 _"Plein essence 60€"_ → dépense essence\n` +
        `💰 _"Salaire 2625€"_ → salaire du mois\n` +
        `💎 _"Épargne 9500€"_ → mise à jour épargne\n` +
        `📚 _"Cours avec Margaux"_ → signaler un cours\n` +
        `❓ _Pose n'importe quelle question !_`
      );
      return;
    }

    // FIX 9 : Nouvelle commande /dashboard
    if (texte === '/dashboard') {
      const ctx = await getContextFinancier();
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (texte === '/cours') {
      etatConversation = { etape: 'cours_manuel_nom' };
      await sendMessage(chatId, `📚 *Quel élève ?*\n\n${Object.keys(ELEVES).join(', ')}`);
      return;
    }

    if (texte === '/bilan') {
      const ctx = await getContextFinancier();
      let message = `📊 *Bilan ${nomMois(new Date())}*\n\n`;
      Object.entries(ctx.totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        message += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      message += `\n💰 *Solde estimé : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*\n`;
      message += `\n_Total dépensé : ${ctx.totalDep.toFixed(0)} € / ${TOTAL_BUDGETS_MAX} € max_`;
      await sendMessage(chatId, message);
      return;
    }

    if (texte === '/completude') {
      const ctx = await getContextFinancier();
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
      const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
      let msg = `📚 *Complétude ${nomMois(new Date())}*\n\n`;
      msg += `${emoji} *${ctx.completude.toFixed(2)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
      msg += `${barreProgression(ctx.completude, OBJECTIF_COMPLETUDE)}\n`;
      msg += `Cours effectués : *${ctx.cours.length}*\n`;
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
      if (ctx.coursManques.length === 0) {
        await sendMessage(chatId, `✅ *Aucun cours manqué ce mois !* 🎉`);
        return;
      }
      let msg = `📉 *Cours manqués — ${nomMois(new Date())}*\n\n`;
      ctx.coursManques.forEach(c => {
        msg += `❌ *${c.eleve}* → -${c.gain_manque.toFixed(2)} €\n`;
      });
      msg += `\n💸 *Total manqué : -${ctx.totalManque.toFixed(0)} €*\n`;
      msg += `✅ Gagné : ${ctx.completude.toFixed(0)} €\n`;
      msg += `🎯 Potentiel max : ${(ctx.completude + ctx.totalManque).toFixed(0)} €`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/objectifs') {
      const ctx = await getContextFinancier();
      let msg = `🎯 *Objectifs épargne*\n\n`;
      msg += `💼 Épargne actuelle : *${ctx.epargneBase.toLocaleString()} €*\n`;
      msg += `📈 Projection fin de mois : *${ctx.epargneEstimee.toFixed(0)} €*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = ctx.epargneEstimee - o.montant;
        msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
        msg += `${barreProgression(ctx.epargneEstimee, o.montant)} (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n\n`;
      });
      msg += `_Hors tontine 13 000 € — c'est du bonus !_ 🎁`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/synthese') {
      await envoyerSyntheseMensuelle();
      return;
    }

    if (texte === '/charges') {
      let msg = `🔒 *Charges fixes — ${TOTAL_CHARGES_FIXES.toFixed(0)} €/mois*\n\n`;
      Object.entries(CHARGES_FIXES).forEach(([k, v]) => { msg += `• ${k} : ${v.toFixed(2)} €\n`; });
      await sendMessage(chatId, msg);
      return;
    }

    // ── DÉTECTIONS TEXTE LIBRE ──────────────────────────────

    // Cours fait (texte libre)
    if (/fait cours|cours avec|j'ai eu cours|rattrapage avec|rattrapage/i.test(texte)) {
      const eleve = trouverEleve(texte);
      if (eleve) {
        const estRattrapage = /rattrapage/i.test(texte);
        const profil = ELEVES[eleve];
        if (profil.question2h) {
          etatConversation = { etape: 'question2h', nomEleve: eleve, source: estRattrapage ? 'rattrapage' : 'manuel' };
          await sendMessage(chatId, `📚 Cours avec *${eleve}* !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
        } else {
          const gain = profil.taux * profil.duree;
          await enregistrerCoursFait(chatId, eleve, gain, true);
          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve: eleve, gain, source: 'manuel' };
            await sendMessage(chatId, `📝 *Qu'avez-vous vu avec ${eleve} ?*`);
          }
        }
        return;
      }
    }

    // Cours annulé (texte libre)
    if (/pas de cours|absent|annulé|annule|pas fait cours/i.test(texte)) {
      const eleve = trouverEleve(texte);
      if (eleve) {
        const gainManque = ELEVES[eleve].taux * 1;
        await enregistrerCoursManque(chatId, eleve, gainManque);
        return;
      }
    }

    // Épargne
    if (/épargne|epargne|économies/i.test(texte)) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        if (montant > 1000) {
          await supabase.from('epargne').insert({ montant, libelle: texte, chat_id: chatId });
          const ctx = await getContextFinancier();
          await sendMessage(chatId, `✅ Épargne mise à jour : *${montant.toLocaleString()} €* 💎`);
          await envoyerMiniDashboard(chatId, ctx);
          return;
        }
      }
    }

    // Salaire
    if (/salaire|lgm|paie/i.test(texte)) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        if (montant > 1000 && montant < 10000) {
          await supabase.from('salaires').insert({ montant, libelle: texte, chat_id: chatId });
          const ctx = await getContextFinancier();
          await sendMessage(chatId, `✅ Salaire LGM enregistré : *${montant} €* 📊`);
          await envoyerMiniDashboard(chatId, ctx);
          return;
        }
      }
    }

    // Revenu supplémentaire
    if (/reçu|vinted|remboursement|rentrée|participation/i.test(texte)) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        await supabase.from('revenus').insert({ montant, libelle: texte, chat_id: chatId });
        const ctx = await getContextFinancier();
        await sendMessage(chatId, `✅ Rentrée de *+${montant} €* enregistrée !`);
        await envoyerMiniDashboard(chatId, ctx);
        return;
      }
    }

    // Dépense
    const depense = parseDepense(texte);
    if (depense && !/cours|élève|eleve/i.test(texte)) {
      await supabase.from('depenses').insert({ montant: depense.montant, categorie: depense.cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[depense.cat].max - totaux[depense.cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[depense.cat].max * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId,
        `✅ *${depense.montant} €* enregistré — _${BUDGETS[depense.cat].label}_\n` +
        `${emoji} Budget restant : *${restant.toFixed(0)} €* / ${BUDGETS[depense.cat].max} €`
      );
      // FIX 5 : dashboard après dépense
      const ctx = await getContextFinancier();
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    // ── FIX 7 : DÉTECTION INTENTION IA avant de répondre en mode question ─────
    const ctx = await getContextFinancier();
    const intention = await detecterIntentionIA(texte, ctx);

    // Si l'IA a identifié une intention structurée qu'on aurait ratée
    if (intention.intention === 'depense' && intention.montant && intention.categorie_depense) {
      const cat = intention.categorie_depense;
      await supabase.from('depenses').insert({ montant: intention.montant, categorie: cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[cat].max - totaux[cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId,
        `✅ *${intention.montant} €* enregistré — _${BUDGETS[cat].label}_\n` +
        `${emoji} Budget restant : *${restant.toFixed(0)} €* / ${BUDGETS[cat].max} €`
      );
      await envoyerMiniDashboard(chatId, ctx);
      return;
    }

    if (intention.intention === 'cours_fait' && intention.eleve) {
      const eleve = intention.eleve;
      const profil = ELEVES[eleve];
      if (profil.question2h) {
        etatConversation = { etape: 'question2h', nomEleve: eleve, source: 'manuel' };
        await sendMessage(chatId, `📚 Cours avec *${eleve}* !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
      } else {
        const gain = profil.taux * profil.duree;
        await enregistrerCoursFait(chatId, eleve, gain, false);
        if (profil.fiche) {
          etatConversation = { etape: 'chapitre', nomEleve: eleve, gain, source: 'manuel' };
          await sendMessage(chatId, `📝 *Qu'avez-vous vu avec ${eleve} ?*`);
        }
      }
      return;
    }

    if (intention.intention === 'cours_manque' && intention.eleve) {
      const gainManque = ELEVES[intention.eleve].taux * 1;
      await enregistrerCoursManque(chatId, intention.eleve, gainManque);
      return;
    }

    // ── RÉPONSE IA GÉNÉRALE ─────────────────────────────────
    // Si l'IA a une réponse directe courte, on l'envoie directement
    if (intention.reponse_directe) {
      await sendMessage(chatId, intention.reponse_directe);
      return;
    }

    // Sinon réponse IA complète avec contexte
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const coursParEleve = {};
    ctx.cours.forEach(c => {
      if (!coursParEleve[c.eleve]) coursParEleve[c.eleve] = { nb: 0, gain: 0 };
      coursParEleve[c.eleve].nb++;
      coursParEleve[c.eleve].gain += c.gain;
    });

    const contextIA = `Tu es L'Agent, assistant personnel de Nour-Dine. Tu es direct, bienveillant, intelligent et naturel.
Tu réponds TOUJOURS en français, de manière conversationnelle. Tu es comme un ami conseiller.
Tu peux répondre à tout : finances, achats, conseils de vie, formations, prix du marché français, etc.
Tu n'es JAMAIS pointilleux sur les fautes d'orthographe ou les formulations imparfaites.
Tu comprends le sens général même si le message est mal écrit ou abrégé.
Si on te demande un prix, donne une estimation réaliste du marché français actuel.
Garde tes réponses concises (4-6 lignes max) sauf si la question est complexe.

=== PROFIL ===
- Ingénieur cadre chez LGM (mission Thales), départ prévu août 2026 via rupture conventionnelle
- Co-fondateur de Dyneos SAS (CFA, formations pro)
- Tuteur chez Complétude (11 élèves actifs)
- Certification formateur incendie en cours (Fo.EPI juin 2026, SSIAP 1 juillet 2026)
- Vit en Île-de-France, en PACS
- Objectif : indépendance via formation incendie + Complétude + Dyneos

=== FINANCES CE MOIS ===
Salaire LGM : ${ctx.salaire} € | Beau-frère : ${BEAU_FRERE} € | Complétude : ${ctx.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€
Total revenus : ${ctx.totalRevenus.toFixed(0)} € | Charges fixes : ${TOTAL_CHARGES_FIXES.toFixed(0)} € | Dépenses variables : ${ctx.totalDep.toFixed(0)} €
Solde estimé : ${ctx.solde.toFixed(0)} € | Épargne actuelle : ${ctx.epargneBase.toLocaleString()} € | Projection : ${ctx.epargneEstimee.toFixed(0)} €

=== BUDGETS ===
${Object.entries(ctx.totaux).map(([k, v]) => `${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€`).join(' | ')}

Message de Nour-Dine : "${texte}"`;

    await sendMessage(chatId, '🤔 ...');
    const result = await model.generateContent(contextIA);
    await sendMessage(chatId, result.response.text());

  } catch (err) {
    console.error('Erreur:', err.message, err.stack);
    await sendMessage(chatId, "❌ Une erreur s'est produite, réessaie dans quelques secondes.");
  }
});

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  demarrerScheduler();
});

module.exports = app;
