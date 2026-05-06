const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const MODELE = 'gemini-2.0-flash';

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

// Prélèvements avec dates pour le suivi
const PRELEVEMENTS_DATES = [
  { nom: 'Loyer',               montant: 832.46, jour: 1  },
  { nom: 'Tontine 1',           montant: 500.00, jour: 1  },
  { nom: 'Helloasso',           montant: 12.55,  jour: 1  },
  { nom: 'Place parking',       montant: 50.00,  jour: 1  },
  { nom: 'Salle sport femme',   montant: 44.00,  jour: 1  },
  { nom: 'Cours arabe',         montant: 31.00,  jour: 3  },
  { nom: 'Virement mère',       montant: 150.00, jour: 5  },
  { nom: 'Assurance habitation',montant: 8.46,   jour: 7  },
  { nom: 'ENI énergie',         montant: 39.40,  jour: 7  },
  { nom: 'Basic Fit',           montant: 22.99,  jour: 7  },
  { nom: 'Malakoff mutuelle',   montant: 57.03,  jour: 9  },
  { nom: 'Crunchyroll',         montant: 8.99,   jour: 13 },
  { nom: 'Stripe asso',         montant: 10.00,  jour: 13 },
  { nom: 'Tontine 2',           montant: 500.00, jour: 15 },
  { nom: 'Bouygues mobile',     montant: 17.99,  jour: 17 },
  { nom: 'Assurance auto',      montant: 64.24,  jour: 20 },
  { nom: 'Disney+',             montant: 6.99,   jour: 22 },
  { nom: 'Canal+ frère',        montant: 13.00,  jour: 24 },
  { nom: 'Claude.ai',           montant: 21.60,  jour: 27 },
  { nom: 'Bouygues box',        montant: 24.00,  jour: 30 },
  { nom: 'Cotisation bancaire', montant: 18.30,  jour: null, frequence: 'trimestriel' },
];

const BUDGETS = {
  essence:  { label: '⛽ Essence',  max: 300 },
  courses:  { label: '🛒 Courses',  max: 500 },
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

// ELEVES chargés dynamiquement depuis Supabase
let ELEVES = {
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

// Charger les élèves personnalisés depuis Supabase au démarrage
async function chargerElevesCustom() {
  try {
    const { data } = await supabase.from('eleves_custom').select('*').eq('actif', true);
    if (data && data.length > 0) {
      data.forEach(e => {
        ELEVES[e.nom] = {
          niveau: e.niveau, taux: e.taux, duree: e.duree,
          tda: e.tda || false, ficheHebdo: e.fiche_hebdo || false,
          question2h: e.question_2h !== false, fiche: e.fiche !== false,
          jour: e.jour, heure: e.heure, minute: e.minute || 0,
          uneSemaineSurDeux: e.une_semaine_sur_deux || false,
        };
      });
      console.log(`${data.length} élèves custom chargés`);
    }
  } catch (err) {
    console.error('Erreur chargement élèves custom:', err.message);
  }
}

// État conversations
const sessions = {};
const sessionsFiches = {};
const sessionsAnnuler = {};
const sessionsModifier = {};
const sessionsAjoutEleve = {};
const sessionsRevenu = {};

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
function getDebutMois(moisOffset = 0) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  if (moisOffset !== 0) d.setUTCMonth(d.getUTCMonth() + moisOffset);
  return d.toISOString();
}

function getFinMois(moisOffset = 0) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + moisOffset + 1);
  return d.toISOString();
}

