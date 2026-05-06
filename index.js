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
.header{text-align:center;padding:1.2rem 0 0.4rem}
.header h1{font-size:1.3rem;font-weight:700;color:#fff}
.mois-nav{display:flex;align-items:center;justify-content:center;gap:8px;margin:0.5rem 0 0.2rem}
.mois-nav button{background:#1a1a22;border:1px solid #2a2a36;color:#aaa;border-radius:8px;padding:5px 12px;font-size:0.75rem;cursor:pointer}
.mois-nav button:hover{background:#2a2a36;color:#fff}
.mois-label{font-size:0.85rem;color:#fff;font-weight:600;min-width:140px;text-align:center}
.mois-badge{font-size:0.62rem;color:#555;text-align:center;padding-bottom:0.3rem}
.tabs{display:flex;gap:4px;max-width:420px;margin:0.6rem auto;background:#1a1a22;border-radius:12px;padding:4px}
.tab{flex:1;text-align:center;padding:6px 2px;font-size:0.63rem;border-radius:8px;cursor:pointer;color:#555;transition:all 0.2s}
.tab.active{background:#2a2a36;color:#fff;font-weight:600}
.section{display:none;max-width:420px;margin:0 auto}
.section.active{display:block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0.6rem}
.card{background:#1a1a22;border-radius:14px;padding:0.9rem;border:1px solid #22222e}
.card.full{grid-column:1/-1}
.label{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.07em;color:#555;margin-bottom:5px}
.value{font-size:1.5rem;font-weight:700}
.sub{font-size:0.65rem;color:#555;margin-top:3px}
.green{color:#4ade80}.amber{color:#fbbf24}.red{color:#f87171}.blue{color:#60a5fa}
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
/* ZOOM DÉPENSES */
.cat-btn{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #22222e;cursor:pointer;font-size:0.78rem;transition:all 0.15s}
.cat-btn:last-child{border-bottom:none}
.cat-btn:hover{opacity:0.8}
.cat-btn .chevron{color:#555;font-size:0.7rem;transition:transform 0.2s}
.cat-btn.open .chevron{transform:rotate(90deg)}
.cat-detail{display:none;background:#111118;border-radius:8px;padding:6px 10px;margin:2px 0 6px}
.cat-detail.open{display:block}
.dep-item{display:flex;justify-content:space-between;font-size:0.7rem;padding:3px 0;border-bottom:1px solid #1a1a22;color:#aaa}
.dep-item:last-child{border-bottom:none}
.dep-date{color:#555;font-size:0.65rem}
/* PRÉLÈVEMENTS */
.prel-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #22222e;font-size:0.75rem}
.prel-row:last-child{border-bottom:none}
.prel-badge{font-size:0.6rem;padding:2px 6px;border-radius:6px;font-weight:600}
.prel-urgent{background:#3d1a1a;color:#f87171}
.prel-soon{background:#3d2d0a;color:#fbbf24}
.prel-ok{background:#1a2d1a;color:#4ade80}
.prel-past{opacity:0.4}
.prel-section-title{font-size:0.65rem;color:#555;text-transform:uppercase;letter-spacing:0.06em;margin:10px 0 4px}
.alert-box{background:#1d1209;border:1px solid #3d2d0a;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:0.75rem}
.alert-box .alert-title{color:#fbbf24;font-weight:600;margin-bottom:4px;font-size:0.8rem}
.refresh{position:fixed;bottom:1.2rem;right:1.2rem;background:#6366f1;color:#fff;border:none;border-radius:50%;width:44px;height:44px;font-size:1.1rem;cursor:pointer;box-shadow:0 3px 10px rgba(99,102,241,0.4)}
.updated{text-align:center;font-size:0.62rem;color:#333;padding:1rem 0 4rem}
.badge-hist{display:inline-block;font-size:0.6rem;background:#1a1a30;color:#6366f1;border:1px solid #2a2a50;border-radius:6px;padding:2px 7px;margin-left:6px}
</style>
</head>
<body>
<div class="header">
  <h1>🤖 L'Agent</h1>
  <div class="mois-nav">
    <button onclick="changerMois(-1)">◀</button>
    <div class="mois-label" id="mois-label">—</div>
    <button onclick="changerMois(1)" id="btn-next">▶</button>
  </div>
  <div class="mois-badge" id="mois-badge"></div>
</div>
<div class="tabs">
  <div class="tab active" onclick="setTab('apercu')">Aperçu</div>
  <div class="tab" onclick="setTab('completude')">Cours</div>
  <div class="tab" onclick="setTab('budgets')">Dépenses</div>
  <div class="tab" onclick="setTab('prelevements')">Prélèv.</div>
  <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
</div>

<div class="section active" id="tab-apercu">
  <div class="grid">
    <div class="card"><div class="label">Épargne actuelle</div><div class="value green" id="a-ep">—</div></div>
    <div class="card"><div class="label">Projection fin mois</div><div class="value" id="a-pr">—</div></div>
    <div class="card"><div class="label">Revenus ce mois</div><div class="value green" id="a-rv">—</div></div>
    <div class="card"><div class="label">Dépenses variables</div><div class="value red" id="a-dp">—</div></div>
    <div class="card full"><div class="label">Solde estimé</div><div class="value" id="a-sl">—</div><div class="bar"><div class="fill" id="a-sl-b" style="width:0%"></div></div><div class="sub" id="a-sl-d">—</div></div>
    <div class="card full"><div class="label">Complétude cours</div><div class="value" id="a-co">—</div><div class="bar"><div class="fill" id="a-co-b" style="width:0%"></div></div><div class="sub" id="a-co-s">—</div></div>
    <div class="card full" id="a-rv-det" style="display:none"><div class="label">Revenus supplémentaires</div><div id="a-rv-ls">—</div></div>
  </div>
</div>

<div class="section" id="tab-completude">
  <div class="grid">
    <div class="card"><div class="label">Cours effectués</div><div class="value green" id="c-nb">—</div></div>
    <div class="card"><div class="label">Cours manqués</div><div class="value red" id="c-mn">—</div><div class="sub" id="c-mv">—</div></div>
    <div class="card full"><div class="label" style="margin-bottom:10px">Détail cours</div><div id="c-ls">—</div></div>
    <div class="card full" id="c-mc" style="display:none"><div class="label" style="margin-bottom:10px">Cours manqués</div><div id="c-ml">—</div></div>
  </div>
</div>

<div class="section" id="tab-budgets">
  <div class="grid">
    <div class="card full" id="b-ls">Chargement...</div>
  </div>
</div>

<div class="section" id="tab-prelevements">
  <div class="grid">
    <div class="card full" id="p-alert" style="display:none"></div>
    <div class="card full" id="p-ls">Chargement...</div>
  </div>
</div>

<div class="section" id="tab-objectifs">
  <div class="grid">
    <div class="card full" id="o-ls">Chargement...</div>
  </div>
</div>

<button class="refresh" onclick="charger()">↻</button>
<div class="updated" id="upd">—</div>

<script>
let moisOffset = 0;
let donneesCourantes = null;

function setTab(t){
  const tabs = ['apercu','completude','budgets','prelevements','objectifs'];
  document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',tabs[i]===t));
  document.querySelectorAll('.section').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
}

function changerMois(dir) {
  const newOffset = moisOffset + dir;
  if (newOffset > 0) return;
  moisOffset = newOffset;
  charger();
}

function fmt(n){return Math.round(n).toLocaleString('fr-FR')+' €'}
function fmt2(n){return n.toFixed(2).replace('.',',')+' €'}
function pct(v,m){return Math.min(100,Math.round(v/m*100))}
function col(p){return p>=100?'#f87171':p>=80?'#fbbf24':'#4ade80'}
function cs(v){return v>=500?'#4ade80':v>=0?'#fbbf24':'#f87171'}

function toggleDetail(cat) {
  const btn = document.getElementById('cat-btn-'+cat);
  const det = document.getElementById('cat-det-'+cat);
  btn.classList.toggle('open');
  det.classList.toggle('open');
}

function renderBudgets(d) {
  const bl = document.getElementById('b-ls');
  const isCurrent = d.mois_offset === 0;
  bl.innerHTML = '<div class="label" style="margin-bottom:10px">Dépenses variables' + (isCurrent ? '' : ' <span class="badge-hist">Archivé</span>') + '</div>';
  Object.entries(d.totaux).forEach(([k,v]) => {
    const b = d.budgets[k];
    const p = pct(v,b.max);
    const c = col(p);
    const items = d.detail[k] || [];
    const hasItems = items.length > 0;
    bl.innerHTML += \`
      <div class="cat-btn" id="cat-btn-\${k}" onclick="\${hasItems?'toggleDetail(\\'' + k + '\\')':''}" style="\${!hasItems?'cursor:default':''}">
        <span>\${b.label}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="mini-bar"><div class="mini-fill" style="width:\${p}%;background:\${c}"></div></div>
          <span style="color:\${c};min-width:80px;text-align:right">\${v.toFixed(0)}€ / \${b.max}€</span>
          <span class="chevron">\${hasItems ? '›' : ''}</span>
        </div>
      </div>
      <div class="cat-detail" id="cat-det-\${k}">
        \${items.length === 0 ? '<div style="color:#555;font-size:0.7rem;padding:4px 0">Aucune dépense</div>' :
          items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(dep => {
            const date = new Date(dep.created_at).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'});
            return \`<div class="dep-item"><span>\${dep.libelle||'—'}</span><div style="text-align:right"><span style="color:#e8e8f0">\${dep.montant.toFixed(2)}€</span><br><span class="dep-date">\${date}</span></div></div>\`;
          }).join('')
        }
      </div>
    \`;
  });
}

function renderPrelevements(d) {
  const isCurrent = d.mois_offset === 0;
  const pAlert = document.getElementById('p-alert');

  if (isCurrent && d.prelevements_a_venir && d.prelevements_a_venir.length > 0) {
    const totalSem = d.prelevements_a_venir.reduce((s,p)=>s+p.montant,0);
    pAlert.style.display = 'block';
    pAlert.innerHTML = \`<div class="alert-box">
      <div class="alert-title">⚠️ À venir dans 7 jours — \${totalSem.toFixed(0)}€</div>
      \${d.prelevements_a_venir.map(p=>{
        const q = p.dansJours===0?'Aujourd\\'hui':p.dansJours===1?'Demain':\`Dans \${p.dansJours}j\`;
        return \`<div style="display:flex;justify-content:space-between;margin-top:3px"><span>\${q} · \${p.nom}</span><span style="color:#fbbf24">\${p.montant.toFixed(2)}€</span></div>\`;
      }).join('')}
    </div>\`;
  } else {
    pAlert.style.display = 'none';
  }

  const pl = document.getElementById('p-ls');
  const now = new Date();
  const aujourd = now.getDate();

  if (!isCurrent) {
    pl.innerHTML = '<div class="label" style="margin-bottom:10px">Charges fixes <span class="badge-hist">Archivé</span></div>';
    pl.innerHTML += '<div style="font-size:0.75rem;color:#555;padding:8px 0">Total mensuel: <span style="color:#e8e8f0">' + fmt(d.charges_fixes) + '</span></div>';
    d.prelevements_tous.filter(p=>p.frequence!=='trimestriel').forEach(p=>{
      pl.innerHTML += \`<div class="prel-row"><span>\${p.nom}</span><div style="display:flex;gap:8px;align-items:center"><span style="color:#555">le \${p.jour||'—'}</span><span>\${p.montant.toFixed(2)}€</span></div></div>\`;
    });
    return;
  }

  pl.innerHTML = '<div class="label" style="margin-bottom:4px">Prélèvements du mois</div>';
  pl.innerHTML += \`<div class="row" style="padding-bottom:8px"><span style="color:#555">Restant ce mois</span><span style="color:#f87171;font-weight:600">-\${d.total_prelevements_restants.toFixed(0)}€</span></div>\`;

  const passes = d.prelevements_tous.filter(p=>p.jour && p.jour < aujourd && p.frequence !== 'trimestriel');
  const restants = d.prelevements_tous.filter(p=>p.jour && p.jour >= aujourd && p.frequence !== 'trimestriel');
  const trimest = d.prelevements_tous.filter(p=>p.frequence === 'trimestriel');

  if (restants.length > 0) {
    pl.innerHTML += '<div class="prel-section-title">À venir</div>';
    restants.forEach(p => {
      const diff = p.jour - aujourd;
      let badgeClass = 'prel-ok', badgeText = \`le \${p.jour}\`;
      if (diff === 0) { badgeClass = 'prel-urgent'; badgeText = "Aujourd'hui"; }
      else if (diff <= 2) { badgeClass = 'prel-urgent'; badgeText = \`Dans \${diff}j\`; }
      else if (diff <= 5) { badgeClass = 'prel-soon'; badgeText = \`Dans \${diff}j\`; }
      pl.innerHTML += \`<div class="prel-row"><span>\${p.nom}</span><div style="display:flex;gap:8px;align-items:center"><span class="prel-badge \${badgeClass}">\${badgeText}</span><span>\${p.montant.toFixed(2)}€</span></div></div>\`;
    });
  }

  if (passes.length > 0) {
    pl.innerHTML += '<div class="prel-section-title">Déjà passés</div>';
    passes.forEach(p => {
      pl.innerHTML += \`<div class="prel-row prel-past"><span>\${p.nom}</span><div style="display:flex;gap:8px;align-items:center"><span style="color:#555">le \${p.jour}</span><span style="color:#555">\${p.montant.toFixed(2)}€</span></div></div>\`;
    });
  }

  if (trimest.length > 0) {
    pl.innerHTML += '<div class="prel-section-title">Trimestriels</div>';
    trimest.forEach(p => {
      pl.innerHTML += \`<div class="prel-row"><span>\${p.nom}</span><span style="color:#aaa">\${p.montant.toFixed(2)}€/trim</span></div>\`;
    });
  }
}

async function charger() {
  try {
    const r = await fetch('/api/dashboard?mois=' + moisOffset);
    const d = await r.json();
    donneesCourantes = d;

    // Navigation mois
    const moisCap = d.mois_disponibles?.find(m => m.offset === moisOffset);
    const label = moisCap ? (moisCap.label.charAt(0).toUpperCase() + moisCap.label.slice(1)) : '—';
    document.getElementById('mois-label').textContent = label;
    document.getElementById('mois-badge').textContent = moisOffset === 0 ? 'Mois en cours' : 'Historique';
    document.getElementById('btn-next').style.opacity = moisOffset >= 0 ? '0.3' : '1';
    document.getElementById('btn-next').disabled = moisOffset >= 0;

    // Aperçu
    document.getElementById('a-ep').textContent = fmt(d.epargne_base);
    const pr = document.getElementById('a-pr');
    pr.textContent = fmt(d.epargne_estimee);
    pr.className = 'value ' + (d.epargne_estimee >= 12500 ? 'green' : d.epargne_estimee >= 10000 ? 'amber' : 'red');
    document.getElementById('a-rv').textContent = fmt(d.total_revenus);
    document.getElementById('a-dp').textContent = '-' + fmt(d.total_dep);

    const sl = document.getElementById('a-sl');
    sl.textContent = (d.solde >= 0 ? '+' : '') + fmt(d.solde);
    sl.style.color = cs(d.solde);
    const sp = Math.min(100, Math.max(0, (d.solde / 1500) * 100));
    document.getElementById('a-sl-b').style.cssText = 'width:' + sp + '%;background:' + cs(d.solde);
    document.getElementById('a-sl-d').textContent = fmt(d.total_revenus) + ' - ' + fmt(d.charges_fixes) + ' - ' + fmt(d.total_dep);

    const cp = pct(d.completude, d.objectif_completude);
    const co = document.getElementById('a-co');
    co.textContent = fmt(d.completude);
    co.style.color = col(cp);
    document.getElementById('a-co-b').style.cssText = 'width:' + cp + '%;background:' + col(cp);
    document.getElementById('a-co-s').textContent = fmt(d.completude) + ' / ' + fmt(d.objectif_completude) + ' (' + cp + '%)';

    if (d.revenus_supp && d.revenus_supp.length > 0) {
      document.getElementById('a-rv-det').style.display = 'block';
      document.getElementById('a-rv-ls').innerHTML = d.revenus_supp.map(r =>
        '<div class="cours-row"><span>' + r.libelle + '</span><span class="green">+' + r.montant.toFixed(2) + ' €</span></div>'
      ).join('');
    }

    // Cours
    document.getElementById('c-nb').textContent = d.nb_cours;
    document.getElementById('c-mn').textContent = d.nb_cours_manques;
    document.getElementById('c-mv').textContent = '-' + fmt(d.total_manque) + ' manqués';
    document.getElementById('c-ls').innerHTML = d.cours.length === 0
      ? '<div style="color:#555;font-size:0.72rem;padding:6px 0">Aucun cours ce mois</div>'
      : d.cours.map(c => '<div class="cours-row"><span>' + c.eleve + (c.rattrapage ? ' <span style="color:#555">(rattrapage)</span>' : '') + '</span><span class="green">+' + c.gain.toFixed(2) + ' €</span></div>').join('');
    if (d.nb_cours_manques > 0) {
      document.getElementById('c-mc').style.display = 'block';
      document.getElementById('c-ml').innerHTML = d.cours_manques.map(c => '<div class="cours-row"><span>' + c.eleve + '</span><span class="red">-' + c.gain_manque.toFixed(2) + ' €</span></div>').join('');
    }

    // Budgets avec zoom
    renderBudgets(d);

    // Prélèvements
    renderPrelevements(d);

    // Objectifs
    const ol = document.getElementById('o-ls');
    ol.innerHTML = '<div class="label" style="margin-bottom:10px">Progression épargne</div>';
    d.objectifs.forEach(o => {
      const p = pct(d.epargne_estimee, o.montant);
      const c = col(p);
      const delta = Math.round(d.epargne_estimee - o.montant);
      ol.innerHTML += '<div class="obj"><div class="obj-header"><span>' + (delta >= 0 ? '✅' : '⚠️') + ' ' + o.label + '</span><span style="color:' + c + '">' + (delta >= 0 ? '+' : '') + delta.toLocaleString() + ' €</span></div><div class="bar"><div class="fill" style="width:' + p + '%;background:' + c + '"></div></div><div style="display:flex;justify-content:space-between;font-size:0.62rem;color:#555;margin-top:3px"><span>' + Math.round(d.epargne_estimee).toLocaleString() + ' €</span><span>' + o.montant.toLocaleString() + ' €</span></div></div>';
    });

    document.getElementById('upd').textContent = 'Actualisé à ' + new Date().toLocaleTimeString('fr-FR');
  } catch(e) {
    document.getElementById('upd').textContent = 'Erreur de chargement';
  }
}

charger();
setInterval(charger, 30000);
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