async function getData(moisOffset = 0) {
  const debut = getDebutMois(moisOffset);
  const fin = getFinMois(moisOffset);

  const [d1, d2, d3, d4, d5, d6] = await Promise.all([
    supabase.from('depenses').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('cours').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('cours_manques').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('revenus').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('salaires').select('*').gte('created_at', debut).lt('created_at', fin).order('created_at', { ascending: false }).limit(1),
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

  // Détail par catégorie
  const detail = {};
  Object.keys(BUDGETS).forEach(k => detail[k] = []);
  depenses.forEach(d => { if (detail[d.categorie] !== undefined) detail[d.categorie].push(d); });

  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const totalManque = coursManques.reduce((s, c) => s + c.gain_manque, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const epargneEstimee = epargneBase + solde;

  return {
    depenses, cours, coursManques, revenus, totaux, detail, totalDep,
    completude, totalManque, revenusSupp, totalRevenus, solde,
    epargneEstimee, salaire, epargneBase, moisOffset
  };
}

async function saveCours(chatId, eleve, heures, rattrapage) {
  const p = ELEVES[eleve];
  const gain = p.taux * heures;
  const { error } = await supabase.from('cours').insert({ eleve, duree: p.duree, taux: p.taux, gain, chat_id: String(chatId), rattrapage });
  if (error) console.error('saveCours error:', error);
  return gain;
}

async function saveCoursManque(chatId, eleve) {
  const gain_manque = ELEVES[eleve].taux * ELEVES[eleve].duree;
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

async function saveEleveCustom(chatId, eleveData) {
  const { error } = await supabase.from('eleves_custom').insert({
    nom: eleveData.nom, niveau: eleveData.niveau, taux: eleveData.taux,
    duree: eleveData.duree, tda: eleveData.tda || false,
    fiche_hebdo: eleveData.ficheHebdo || false, question_2h: eleveData.question2h !== false,
    fiche: eleveData.fiche !== false, jour: eleveData.jour,
    heure: eleveData.heure, minute: eleveData.minute || 0,
    une_semaine_sur_deux: eleveData.uneSemaineSurDeux || false,
    actif: true, chat_id: String(chatId)
  });
  if (error) console.error('saveEleveCustom error:', error);
  return !error;
}

// ============================================================
// SUIVI PRÉLÈVEMENTS À VENIR
// ============================================================
function getPrelEvementsAVenir(joursAvance = 7) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const aujourdhui = now.getDate();
  const finPeriode = aujourdhui + joursAvance;
  const dernierJour = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const aVenir = [];
  PRELEVEMENTS_DATES.forEach(p => {
    if (!p.jour) return; // trimestriel sans date fixe
    let jourPrelevement = p.jour;
    if (jourPrelevement > dernierJour) jourPrelevement = dernierJour;
    if (jourPrelevement >= aujourdhui && jourPrelevement <= Math.min(finPeriode, dernierJour)) {
      aVenir.push({ ...p, jourEffectif: jourPrelevement, dansJours: jourPrelevement - aujourdhui });
    }
  });
  return aVenir.sort((a, b) => a.jourEffectif - b.jourEffectif);
}

function getTotalPrelevementsRestants() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const aujourdhui = now.getDate();
  const dernierJour = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  let total = 0;
  PRELEVEMENTS_DATES.forEach(p => {
    if (!p.jour) return;
    let jour = p.jour > dernierJour ? dernierJour : p.jour;
    if (jour >= aujourdhui) total += p.montant;
  });
  return total;
}

// ============================================================
// GEMINI
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
// DÉTECTION RAPIDE
// ============================================================
function trouverEleve(texte) {
  const t = texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const nom of Object.keys(ELEVES)) {
    if (t.includes(nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return nom;
  }
  return null;
}

function trouverTousLesEleves(texte) {
  const t = texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return Object.keys(ELEVES).filter(nom =>
    t.includes(nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  );
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

const JOURS_NOMS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const NIVEAUX_VALIDES = ['CP', 'CE1', 'CE2', 'CM1', 'CM2', '6e', '5e', '4e', '3e', '2nde', '1ère', 'Terminale'];

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
// AJOUT ÉLÈVE — FLOW CONVERSATIONNEL
// ============================================================
async function demarrerAjoutEleve(chatId) {
  sessionsAjoutEleve[chatId] = { etape: 'nom' };
  await send(chatId,
    `👤 *Ajouter un nouvel élève*\n\n` +
    `Étape 1/7 — Quel est son prénom ?\n_Ex: Thomas, Marie..._`
  );
}

async function traiterAjoutEleve(chatId, texte) {
  const sess = sessionsAjoutEleve[chatId];
  if (!sess) return false;

  switch (sess.etape) {
    case 'nom': {
      const nom = texte.trim();
      if (nom.length < 2 || nom.length > 30) {
        await send(chatId, '❌ Prénom invalide. Réessaie (2-30 caractères).');
        return true;
      }
      if (ELEVES[nom]) {
        await send(chatId, `❌ *${nom}* existe déjà !`);
        delete sessionsAjoutEleve[chatId];
        return true;
      }
      sess.nom = nom;
      sess.etape = 'niveau';
      const rows = [];
      for (let i = 0; i < NIVEAUX_VALIDES.length; i += 4) {
        rows.push(NIVEAUX_VALIDES.slice(i, i+4).map(n => ({ t: n, d: `ae_niv_${n}` })));
      }
      rows.push([{ t: '↩️ Annuler', d: 'ae_annuler' }]);
      await sendBtns(chatId, `👤 *${nom}*\n\nÉtape 2/7 — Quel niveau ?`, rows);
      return true;
    }
    case 'taux': {
      const taux = parseFloat(texte.replace(',', '.'));
      if (isNaN(taux) || taux < 10 || taux > 100) {
        await send(chatId, '❌ Taux invalide (entre 10 et 100). Ex: *24.50*');
        return true;
      }
      sess.taux = taux;
      sess.etape = 'duree';
      await sendBtns(chatId, `👤 *${sess.nom}* — ${taux}€/h\n\nÉtape 4/7 — Durée des séances ?`, [
        [{ t: '1h', d: 'ae_dur_1' }, { t: '1h30', d: 'ae_dur_1.5' }, { t: '2h', d: 'ae_dur_2' }],
        [{ t: '↩️ Annuler', d: 'ae_annuler' }]
      ]);
      return true;
    }
    case 'heure': {
      const m = texte.match(/^(\d{1,2})h(\d{0,2})$/i);
      if (!m) {
        await send(chatId, '❌ Format invalide. Ex: *17h00* ou *9h30*');
        return true;
      }
      const h = parseInt(m[1]), min = parseInt(m[2] || '0');
      if (h < 7 || h > 21 || min % 15 !== 0) {
        await send(chatId, '❌ Heure invalide (7h-21h, minutes multiples de 15). Ex: *17h00*');
        return true;
      }
      sess.heure = h;
      sess.minute = min;
      sess.etape = 'options';
      await sendBtns(chatId,
        `👤 *${sess.nom}* — ${JOURS_NOMS[sess.jour]} à ${h}h${min > 0 ? min.toString().padStart(2,'0') : '00'}\n\nÉtape 7/7 — Options spéciales ?`,
        [
          [{ t: 'TDA/TDAH', d: 'ae_opt_tda' }, { t: 'Fiche hebdo', d: 'ae_opt_hebdo' }],
          [{ t: '1 semaine/2', d: 'ae_opt_2sem' }, { t: 'Aucune', d: 'ae_opt_none' }],
          [{ t: '↩️ Annuler', d: 'ae_annuler' }]
        ]
      );
      return true;
    }
  }
  return false;
}

// ============================================================
// TRAITEMENT CALLBACKS
// ============================================================
async function traiterCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data;

  await answerCB(cb.id);
  await removeBtns(chatId, msgId);

  const session = sessions[chatId] || {};

  // ── AJOUT ÉLÈVE callbacks ──────────────────────────────
  if (data === 'ae_annuler') {
    delete sessionsAjoutEleve[chatId];
    await send(chatId, '❌ Ajout d\'élève annulé.');
    return;
  }

  if (data.startsWith('ae_niv_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.niveau = data.replace('ae_niv_', '');
    sess.etape = 'taux';
    await send(chatId, `👤 *${sess.nom}* — ${sess.niveau}\n\nÉtape 3/7 — Quel taux horaire ?\n_Ex: 24.50_ (en euros)`);
    return;
  }

  if (data.startsWith('ae_dur_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.duree = parseFloat(data.replace('ae_dur_', ''));
    sess.etape = 'jour';
    const rows = JOURS_NOMS.map((j, i) => [{ t: j, d: `ae_jour_${i}` }]);
    rows.push([{ t: '↩️ Annuler', d: 'ae_annuler' }]);
    await sendBtns(chatId, `👤 *${sess.nom}* — ${sess.duree}h/séance\n\nÉtape 5/7 — Quel jour ?`, rows);
    return;
  }

  if (data.startsWith('ae_jour_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.jour = parseInt(data.replace('ae_jour_', ''));
    sess.etape = 'heure';
    await send(chatId, `👤 *${sess.nom}* — ${JOURS_NOMS[sess.jour]}\n\nÉtape 6/7 — À quelle heure ?\n_Ex: 17h00, 9h30_`);
    return;
  }

  if (data.startsWith('ae_opt_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    const opt = data.replace('ae_opt_', '');

    if (!sess.options) sess.options = {};
    if (opt === 'tda') sess.options.tda = true;
    else if (opt === 'hebdo') sess.options.ficheHebdo = true;
    else if (opt === '2sem') sess.options.uneSemaineSurDeux = true;

    // Confirmer et sauvegarder
    const eleveData = {
      nom: sess.nom, niveau: sess.niveau, taux: sess.taux, duree: sess.duree,
      jour: sess.jour, heure: sess.heure, minute: sess.minute || 0,
      tda: sess.options?.tda || false, ficheHebdo: sess.options?.ficheHebdo || false,
      uneSemaineSurDeux: sess.options?.uneSemaineSurDeux || false,
      question2h: true, fiche: true,
    };

    const ok = await saveEleveCustom(chatId, eleveData);
    if (ok) {
      ELEVES[eleveData.nom] = eleveData;
      const resume = [
        `✅ *${eleveData.nom}* ajouté !`,
        `📚 ${eleveData.niveau} — ${eleveData.taux}€/h — ${eleveData.duree}h`,
        `📅 ${JOURS_NOMS[eleveData.jour]} à ${eleveData.heure}h${eleveData.minute > 0 ? eleveData.minute.toString().padStart(2,'0') : '00'}`,
        eleveData.tda ? '🧠 TDA activé' : '',
        eleveData.ficheHebdo ? '📋 Fiche hebdo' : '',
        eleveData.uneSemaineSurDeux ? '🔄 1 semaine/2' : '',
      ].filter(Boolean).join('\n');
      await send(chatId, resume);
    } else {
      await send(chatId, '❌ Erreur lors de l\'ajout. Réessaie.');
    }
    delete sessionsAjoutEleve[chatId];
    return;
  }

  // ── OUI/NON cours ─────────────────────────────────────
  if (data === 'cours_oui' || data === 'cours_non') {
    const eleve = session.eleve;
    if (!eleve) return;

    if (data === 'cours_non') {
      const gain_manque = await saveCoursManque(chatId, eleve);
      await send(chatId, `❌ Cours ${eleve} non effectué\n💸 Manque à gagner: *-${gain_manque.toFixed(2)}€*`);
      if (session.fileAttente && session.fileAttente.length > 0) {
        const next = session.fileAttente[0];
        const reste = session.fileAttente.slice(1);
        sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
        await sendBtns(chatId, `📚 Cours suivant — *${next}* — effectué ?`,
          [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
        );
      } else {
        delete sessions[chatId];
      }
      return;
    }

    if (ELEVES[eleve].question2h) {
      sessions[chatId] = { ...session, etape: 'question2h' };
      await sendBtns(chatId, `✅ Cours avec *${eleve}*\n\nC'était la séance à 2h ?`, [
        [{ t: '2h (1ère séance)', d: 'h2' }, { t: '1h (séance suivante)', d: 'h1' }],
        [{ t: '❌ Annuler', d: 'annuler' }]
      ]);
    } else {
      const gain = await saveCours(chatId, eleve, ELEVES[eleve].duree, session.rattrapage || false);
      await send(chatId, `✅ Cours ${eleve} enregistré ! *+${gain.toFixed(2)}€*`);
      await resumeCompletude(chatId);
      if (session.fileAttente && session.fileAttente.length > 0) {
        const next = session.fileAttente[0];
        const reste = session.fileAttente.slice(1);
        sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
        await sendBtns(chatId, `📚 Cours suivant — *${next}* — effectué ?`,
          [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
        );
      } else {
        delete sessions[chatId];
      }
    }
    return;
  }

  if (data === 'h2' || data === 'h1') {
    const eleve = session.eleve;
    if (!eleve) return;
    const heures = data === 'h2' ? 2 : 1;
    const gain = await saveCours(chatId, eleve, heures, session.rattrapage || false);
    await send(chatId, `✅ Cours ${eleve} enregistré ! *+${gain.toFixed(2)}€*`);
    await resumeCompletude(chatId);
    if (session.fileAttente && session.fileAttente.length > 0) {
      const next = session.fileAttente[0];
      const reste = session.fileAttente.slice(1);
      sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
      await sendBtns(chatId, `📚 Cours suivant — *${next}* — effectué ?`,
        [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
      );
    } else {
      delete sessions[chatId];
    }
    return;
  }

  // ── Catégorie dépense ──────────────────────────────────
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

  // ── Annuler ────────────────────────────────────────────
  if (data === 'annuler') {
    delete sessions[chatId];
    await send(chatId, '❌ Action annulée.');
    return;
  }

  // ── Fiche ──────────────────────────────────────────────
  if (data.startsWith('fiche_eleve_')) {
    const eleve = data.replace('fiche_eleve_', '');
    sessionsFiches[chatId] = { eleve, etape: 'attente_chapitre' };
    await send(chatId, `📚 Fiche pour *${eleve}*\n\nQuel chapitre ?\n_Ex: Fractions, Pythagore, Équations..._`);
    return;
  }

  if (data === 'fiche_annuler') {
    delete sessionsFiches[chatId];
    await send(chatId, '❌ Génération de fiche annulée.');
    return;
  }

  // ── Annuler type ───────────────────────────────────────
  if (data === 'ann_cours_fait') {
    const rows = [];
    const noms = Object.keys(ELEVES);
    for (let i = 0; i < noms.length; i += 3) {
      rows.push(noms.slice(i, i+3).map(n => ({ t: n, d: 'ann_cf_' + n })));
    }
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    sessionsAnnuler[chatId] = { type: 'cours_fait' };
    await sendBtns(chatId, '📚 Quel cours effectué annuler ?', rows);
    return;
  }

  if (data === 'ann_cours_manque') {
    const rows = [];
    const noms = Object.keys(ELEVES);
    for (let i = 0; i < noms.length; i += 3) {
      rows.push(noms.slice(i, i+3).map(n => ({ t: n, d: 'ann_cm_' + n })));
    }
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '❌ Quel cours manqué annuler ?', rows);
    return;
  }

  if (data === 'ann_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3) {
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: 'ann_dep_' + k })));
    }
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '💸 Quelle catégorie de dépense annuler ?', rows);
    return;
  }

  if (data.startsWith('ann_cf_')) {
    const eleve = data.replace('ann_cf_', '');
    const ok = await annulerDernierCours(eleve);
    delete sessionsAnnuler[chatId];
    if (ok) { await send(chatId, `✅ Dernier cours de *${eleve}* annulé !`); await resumeCompletude(chatId); }
    else { await send(chatId, `❌ Aucun cours trouvé pour *${eleve}* ce mois.`); }
    return;
  }

  if (data.startsWith('ann_cm_')) {
    const eleve = data.replace('ann_cm_', '');
    const ok = await annulerDernierCoursManque(eleve);
    delete sessionsAnnuler[chatId];
    if (ok) await send(chatId, `✅ Dernier cours manqué de *${eleve}* annulé !`);
    else await send(chatId, `❌ Aucun cours manqué trouvé pour *${eleve}* ce mois.`);
    return;
  }

  if (data.startsWith('ann_dep_')) {
    const cat = data.replace('ann_dep_', '');
    const item = await annulerDerniereDepense(cat);
    if (item) await send(chatId, `✅ Dépense annulée : *${item.montant} €* — ${BUDGETS[cat].label}\n_${item.libelle || ''}_`);
    else await send(chatId, `❌ Aucune dépense trouvée pour ${BUDGETS[cat].label} ce mois.`);
    return;
  }

  // ── Modifier ───────────────────────────────────────────
  if (data === 'mod_budget') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3) {
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label + ' (' + b.max + '€)', d: 'mod_bud_' + k })));
    }
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '📊 Quel budget modifier ?', rows);
    return;
  }

  if (data === 'mod_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3) {
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: 'mod_dep_' + k })));
    }
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '💸 Rectifier quelle catégorie de dépense ?', rows);
    return;
  }

  if (data.startsWith('mod_bud_')) {
    const cat = data.replace('mod_bud_', '');
    sessionsModifier[chatId] = { etape: 'attente_montant_budget', categorie: cat };
    await send(chatId, `📊 Budget *${BUDGETS[cat].label}* actuel : *${BUDGETS[cat].max} €*\n\nEnvoie le nouveau plafond mensuel (ex: *400*)`);
    return;
  }

  if (data.startsWith('mod_dep_')) {
    const cat = data.replace('mod_dep_', '');
    sessionsModifier[chatId] = { etape: 'attente_rectif_depense', categorie: cat };
    await send(chatId, `💸 Rectifier la dernière dépense *${BUDGETS[cat].label}*\n\nEnvoie le montant correct (ex: *45*)`);
    return;
  }

  // ── Revenu type ────────────────────────────────────────
  if (data.startsWith('rev_type_')) {
    const type = data.replace('rev_type_', '');
    sessionsRevenu[chatId] = { type, etape: 'montant' };
    await send(chatId, `💰 *${type}*\n\nMontant reçu ? (ex: *150*)`);
    return;
  }
}

// ============================================================
// WEBHOOK PRINCIPAL
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;

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
        `📚 _"cours avec Margaux"_ → signaler un cours\n` +
        `💸 _"Leclerc 45€"_ → dépense\n` +
        `👤 /ajouteleve → nouvel élève\n` +
        `💰 /revenu → enregistrer une rentrée\n` +
        `📅 /prelevements → voir ce qui arrive\n` +
        `🌐 Dashboard: https://budget-bot-production-eaaf.up.railway.app/dashboard`
      );
      return;
    }

    if (texte === '/reset') { delete sessions[chatId]; await send(chatId, '🔄 Conversation réinitialisée !'); return; }
    if (texte === '/fiche') { await demarrerFiche(chatId); return; }

    // /ajouteleve
    if (texte === '/ajouteleve' || texte === '/ajouter' || /ajouter?\s+[ée]l[eè]ve/i.test(texte)) {
      await demarrerAjoutEleve(chatId);
      return;
    }

    // /revenu
    if (texte === '/revenu' || texte === '/revenus') {
      await sendBtns(chatId, '💰 *Quel type de rentrée d\'argent ?*', [
        [{ t: '💼 Vinted / vente', d: 'rev_type_Vente Vinted' }, { t: '🔄 Remboursement', d: 'rev_type_Remboursement' }],
        [{ t: '🎁 Cadeau / don',   d: 'rev_type_Cadeau' },       { t: '📦 Autre',         d: 'rev_type_Autre revenu' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    // /prelevements
    if (texte === '/prelevements' || texte === '/prélèvements') {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const aujourd = now.getDate();
      const aVenir7j = getPrelEvementsAVenir(7);
      const totalRestant = getTotalPrelevementsRestants();
      let msg = `📅 *Prélèvements — Suivi du mois*\n\n`;
      msg += `📍 Nous sommes le *${aujourd}*\n`;
      msg += `💰 Total restant ce mois: *${totalRestant.toFixed(2)}€*\n\n`;

      if (aVenir7j.length > 0) {
        msg += `⚠️ *Dans les 7 prochains jours:*\n`;
        aVenir7j.forEach(p => {
          const quand = p.dansJours === 0 ? 'Aujourd\'hui' : p.dansJours === 1 ? 'Demain' : `Dans ${p.dansJours}j`;
          msg += `• ${quand} (${p.jourEffectif}) — ${p.nom}: *${p.montant.toFixed(2)}€*\n`;
        });
        const totalSemaine = aVenir7j.reduce((s, p) => s + p.montant, 0);
        msg += `\n💸 Total cette semaine: *${totalSemaine.toFixed(2)}€*\n`;
      } else {
        msg += `✅ Aucun prélèvement dans les 7 prochains jours\n`;
      }

      msg += `\n_Dashboard complet: /dashboard_`;
      await send(chatId, msg);
      return;
    }

    // /annuler
    if (texte === '/annuler') {
      await sendBtns(chatId, '🔄 *Que veux-tu annuler ?*', [
        [{ t: '📚 Un cours effectué', d: 'ann_cours_fait' }, { t: '❌ Un cours manqué', d: 'ann_cours_manque' }],
        [{ t: '💸 Une dépense', d: 'ann_depense' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    // /modifier
    if (texte === '/modifier') {
      await sendBtns(chatId, '✏️ *Que veux-tu modifier ?*', [
        [{ t: '📊 Un budget catégorie', d: 'mod_budget' }],
        [{ t: '💸 Rectifier une dépense', d: 'mod_depense' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    // ── ÉTATS ACTIFS ───────────────────────────────────────

    // Ajout élève en cours
    if (sessionsAjoutEleve[chatId]) {
      const handled = await traiterAjoutEleve(chatId, texte);
      if (handled) return;
    }

    // Revenu en cours
    if (sessionsRevenu[chatId] && sessionsRevenu[chatId].etape === 'montant') {
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        await saveRevenu(chatId, montant, sessionsRevenu[chatId].type);
        delete sessionsRevenu[chatId];
        await send(chatId, `✅ Rentrée *+${montant}€* enregistrée ! (${sessionsRevenu[chatId]?.type || 'Revenu'})`);
      } else {
        await send(chatId, 'Envoie un montant valide, ex: *150*');
      }
      return;
    }

    // Modifier budget
    if (sessionsModifier[chatId]?.etape === 'attente_montant_budget') {
      const cat = sessionsModifier[chatId].categorie;
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        BUDGETS[cat].max = montant;
        delete sessionsModifier[chatId];
        await send(chatId, `✅ Budget *${BUDGETS[cat].label}* mis à jour : *${montant} €/mois*`);
      } else {
        await send(chatId, 'Envoie un montant valide, ex: *400*');
      }
      return;
    }

    // Modifier dépense
    if (sessionsModifier[chatId]?.etape === 'attente_rectif_depense') {
      const cat = sessionsModifier[chatId].categorie;
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        const item = await annulerDerniereDepense(cat);
        if (item) {
          await saveDepense(chatId, montant, cat, item.libelle || texte);
          delete sessionsModifier[chatId];
          await send(chatId, `✅ Dépense rectifiée : *${montant} €* — ${BUDGETS[cat].label}\nAncien montant : ${item.montant} €`);
        } else {
          await send(chatId, `Aucune dépense trouvée pour ${BUDGETS[cat].label} ce mois.`);
          delete sessionsModifier[chatId];
        }
      } else {
        await send(chatId, 'Envoie le nouveau montant, ex: *45*');
      }
      return;
    }

    // Fiche en cours
    if (sessionsFiches[chatId]?.etape === 'attente_chapitre') {
      const eleve = sessionsFiches[chatId].eleve;
      delete sessionsFiches[chatId];
      await send(chatId, `📝 Génération de la fiche pour *${eleve}*...`);
      try {
        const contenu = await genererContenuFiche(eleve, texte);
        const pdfPath = await creerPDF(eleve, texte, contenu);
        await sendDocument(chatId, pdfPath, `fiche_${eleve}_${texte.replace(/ /g,'_')}.pdf`);
        fs.unlinkSync(pdfPath);
      } catch (err) {
        console.error('Erreur fiche PDF:', err.message);
        await send(chatId, '❌ Erreur génération fiche. Réessaie.');
      }
      return;
    }

    // /bilan
    if (texte === '/bilan') {
      const data = await getData();
      let m = `📊 *Bilan ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      Object.entries(data.totaux).forEach(([k, v]) => {
        const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        m += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      m += `\n💰 *Solde: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
      await send(chatId, m);
      return;
    }

    if (texte === '/completude') {
      const data = await getData();
      let m = `📚 *Complétude ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      m += `🟢 *${data.completude.toFixed(2)}€* / ${OBJECTIF_COMPLETUDE}€\n`;
      m += `Cours: ${data.cours.length}\n`;
      if (data.cours.length > 0) {
        m += `\n*Détail:*\n`;
        data.cours.forEach(c => { m += `• ${c.eleve}${c.rattrapage ? ' (rattrapage)' : ''}: +${c.gain.toFixed(2)}€\n`; });
      }
      if (data.coursManques.length > 0) {
        m += `\n❌ *Manques:*\n`;
        data.coursManques.forEach(c => { m += `• ${c.eleve}: -${c.gain_manque.toFixed(2)}€\n`; });
      }
      await send(chatId, m);
      return;
    }

    if (texte === '/objectifs') {
      const data = await getData();
      let m = `🎯 *Objectifs épargne*\n\n💼 Actuelle: *${data.epargneBase.toLocaleString()}€*\n📈 Projection: *${data.epargneEstimee.toFixed(0)}€*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = data.epargneEstimee - o.montant;
        const pct = Math.min(100, Math.round((data.epargneEstimee / o.montant) * 100));
        m += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}*: ${o.montant.toLocaleString()}€ — ${pct}%\n`;
      });
      await send(chatId, m);
      return;
    }

    // ── DÉTECTION COURS ────────────────────────────────────
    const tousEleves = trouverTousLesEleves(texte);
    const eleve = tousEleves[0] || null;
    const isCours = /cours|rattrapage|seance/i.test(texte);
    const isPasFait = /pas fait|absent|annule|pas pu|rate/i.test(texte);

    if (eleve && isCours) {
      const rattrapage = /rattrapage/i.test(texte);
      const fileAttente = tousEleves.slice(1);

      if (isPasFait) {
        for (const el of tousEleves) {
          const gain_manque = await saveCoursManque(chatId, el);
          await send(chatId, `❌ Cours ${el} non effectué\n💸 Manque: *-${gain_manque.toFixed(2)}€*`);
        }
        return;
      }

      sessions[chatId] = { eleve, rattrapage, etape: 'confirmation', fileAttente };
      await sendBtns(chatId,
        `📚 Cours avec *${eleve}*${rattrapage ? ' _(rattrapage)_' : ''} — effectué ?`,
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
        await saveDepense(chatId, montant, cat, texte);
        const newData = await getData();
        const restant = BUDGETS[cat].max - newData.totaux[cat];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
        await send(chatId, `✅ *${montant}€* — ${BUDGETS[cat].label}\n${emoji} Restant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
      } else {
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

    // ── SALAIRE ────────────────────────────────────────────
    if (/salaire|lgm|paie/i.test(texte) && montant && montant > 1000) {
      await saveSalaire(chatId, montant);
      await send(chatId, `✅ Salaire LGM enregistré: *${montant}€* 📊`);
      return;
    }

    // ── ÉPARGNE ────────────────────────────────────────────
    if (/epargne|épargne|economies/i.test(texte) && montant && montant > 1000) {
      await saveEpargne(chatId, montant);
      await send(chatId, `✅ Épargne mise à jour: *${montant.toLocaleString()}€* 💎`);
      return;
    }

    // ── REVENU ─────────────────────────────────────────────
    if (/recu|vinted|remboursement|rentree|participation/i.test(texte) && montant) {
      await saveRevenu(chatId, montant, texte);
      await send(chatId, `✅ Rentrée *+${montant}€* enregistrée !`);
      return;
    }

    // ── GEMINI ─────────────────────────────────────────────
    const data = await getData();
    const reponse = await geminiParle(chatId, texte, data);
    await send(chatId, reponse);

  } catch (err) {
    console.error('Erreur webhook:', err.message);
    await send(chatId, 'Erreur technique, réessaie.');
  }
});

// ============================================================
// MESSAGES AUTOMATIQUES
// ============================================================
async function envoyerRappelBiHebdo() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const aVenir = getPrelEvementsAVenir(5);
  let msg = `📋 *Rappel bi-hebdo — ${mois}*\n\n`;
  msg += `💰 LGM: ${data.salaire}€ | Beau-frère: ${BEAU_FRERE}€ | Complétude: ${data.completude.toFixed(0)}€/${OBJECTIF_COMPLETUDE}€\n\n`;
  msg += `💸 *Dépenses:*\n`;
  Object.entries(data.totaux).forEach(([k, v]) => {
    if (v > 0) {
      const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€/${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 Solde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
  if (data.totalManque > 0) msg += `\n💸 Manques: *-${data.totalManque.toFixed(0)}€*`;
  if (aVenir.length > 0) {
    const totalSem = aVenir.reduce((s, p) => s + p.montant, 0);
    msg += `\n\n⚠️ *Prélèvements dans 5j: -${totalSem.toFixed(0)}€*\n`;
    aVenir.forEach(p => msg += `• ${p.nom}: ${p.montant.toFixed(0)}€ (le ${p.jourEffectif})\n`);
  }
  msg += `\n_Des dépenses à enregistrer ?_`;
  await send(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase();
  let msg = `🗓️ *SYNTHÈSE ${mois}*\n\n`;
  msg += `✅ *REVENUS: ${data.totalRevenus.toFixed(0)}€*\n• LGM: ${data.salaire}€\n• Beau-frère: ${BEAU_FRERE}€\n• Complétude: ${data.completude.toFixed(0)}€\n`;
  if (data.revenusSupp > 0) msg += `• Divers: ${data.revenusSupp.toFixed(0)}€\n`;
  msg += `\n🔒 *CHARGES: -${TOTAL_CHARGES_FIXES.toFixed(0)}€*\n\n💸 *DÉPENSES: -${data.totalDep.toFixed(0)}€*\n`;
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

    // Alerte prélèvement J-1
    const demain = now.getDate() + 1;
    if (heure === 9 && minute === 0) {
      const alertes = PRELEVEMENTS_DATES.filter(p => p.jour === demain);
      if (alertes.length > 0) {
        const total = alertes.reduce((s, p) => s + p.montant, 0);
        let msg = `⚠️ *Prélèvements demain (${demain})*\n\n`;
        alertes.forEach(p => msg += `• ${p.nom}: *${p.montant.toFixed(2)}€*\n`);
        msg += `\n💸 Total: *${total.toFixed(2)}€*\n_Vérifie que ton compte est alimenté !_`;
        await send(CHAT_ID, msg);
      }
    }

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
// ENVOI DOCUMENT
// ============================================================
async function sendDocument(chatId, filePath, filename) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', fs.createReadStream(filePath), { filename });
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, {
    method: 'POST', body: form, headers: form.getHeaders()
  });
}

// ============================================================
// GÉNÉRATION FICHE PDF
// ============================================================
const PROFILS_FICHES = {
  'Amel':        { niveau: '5e',  format: 'standard' },
  'Benjamin':    { niveau: '5e',  format: 'standard', note: 'Impatient, erreurs attention — inclure exercices de vérification' },
  'Guillaume':   { niveau: '5e',  format: 'tda',      note: 'TDA — consignes ultra courtes, max 4 exos, beaucoup espace' },
  'Margaux':     { niveau: '3e',  format: 'standard' },
  'Nélia':       { niveau: '3e',  format: 'standard' },
  'Hélène':      { niveau: '5e',  format: 'standard' },
  'Mathéo':      { niveau: '3e',  format: 'hebdo',    note: 'Fiche lundi-vendredi, 2 exos courts par jour' },
  'Anne-Gaëlle': { niveau: '3e',  format: 'standard' },
  'Saïda':       { niveau: '5e',  format: 'standard' },
  'Serena':      { niveau: '5e',  format: 'standard' },
};

async function genererContenuFiche(eleve, chapitre) {
  const profil = PROFILS_FICHES[eleve] || { niveau: ELEVES[eleve]?.niveau || '5e', format: 'standard' };
  const model = genAI.getGenerativeModel({ model: MODELE });
  const regles = `REGLES ABSOLUES:
- Texte brut uniquement, ZERO LaTeX
- Fractions: ecrire "3/4", puissances: "x^2", racines: "racine(9)"
- Exercices numerotes clairement
- Corrige complet apres "=== CORRIGE ==="
- Adapte au programme officiel de ${profil.niveau} en France`;

  let prompt = '';
  if (profil.format === 'hebdo') {
    prompt = `Tu es professeur de mathematiques experimente. Cree une fiche hebdomadaire pour ${eleve}, eleve de ${profil.niveau}.
Chapitre: ${chapitre}
${regles}
${profil.note ? 'Note pedagogique: ' + profil.note : ''}
FORMAT STRICT: LUNDI/MARDI/MERCREDI/JEUDI/VENDREDI avec 2 exercices chacun.
=== CORRIGE ===
[Corrige complet]`;
  } else if (profil.format === 'tda') {
    prompt = `Tu es professeur specialise TDA/TDAH. Cree une fiche pour ${eleve}, eleve de ${profil.niveau}.
Chapitre: ${chapitre}
${regles}
${profil.note ? 'Note pedagogique: ' + profil.note : ''}
CONSIGNES: Maximum 4 exercices, 1 phrase par consigne.
=== CORRIGE ===
[Corrige complet]`;
  } else {
    prompt = `Tu es professeur de mathematiques experimente. Cree une fiche pour ${eleve}, eleve de ${profil.niveau}.
Chapitre: ${chapitre}
${regles}
${profil.note ? 'Note pedagogique: ' + profil.note : ''}
4 a 5 exercices de difficulte progressive.
=== CORRIGE ===
[Corrige detaille]`;
  }

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function creerPDF(eleve, chapitre, contenu) {
  const profil = PROFILS_FICHES[eleve] || { niveau: ELEVES[eleve]?.niveau || '5e' };
  const tmpPath = path.join('/tmp', `fiche_${eleve}_${Date.now()}.pdf`);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(tmpPath);
    doc.pipe(stream);
    doc.rect(0, 0, doc.page.width, 80).fill('#0D1B2A');
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text("L'Agent — Fiche d'exercices", 40, 20);
    doc.fontSize(11).font('Helvetica').text(`${eleve} — ${profil.niveau} — ${chapitre}`, 40, 48);
    doc.text(new Date().toLocaleDateString('fr-FR'), 40, 62);
    doc.fillColor('#333333').moveDown(3);
    const lignes = contenu.split('\n');
    let dansCorrige = false;
    for (const ligne of lignes) {
      if (ligne.trim() === '') { doc.moveDown(0.4); continue; }
      if (ligne.startsWith('=== CORRIGE ===')) {
        doc.moveDown(1).rect(40, doc.y, doc.page.width - 80, 1).fill('#F26419').moveDown(0.5);
        doc.fillColor('#F26419').fontSize(13).font('Helvetica-Bold').text('CORRIGÉ', 40, doc.y);
        doc.fillColor('#333333'); dansCorrige = true; doc.moveDown(0.5); continue;
      }
      if (/^(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI)$/i.test(ligne.trim())) {
        doc.moveDown(0.5).fillColor('#0D1B2A').fontSize(12).font('Helvetica-Bold').text(ligne.trim(), 40, doc.y);
        doc.fillColor('#333333'); continue;
      }
      if (/^exercice\s*\d+/i.test(ligne.trim())) {
        doc.moveDown(0.3);
        doc.fillColor(dansCorrige ? '#2E7D32' : '#0D1B2A').fontSize(11).font('Helvetica-Bold').text(ligne.trim(), 40, doc.y, { width: doc.page.width - 80 });
        doc.fillColor('#333333'); continue;
      }
      doc.fontSize(10).font('Helvetica').text(ligne, 40, doc.y, { width: doc.page.width - 80 });
    }
    const pageBottom = doc.page.height - 30;
    doc.rect(0, pageBottom - 10, doc.page.width, 40).fill('#0D1B2A');
    doc.fillColor('white').fontSize(8).font('Helvetica').text("Généré par L'Agent • Complétude", 40, pageBottom, { align: 'center', width: doc.page.width - 80 });
    doc.end();
    stream.on('finish', () => resolve(tmpPath));
    stream.on('error', reject);
  });
}

// ============================================================
// ANNULATION
// ============================================================
async function annulerDernierCours(eleve) {
  const debut = new Date(); debut.setUTCDate(1); debut.setUTCHours(0,0,0,0);
  const { data } = await supabase.from('cours').select('id').eq('eleve', eleve).gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  if (!data || data.length === 0) return false;
  const { error } = await supabase.from('cours').delete().eq('id', data[0].id);
  return !error;
}

async function annulerDernierCoursManque(eleve) {
  const debut = new Date(); debut.setUTCDate(1); debut.setUTCHours(0,0,0,0);
  const { data } = await supabase.from('cours_manques').select('id').eq('eleve', eleve).gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  if (!data || data.length === 0) return false;
  const { error } = await supabase.from('cours_manques').delete().eq('id', data[0].id);
  return !error;
}

async function annulerDerniereDepense(categorie) {
  const debut = new Date(); debut.setUTCDate(1); debut.setUTCHours(0,0,0,0);
  const { data } = await supabase.from('depenses').select('id,montant,libelle').eq('categorie', categorie).gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(1);
  if (!data || data.length === 0) return null;
  const item = data[0];
  await supabase.from('depenses').delete().eq('id', item.id);
  return item;
}

// ============================================================
// FICHE — SESSION DÉDIÉE
// ============================================================
async function demarrerFiche(chatId) {
  const elevesDispo = Object.keys(ELEVES);
  const rows = [];
  for (let i = 0; i < elevesDispo.length; i += 3) {
    rows.push(elevesDispo.slice(i, i + 3).map(n => ({ t: n, d: `fiche_eleve_${n}` })));
  }
  rows.push([{ t: '↩️ Annuler', d: 'fiche_annuler' }]);
  await sendBtns(chatId, '📚 *Génération de fiche*\n\nPour quel élève ?', rows);
}

// ============================================================
// API DASHBOARD
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const moisOffset = parseInt(req.query.mois || '0');
    const data = await getData(moisOffset);
    const aVenir = getPrelEvementsAVenir(7);
    const totalRestant = getTotalPrelevementsRestants();

    // Labels des mois disponibles (mois courant - 5 → mois courant)
    const moisDisponibles = [];
    for (let i = -5; i <= 0; i++) {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() + i);
      moisDisponibles.push({
        offset: i,
        label: d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' }),
        isCurrent: i === 0
      });
    }

    res.json({
      salaire: data.salaire, beau_frere: BEAU_FRERE,
      completude: data.completude, objectif_completude: OBJECTIF_COMPLETUDE,
      total_revenus: data.totalRevenus, charges_fixes: TOTAL_CHARGES_FIXES,
      total_dep: data.totalDep, solde: data.solde,
      epargne_base: data.epargneBase, epargne_estimee: data.epargneEstimee,
      total_manque: data.totalManque, nb_cours: data.cours.length,
      nb_cours_manques: data.coursManques.length,
      cours: data.cours, cours_manques: data.coursManques,
      totaux: data.totaux, detail: data.detail,
      budgets: BUDGETS, objectifs: OBJECTIFS,
      revenus_supp: data.revenus,
      prelevements_a_venir: aVenir,
      total_prelevements_restants: totalRestant,
      prelevements_tous: PRELEVEMENTS_DATES,
      mois_offset: moisOffset,
      mois_disponibles: moisDisponibles,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DASHBOARD — remplace app.get('/dashboard', ...) dans index.js
// ============================================================
app.get('/dashboard', (req, res) => {
  const BG = 'data:image/png;base64,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';
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0f1e">
<title>Comptable</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --or:#F26419;--amber:#FFAA44;
  --g:#4ade80;--r:#f87171;--b:#60a5fa;
  --tx:#e8ecf0;--mu:#5a6a7a;
  --card:rgba(8,16,30,0.70);
  --bord:rgba(255,255,255,0.08);
  --mono:'DM Mono',monospace;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;font-family:'Sora',sans-serif;color:var(--tx);overflow-x:hidden}
body{
  padding-bottom:env(safe-area-inset-bottom,20px);
  padding-bottom:calc(env(safe-area-inset-bottom,20px) + 20px);
  background:#060c18;
}

/* ── BG IMAGE ── */
.bg{
  position:fixed;inset:0;z-index:0;
  background:url('${BG}') center/cover no-repeat;
}
.bg-ov{
  position:fixed;inset:0;z-index:1;
  background:linear-gradient(
    180deg,
    rgba(4,8,20,0.88) 0%,
    rgba(6,12,28,0.72) 35%,
    rgba(6,12,28,0.72) 65%,
    rgba(4,8,20,0.95) 100%
  );
}

/* ── SAFE AREA STATUS BAR ── */
.safe-top{
  position:fixed;top:0;left:0;right:0;z-index:100;
  height:env(safe-area-inset-top,47px);
  background:rgba(4,8,20,0.88);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
}

/* ── CONTENU ── */
.wrap{
  position:relative;z-index:10;
  max-width:430px;margin:0 auto;
  padding-top:calc(env(safe-area-inset-top,47px) + 0px);
}

/* ── HEADER ── */
.header{
  padding:.9rem 1rem .6rem;
  background:rgba(4,8,20,0.60);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border-bottom:1px solid var(--bord);
  position:sticky;
  top:env(safe-area-inset-top,47px);
  z-index:50;
}
.header-row{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:10px}
.brand-ico{
  width:34px;height:34px;border-radius:10px;
  background:linear-gradient(135deg,var(--or),var(--amber));
  display:grid;place-items:center;font-size:.95rem;
  box-shadow:0 3px 12px rgba(242,100,25,.4);
  flex-shrink:0;
}
.brand-name{font-size:1rem;font-weight:700;letter-spacing:-.02em}
.brand-sub{font-size:.58rem;color:var(--mu);letter-spacing:.07em;text-transform:uppercase;margin-top:1px}
.hsolde-lbl{font-size:.55rem;color:var(--mu);text-transform:uppercase;letter-spacing:.07em;text-align:right}
.hsolde-val{font-size:1.05rem;font-weight:700;font-family:var(--mono);text-align:right}

/* mois nav */
.mois-nav{
  display:flex;align-items:center;justify-content:space-between;
  margin:.5rem 0 0;
  background:rgba(255,255,255,0.04);border-radius:9px;padding:4px 8px;
}
.mbtn{background:none;border:none;color:var(--mu);font-size:.95rem;cursor:pointer;padding:2px 10px;border-radius:6px;transition:.15s}
.mbtn:hover:not(:disabled){color:var(--tx);background:rgba(255,255,255,.07)}
.mbtn:disabled{opacity:.2;cursor:default}
.mlbl{font-size:.76rem;font-weight:600;text-align:center}
.mbadge{font-size:.56rem;color:var(--or);text-align:center;letter-spacing:.06em;text-transform:uppercase}

/* ── TABS ── */
.tabs{
  display:flex;gap:2px;
  padding:.5rem .75rem .25rem;
  overflow-x:auto;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
}
.tabs::-webkit-scrollbar{display:none}
.tab{
  flex:0 0 auto;
  padding:6px 11px;font-size:.58rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  border-radius:7px;cursor:pointer;
  color:rgba(255,255,255,.38);border:1px solid transparent;
  transition:.18s;white-space:nowrap;
}
.tab.active{
  background:rgba(242,100,25,.18);color:var(--or);
  border-color:rgba(242,100,25,.35);
}

/* ── SECTIONS ── */
.sec{display:none;padding:.5rem .75rem 0}
.sec.on{display:block}

/* ── GRID ── */
.grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem}
.full{grid-column:1/-1}

/* ── CARD ── */
.card{
  background:var(--card);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border-radius:14px;padding:.8rem;
  border:1px solid var(--bord);
}
.clbl{font-size:.56rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mu);margin-bottom:.3rem}
.cval{font-size:1.4rem;font-weight:700;font-family:var(--mono);letter-spacing:-.02em;line-height:1.1}
.csub{font-size:.6rem;color:var(--mu);margin-top:.25rem;line-height:1.4}

/* ── BAR ── */
.bar{height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;margin:.45rem 0 .2rem}
.fill{height:100%;border-radius:2px;transition:width .6s cubic-bezier(.4,0,.2,1)}

/* ── ROWS ── */
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.74rem}
.row:last-child{border-bottom:none}
.row-left{display:flex;align-items:center;gap:8px}
.row-ico{font-size:.9rem;width:22px;text-align:center}
.row-meta{display:flex;flex-direction:column;gap:1px}
.row-name{font-size:.74rem}
.row-sub{font-size:.58rem;color:var(--mu)}
.row-right{text-align:right;flex-shrink:0}
.row-val{font-family:var(--mono);font-size:.78rem}
.row-pct{font-size:.56rem;color:var(--mu)}

/* ── BADGES ── */
.badge{display:inline-block;font-size:.56rem;padding:2px 7px;border-radius:5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.b-hist{background:#1a1a30;color:#6366f1;border:1px solid #2a2a50}
.b-ok{background:rgba(74,222,128,.12);color:var(--g)}
.b-warn{background:rgba(251,191,36,.12);color:var(--amber)}
.b-err{background:rgba(248,113,113,.12);color:var(--r)}
.b-or{background:rgba(242,100,25,.12);color:var(--or)}

/* ── PREL BADGES ── */
.pb{font-size:.56rem;padding:2px 7px;border-radius:5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.pb-u{background:#2d0a0a;color:var(--r)}
.pb-s{background:#2d1f04;color:var(--amber)}
.pb-o{background:#0a1e0f;color:var(--g)}
.prel-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.74rem}
.prel-row:last-child{border-bottom:none}
.prel-row.past{opacity:.32}
.stitle{font-size:.55rem;color:var(--mu);text-transform:uppercase;letter-spacing:.07em;padding:8px 0 3px}

/* ── ALERT BOX ── */
.abox{
  background:rgba(22,14,6,.85);border:1px solid rgba(255,170,68,.22);
  border-radius:11px;padding:.7rem .8rem;margin-bottom:.5rem;
}
.abox-title{color:var(--amber);font-weight:700;font-size:.76rem;margin-bottom:.35rem}

/* ── OBJECTIFS ── */
.obj{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.obj:last-child{border-bottom:none}
.obj-h{display:flex;justify-content:space-between;font-size:.76rem;margin-bottom:.35rem}

/* ── COURS ── */
.crow{display:flex;justify-content:space-between;font-size:.72rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.crow:last-child{border-bottom:none}

/* ── BUDGET CATEGORY ── */
.ccat{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:opacity .15s}
.ccat:last-of-type{border-bottom:none}
.ccat:hover{opacity:.72}
.ccat .chev{color:var(--mu);font-size:.7rem;transition:transform .2s;margin-left:4px}
.ccat.open .chev{transform:rotate(90deg)}
.cdet{display:none;background:rgba(0,0,0,.35);border-radius:9px;padding:6px 10px;margin:3px 0 6px}
.cdet.open{display:block}
.dep-i{display:flex;justify-content:space-between;font-size:.68rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04);color:#8a9ab0}
.dep-i:last-child{border-bottom:none}
.minibar{width:40px;height:3px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;flex-shrink:0}
.minifill{height:100%;border-radius:2px}

/* ── TOTAL DEP ── */
.dep-total{
  display:flex;justify-content:space-between;align-items:center;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
  border-radius:10px;padding:.6rem .75rem;margin-top:.55rem;
}

/* ── REFRESH ── */
.refresh{
  position:fixed;
  bottom:calc(env(safe-area-inset-bottom,20px) + 1rem);
  right:1.1rem;z-index:200;
  background:linear-gradient(135deg,var(--or),var(--amber));
  color:#fff;border:none;border-radius:50%;
  width:44px;height:44px;font-size:1.1rem;
  cursor:pointer;box-shadow:0 4px 16px rgba(242,100,25,.45);
  transition:transform .2s;
}
.refresh:active{transform:scale(.92) rotate(30deg)}
.upd{text-align:center;font-size:.58rem;color:#2a3545;padding:.8rem 0 1rem}

.green{color:var(--g)}.amber{color:var(--amber)}.red{color:var(--r)}.orange{color:var(--or)}
</style>
</head>
<body>

<div class="bg"></div>
<div class="bg-ov"></div>
<div class="safe-top"></div>

<div class="wrap">

  <!-- HEADER -->
  <div class="header">
    <div class="header-row">
      <div class="brand">
        <div class="brand-ico">💼</div>
        <div>
          <div class="brand-name">Comptable</div>
          <div class="brand-sub">Tableau de bord</div>
        </div>
      </div>
      <div>
        <div class="hsolde-lbl">Solde mois</div>
        <div class="hsolde-val" id="h-solde">—</div>
      </div>
    </div>
    <div class="mois-nav">
      <button class="mbtn" onclick="changerMois(-1)">◀</button>
      <div>
        <div class="mlbl" id="mois-label">—</div>
        <div class="mbadge" id="mois-badge"></div>
      </div>
      <button class="mbtn" id="btn-next" onclick="changerMois(1)">▶</button>
    </div>
  </div>

  <!-- TABS -->
  <div class="tabs">
    <div class="tab active" onclick="setTab('apercu')">Aperçu</div>
    <div class="tab" onclick="setTab('cours')">Cours</div>
    <div class="tab" onclick="setTab('revenus')">Revenus</div>
    <div class="tab" onclick="setTab('depenses')">Dépenses</div>
    <div class="tab" onclick="setTab('prelevements')">Prélèv.</div>
    <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
  </div>

  <!-- ── APERÇU ── -->
  <div class="sec on" id="tab-apercu">
    <div class="grid">
      <div class="card">
        <div class="clbl">Épargne actuelle</div>
        <div class="cval green" id="a-ep">—</div>
      </div>
      <div class="card">
        <div class="clbl">Projection fin mois</div>
        <div class="cval" id="a-pr">—</div>
      </div>
      <div class="card">
        <div class="clbl">Revenus</div>
        <div class="cval green" id="a-rv">—</div>
        <div class="csub" id="a-rv-sub">—</div>
      </div>
      <div class="card">
        <div class="clbl">Charges fixes</div>
        <div class="cval orange" id="a-cf">—</div>
        <div class="csub red" id="a-dp-sub">—</div>
      </div>
      <div class="card">
        <div class="clbl">Solde estimé</div>
        <div class="cval" id="a-sl">—</div>
        <div class="bar"><div class="fill" id="a-sl-b"></div></div>
      </div>
      <div class="card">
        <div class="clbl">Complétude</div>
        <div class="cval" id="a-co">—</div>
        <div class="bar"><div class="fill" id="a-co-b"></div></div>
        <div class="csub" id="a-co-s">—</div>
      </div>
    </div>
  </div>

  <!-- ── COURS ── -->
  <div class="sec" id="tab-cours">
    <div class="grid">
      <div class="card">
        <div class="clbl">Effectués</div>
        <div class="cval green" id="c-nb">—</div>
      </div>
      <div class="card">
        <div class="clbl">Manqués</div>
        <div class="cval red" id="c-mn">—</div>
        <div class="csub" id="c-mv">—</div>
      </div>
      <div class="card full">
        <div class="clbl" style="margin-bottom:.5rem">Détail cours effectués</div>
        <div id="c-ls"><span style="color:var(--mu);font-size:.72rem">—</span></div>
      </div>
      <div class="card full" id="c-mc" style="display:none">
        <div class="clbl" style="margin-bottom:.5rem">Cours manqués</div>
        <div id="c-ml"></div>
      </div>
    </div>
  </div>

  <!-- ── REVENUS ── -->
  <div class="sec" id="tab-revenus">
    <div class="grid">
      <div class="card">
        <div class="clbl">Total revenus</div>
        <div class="cval green" id="r-total">—</div>
      </div>
      <div class="card">
        <div class="clbl">Complétude</div>
        <div class="cval" id="r-co">—</div>
        <div class="csub" id="r-co-s">—</div>
      </div>
      <div class="card full" id="r-sources">
        <div class="clbl" style="margin-bottom:.5rem">Sources</div>
      </div>
      <div class="card full" id="r-supp" style="display:none"></div>
    </div>
  </div>

  <!-- ── DÉPENSES ── -->
  <div class="sec" id="tab-depenses">
    <div class="grid">
      <div class="card full" id="b-ls">
        <div class="clbl">Dépenses variables</div>
      </div>
    </div>
  </div>

  <!-- ── PRÉLÈVEMENTS ── -->
  <div class="sec" id="tab-prelevements">
    <div class="grid">
      <div class="card full" id="p-alert" style="display:none"></div>
      <div class="card full" id="p-ls">Chargement...</div>
    </div>
  </div>

  <!-- ── OBJECTIFS ── -->
  <div class="sec" id="tab-objectifs">
    <div class="grid">
      <div class="card full" id="o-ls">Chargement...</div>
    </div>
  </div>

</div><!-- /wrap -->

<button class="refresh" onclick="charger()" title="Actualiser">↻</button>
<div class="upd" id="upd">—</div>

<script>
let moisOffset=0;

/* helpers */
function fmt(n){return Math.round(n).toLocaleString('fr-FR')+'\u202f€'}
function fmt2(n){return n.toFixed(2)+'\u202f€'}
function pct(v,m){return Math.min(100,Math.max(0,Math.round(v/m*100)))}
function colP(p){return p>=100?'var(--r)':p>=80?'var(--amber)':'var(--g)'}
function colS(v){return v>=500?'var(--g)':v>=0?'var(--amber)':'var(--r)'}
function el(id){return document.getElementById(id)}

function setTab(t){
  const names=['apercu','cours','revenus','depenses','prelevements','objectifs'];
  document.querySelectorAll('.tab').forEach((e,i)=>e.classList.toggle('active',names[i]===t));
  document.querySelectorAll('.sec').forEach(e=>e.classList.remove('on'));
  el('tab-'+t).classList.add('on');
}
function changerMois(d){const n=moisOffset+d;if(n>0)return;moisOffset=n;charger()}
function toggleCat(k){
  el('cat-btn-'+k).classList.toggle('open');
  el('cat-det-'+k).classList.toggle('open');
}

/* ── RENDER APERÇU ── */
function renderApercu(d){
  el('a-ep').textContent=fmt(d.epargne_base);
  const pr=el('a-pr');
  pr.textContent=fmt(d.epargne_estimee);
  pr.style.color=d.epargne_estimee>=12500?'var(--g)':d.epargne_estimee>=10000?'var(--amber)':'var(--r)';

  el('a-rv').textContent=fmt(d.total_revenus);
  const parts=[];
  if(d.salaire)parts.push('LGM '+Math.round(d.salaire)+'€');
  if(d.completude)parts.push('Cours '+Math.round(d.completude)+'€');
  if((d.revenus_supp||[]).length)parts.push('+divers');
  el('a-rv-sub').textContent=parts.join(' · ');

  el('a-cf').textContent=fmt(d.charges_fixes);
  el('a-dp-sub').textContent='Variables : -'+Math.round(d.total_dep)+'\u202f€';

  const sl=el('a-sl');
  sl.textContent=(d.solde>=0?'+':'')+fmt(d.solde);
  sl.style.color=colS(d.solde);
  el('a-sl-b').style.cssText='width:'+Math.min(100,Math.max(0,(d.solde/1500)*100))+'%;background:'+colS(d.solde);

  const cp=pct(d.completude,d.objectif_completude);
  const co=el('a-co');
  co.textContent=fmt(d.completude);
  co.style.color=colP(cp);
  el('a-co-b').style.cssText='width:'+cp+'%;background:'+colP(cp);
  el('a-co-s').textContent=Math.round(d.completude)+' / '+d.objectif_completude+'\u202f€ ('+cp+'%)';
}

/* ── RENDER COURS ── */
function renderCours(d){
  el('c-nb').textContent=d.nb_cours;
  el('c-mn').textContent=d.nb_cours_manques;
  el('c-mv').textContent=d.total_manque>0?'-'+fmt(d.total_manque)+' manqués':'Aucun';
  el('c-ls').innerHTML=d.cours.length===0
    ?'<span style="color:var(--mu);font-size:.72rem">Aucun cours ce mois</span>'
    :d.cours.map(c=>'<div class="crow"><span>'+c.eleve+(c.rattrapage?' <span style="color:var(--mu)">(rattrapage)</span>':'')+'</span><span class="green" style="font-family:var(--mono)">+'+c.gain.toFixed(2)+'\u202f€</span></div>').join('');
  const mc=el('c-mc');
  if(d.nb_cours_manques>0){
    mc.style.display='block';
    el('c-ml').innerHTML=d.cours_manques.map(c=>'<div class="crow"><span>'+c.eleve+'</span><span class="red" style="font-family:var(--mono)">-'+c.gain_manque.toFixed(2)+'\u202f€</span></div>').join('');
  }else{mc.style.display='none'}
}

/* ── RENDER REVENUS ── */
function renderRevenus(d){
  el('r-total').textContent=fmt(d.total_revenus);
  const cp=pct(d.completude,d.objectif_completude);
  const rco=el('r-co');
  rco.textContent=fmt(d.completude);
  rco.style.color=colP(cp);
  el('r-co-s').textContent=cp+'% de l\'objectif '+d.objectif_completude+'\u202f€';

  const sources=[
    {ico:'💼',nom:'Salaire LGM',val:d.salaire,sub:'Mensuel net'},
    {ico:'👤',nom:'Beau-frère',val:d.beau_frere,sub:'Mensuel fixe'},
    {ico:'📚',nom:'Complétude',val:d.completude,sub:d.nb_cours+' cours effectués'},
  ];
  const rs=el('r-sources');
  rs.innerHTML='<div class="clbl" style="margin-bottom:.5rem">Sources de revenus</div>';
  sources.forEach(s=>{
    const w=d.total_revenus>0?Math.round((s.val/d.total_revenus)*100):0;
    rs.innerHTML+='<div class="row">'+
      '<div class="row-left">'+
        '<span class="row-ico">'+s.ico+'</span>'+
        '<div class="row-meta"><span class="row-name">'+s.nom+'</span><span class="row-sub">'+s.sub+'</span></div>'+
      '</div>'+
      '<div class="row-right">'+
        '<div class="row-val green">'+Math.round(s.val).toLocaleString('fr-FR')+'\u202f€</div>'+
        '<div class="row-pct">'+w+'%</div>'+
      '</div>'+
    '</div>'+
    '<div class="bar" style="margin:.25rem 0 .4rem"><div class="fill" style="width:'+w+'%;background:var(--g)"></div></div>';
  });

  const supp=d.revenus_supp||[];
  const rsupp=el('r-supp');
  if(supp.length>0){
    rsupp.style.display='block';
    const tot=supp.reduce((s,r)=>s+r.montant,0);
    rsupp.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">'+
      '<div class="clbl" style="margin:0">Rentrées supplémentaires</div>'+
      '<span style="font-family:var(--mono);font-size:.78rem;color:var(--g)">+'+Math.round(tot).toLocaleString('fr-FR')+'\u202f€</span>'+
    '</div>';
    supp.forEach(r=>{
      const date=r.created_at?new Date(r.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'—';
      rsupp.innerHTML+='<div class="row">'+
        '<span>'+( r.libelle||'Divers')+'</span>'+
        '<div style="text-align:right">'+
          '<span style="font-family:var(--mono);color:var(--g)">+'+r.montant.toFixed(2)+'\u202f€</span>'+
          '<br><span style="font-size:.58rem;color:var(--mu)">'+date+'</span>'+
        '</div>'+
      '</div>';
    });
  }else{rsupp.style.display='none'}
}

/* ── RENDER DÉPENSES ── */
function renderDepenses(d){
  const bl=el('b-ls');
  const isCurrent=d.mois_offset===0;
  const totalDep=d.total_dep||0;
  const totalMax=Object.values(d.budgets).reduce((s,b)=>s+b.max,0);
  const tPct=pct(totalDep,totalMax);
  const tCol=colP(tPct);

  bl.innerHTML='<div class="clbl" style="margin-bottom:.55rem">Dépenses variables'+(isCurrent?'':' <span class="badge b-hist">Archivé</span>')+'</div>';

  Object.entries(d.totaux).forEach(([k,v])=>{
    const b=d.budgets[k];
    const p=pct(v,b.max);
    const c=colP(p);
    const items=(d.detail||{})[k]||[];
    const hasItems=items.length>0;
    bl.innerHTML+=
      '<div class="ccat'+(hasItems?' ':'')+'\" id="cat-btn-'+k+'"'+(hasItems?' onclick="toggleCat(\''+k+'\')"':' style="cursor:default"')+'>'+
        '<span style="font-size:.75rem">'+b.label+'</span>'+
        '<div style="display:flex;align-items:center;gap:7px">'+
          '<div class="minibar"><div class="minifill" style="width:'+p+'%;background:'+c+'"></div></div>'+
          '<span style="color:'+c+';font-family:var(--mono);font-size:.7rem;min-width:80px;text-align:right">'+v.toFixed(0)+'€ / '+b.max+'€</span>'+
          (hasItems?'<span class="chev">›</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="cdet" id="cat-det-'+k+'">'+
        (items.length===0
          ?'<div style="color:var(--mu);font-size:.68rem;padding:3px 0">Aucune dépense</div>'
          :items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(dep=>{
              const date=dep.created_at?new Date(dep.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'—';
              return '<div class="dep-i"><span>'+(dep.libelle||'—')+'</span><div style="text-align:right"><span style="color:var(--tx)">'+dep.montant.toFixed(2)+'€</span><br><span style="font-size:.6rem;color:var(--mu)">'+date+'</span></div></div>';
            }).join('')
        )+
      '</div>';
  });

  bl.innerHTML+=
    '<div class="dep-total">'+
      '<div>'+
        '<div style="font-size:.6rem;color:var(--mu);text-transform:uppercase;letter-spacing:.06em">Total dépenses</div>'+
        '<div style="font-size:.58rem;color:var(--mu);margin-top:1px">Budget max : '+totalMax+'€</div>'+
      '</div>'+
      '<div style="text-align:right">'+
        '<div style="font-family:var(--mono);font-size:.95rem;color:'+tCol+'">'+totalDep.toFixed(0)+'€</div>'+
        '<div style="font-size:.58rem;color:var(--mu)">'+tPct+'%</div>'+
      '</div>'+
    '</div>';
}

/* ── RENDER PRÉLÈVEMENTS ── */
function renderPrelevements(d){
  const isCurrent=d.mois_offset===0;
  const pa=el('p-alert');
  const av=d.prelevements_a_venir||[];

  if(isCurrent&&av.length>0){
    const totS=av.reduce((s,p)=>s+p.montant,0);
    pa.style.display='block';
    pa.innerHTML='<div class="abox"><div class="abox-title">⚠️ Dans les 7 prochains jours — '+totS.toFixed(0)+'€</div>'+
      av.map(p=>{
        const q=p.dansJours===0?'Aujourd\'hui':p.dansJours===1?'Demain':'Dans '+p.dansJours+'j';
        return '<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:.71rem"><span style="color:var(--mu)">'+q+' · '+p.nom+'</span><span style="color:var(--amber);font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div>';
      }).join('')+'</div>';
  }else{pa.style.display='none'}

  const pl=el('p-ls');
  const now=new Date();
  const auj=now.getDate();

  pl.innerHTML='<div class="clbl" style="margin-bottom:.4rem">Prélèvements du mois'+(isCurrent?'':' <span class="badge b-hist">Archivé</span>')+'</div>'+
    '<div class="prel-row"><span style="color:var(--mu);font-size:.65rem">Restant ce mois</span><span style="color:var(--r);font-family:var(--mono);font-weight:700">-'+(d.total_prelevements_restants||0).toFixed(0)+'€</span></div>';

  if(!isCurrent){
    (d.prelevements_tous||[]).filter(p=>p.frequence!=='trimestriel').forEach(p=>{
      pl.innerHTML+='<div class="prel-row"><span>'+p.nom+'</span><div style="display:flex;gap:7px;align-items:center"><span style="color:var(--mu)">le '+(p.jour||'—')+'</span><span style="font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div></div>';
    });
    return;
  }

  const all=d.prelevements_tous||[];
  const restants=all.filter(p=>p.jour&&p.jour>=auj&&p.frequence!=='trimestriel');
  const passes=all.filter(p=>p.jour&&p.jour<auj&&p.frequence!=='trimestriel');
  const trim=all.filter(p=>p.frequence==='trimestriel');

  if(restants.length>0){
    pl.innerHTML+='<div class="stitle">À venir</div>';
    restants.forEach(p=>{
      const diff=p.jour-auj;
      let bc='pb-o',bt='le '+p.jour;
      if(diff===0){bc='pb-u';bt='Aujourd\'hui';}
      else if(diff<=2){bc='pb-u';bt='Dans '+diff+'j';}
      else if(diff<=5){bc='pb-s';bt='Dans '+diff+'j';}
      pl.innerHTML+='<div class="prel-row"><span>'+p.nom+'</span><div style="display:flex;gap:7px;align-items:center"><span class="pb '+bc+'">'+bt+'</span><span style="font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div></div>';
    });
  }
  if(passes.length>0){
    pl.innerHTML+='<div class="stitle">Déjà passés</div>';
    passes.forEach(p=>{
      pl.innerHTML+='<div class="prel-row past"><span>'+p.nom+'</span><span style="color:var(--mu);font-family:var(--mono)">'+p.montant.toFixed(2)+'€</span></div>';
    });
  }
  if(trim.length>0){
    pl.innerHTML+='<div class="stitle">Trimestriels</div>';
    trim.forEach(p=>{
      pl.innerHTML+='<div class="prel-row"><span>'+p.nom+'</span><span style="color:var(--mu);font-family:var(--mono)">'+p.montant.toFixed(2)+'€/trim</span></div>';
    });
  }
}

/* ── RENDER OBJECTIFS ── */
function renderObjectifs(d){
  const ol=el('o-ls');
  ol.innerHTML='<div class="clbl" style="margin-bottom:.55rem">Progression épargne</div>';
  (d.objectifs||[]).forEach(o=>{
    const p=pct(d.epargne_estimee,o.montant);
    const c=colP(p);
    const delta=Math.round(d.epargne_estimee-o.montant);
    ol.innerHTML+='<div class="obj">'+
      '<div class="obj-h">'+
        '<span>'+(delta>=0?'✅':'⚠️')+' '+o.label+'</span>'+
        '<span style="color:'+c+';font-family:var(--mono)">'+(delta>=0?'+':'')+delta.toLocaleString('fr-FR')+'€</span>'+
      '</div>'+
      '<div class="bar"><div class="fill" style="width:'+p+'%;background:'+c+'"></div></div>'+
      '<div style="display:flex;justify-content:space-between;font-size:.58rem;color:var(--mu);margin-top:3px">'+
        '<span>'+Math.round(d.epargne_estimee).toLocaleString('fr-FR')+'€</span>'+
        '<span>'+o.montant.toLocaleString('fr-FR')+'€</span>'+
      '</div>'+
    '</div>';
  });
}

/* ── MAIN ── */
async function charger(){
  try{
    const resp=await fetch('/api/dashboard?mois='+moisOffset);
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const d=await resp.json();

    /* header solde */
    const hs=el('h-solde');
    hs.textContent=(d.solde>=0?'+':'')+Math.round(d.solde).toLocaleString('fr-FR')+'\u202f€';
    hs.style.color=colS(d.solde);

    /* mois nav */
    const mc=(d.mois_disponibles||[]).find(m=>m.offset===moisOffset);
    const lbl=mc?(mc.label.charAt(0).toUpperCase()+mc.label.slice(1)):'—';
    el('mois-label').textContent=lbl;
    el('mois-badge').textContent=moisOffset===0?'Mois en cours':'Historique';
    el('btn-next').disabled=moisOffset>=0;

    renderApercu(d);
    renderCours(d);
    renderRevenus(d);
    renderDepenses(d);
    renderPrelevements(d);
    renderObjectifs(d);

    el('upd').textContent='Actualisé à '+new Date().toLocaleTimeString('fr-FR');
  }catch(e){
    el('upd').textContent='Erreur : '+e.message;
    console.error(e);
  }
}

charger();
setInterval(charger,30000);
</script>
</body>
</html>`);
});


app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

// ============================================================
// DÉMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  await chargerElevesCustom();
  demarrerScheduler();
});

module.exports = app;
