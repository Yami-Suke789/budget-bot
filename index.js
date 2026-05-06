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

// ============================================================
// DASHBOARD HTML  — remplace app.get('/dashboard', ...) existant
// ============================================================
// ============================================================
// DASHBOARD HTML  — remplace app.get('/dashboard', ...) existant
// ============================================================
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Comptable</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --navy:#0D1B2A;--navy2:#111a27;--navy3:#1a2535;
  --orange:#F26419;--amber:#FFAA44;
  --green:#4ade80;--red:#f87171;--blue:#60a5fa;--purple:#a78bfa;
  --border:#1e2d3f;--text:#e8ecf0;--muted:#556070;--mono:'DM Mono',monospace;
}
html{scroll-behavior:smooth}
body{
  font-family:'Sora',sans-serif;
  color:var(--text);
  min-height:100vh;
  padding:0 0 5rem;
  position:relative;
}
body::before{
  content:'';
  position:fixed;
  inset:0;
  background:url('data:image/jpeg;base64,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') center center / cover no-repeat;
  z-index:-2;
}
body::after{
  content:'';
  position:fixed;
  inset:0;
  background:linear-gradient(
    180deg,
    rgba(5,8,20,0.82) 0%,
    rgba(8,14,30,0.75) 30%,
    rgba(10,18,35,0.80) 70%,
    rgba(5,8,20,0.92) 100%
  );
  z-index:-1;
}

/* ── HEADER ──────────────────────────────── */
.header{
  background:rgba(5,12,25,0.75);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-bottom:1px solid var(--border);
  padding:1.1rem 1rem 0.8rem;
  position:sticky;top:0;z-index:50;
}
.header-top{display:flex;align-items:center;justify-content:space-between;max-width:440px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px}
.brand-icon{
  width:36px;height:36px;border-radius:10px;
  background:linear-gradient(135deg,var(--orange),var(--amber));
  display:flex;align-items:center;justify-content:center;
  font-size:1rem;box-shadow:0 4px 12px rgba(242,100,25,0.35);
}
.brand-name{font-size:1.05rem;font-weight:700;letter-spacing:-0.02em;color:#fff}
.brand-sub{font-size:0.58rem;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;margin-top:1px}
.header-solde{text-align:right}
.header-solde .lbl{font-size:0.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em}
.header-solde .val{font-size:1rem;font-weight:700;font-family:var(--mono)}

/* ── MOIS NAV ─────────────────────────────── */
.mois-nav{
  display:flex;align-items:center;justify-content:space-between;
  max-width:440px;margin:.55rem auto 0;
  background:rgba(255,255,255,0.04);border-radius:10px;padding:5px 10px;
}
.mois-btn{background:none;border:none;color:var(--muted);font-size:1rem;cursor:pointer;padding:2px 8px;border-radius:6px;transition:.2s}
.mois-btn:hover:not(:disabled){background:var(--border);color:var(--text)}
.mois-btn:disabled{opacity:.25;cursor:default}
.mois-label{font-size:0.78rem;font-weight:600;color:var(--text);text-align:center}
.mois-badge{font-size:0.58rem;color:var(--orange);text-align:center;letter-spacing:0.06em;text-transform:uppercase}

/* ── TABS ─────────────────────────────────── */
.tabs{
  display:flex;gap:3px;max-width:440px;margin:.6rem auto .4rem;
  padding:0 .75rem;
}
.tab{
  flex:1;text-align:center;padding:7px 2px;font-size:0.6rem;font-weight:600;
  border-radius:8px;cursor:pointer;color:rgba(255,255,255,0.45);
  border:1px solid transparent;transition:.2s;letter-spacing:0.03em;text-transform:uppercase;
}
.tab.active{background:rgba(255,255,255,0.1);color:var(--text);border-color:rgba(255,255,255,0.12)}

/* ── SECTIONS ─────────────────────────────── */
.section{display:none;max-width:440px;margin:0 auto;padding:0 .75rem}
.section.active{display:block}

/* ── CARDS ────────────────────────────────── */
.grid{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;margin-bottom:.55rem}
.card{background:rgba(10,18,32,0.72);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:14px;padding:.85rem;border:1px solid rgba(255,255,255,0.07)}
.card.full{grid-column:1/-1}
.card-label{font-size:0.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.35rem}
.card-value{font-size:1.45rem;font-weight:700;font-family:var(--mono);letter-spacing:-.02em}
.card-sub{font-size:0.62rem;color:var(--muted);margin-top:.25rem}
.bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin:.55rem 0 .25rem}
.fill{height:100%;border-radius:2px;transition:width .6s cubic-bezier(.4,0,.2,1)}

/* ── ROWS ─────────────────────────────────── */
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:0.75rem}
.row:last-child{border-bottom:none}
.row-label{color:var(--muted);font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;padding:6px 0 3px}

/* ── BADGES ───────────────────────────────── */
.badge{display:inline-block;font-size:.58rem;padding:2px 7px;border-radius:5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.badge-hist{background:#1a1a30;color:#6366f1;border:1px solid #2a2a50}
.badge-orange{background:rgba(242,100,25,.15);color:var(--orange)}

/* ── CHARGES SECTION ─────────────────────── */
.charges-grid{display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-top:.5rem}
.charge-item{background:rgba(255,255,255,0.04);border-radius:9px;padding:.5rem .65rem;border:1px solid rgba(255,255,255,0.07)}
.charge-name{font-size:.6rem;color:var(--muted)}
.charge-val{font-size:.82rem;font-weight:600;font-family:var(--mono);color:var(--text);margin-top:1px}
.charges-total{
  display:flex;justify-content:space-between;align-items:center;
  background:linear-gradient(135deg,rgba(242,100,25,.1),rgba(255,170,68,.06));
  border:1px solid rgba(242,100,25,.2);border-radius:10px;padding:.65rem .8rem;margin-top:.5rem;
}
.charges-total .lbl{font-size:.65rem;color:var(--orange);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.charges-total .val{font-size:1.05rem;font-weight:700;font-family:var(--mono);color:var(--orange)}

/* ── BUDGETS / DÉPENSES ───────────────────── */
.cat-btn{
  display:flex;justify-content:space-between;align-items:center;
  padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer;
  font-size:.76rem;transition:opacity .15s;
}
.cat-btn:last-of-type{border-bottom:none}
.cat-btn:hover{opacity:.75}
.cat-btn .chevron{color:var(--muted);font-size:.7rem;transition:transform .2s}
.cat-btn.open .chevron{transform:rotate(90deg)}
.cat-detail{display:none;background:rgba(4,8,18,0.85);border-radius:9px;padding:6px 10px;margin:3px 0 6px}
.cat-detail.open{display:block}
.dep-item{display:flex;justify-content:space-between;font-size:.68rem;padding:3px 0;border-bottom:1px solid var(--border);color:#8a9ab0}
.dep-item:last-child{border-bottom:none}
.dep-date{color:var(--muted);font-size:.62rem}

.dep-total-bar{
  display:flex;justify-content:space-between;align-items:center;
  background:var(--navy3);border:1px solid var(--border);border-radius:10px;
  padding:.65rem .8rem;margin-top:.6rem;
}
.dep-total-bar .lbl{font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.dep-total-bar .val{font-size:1rem;font-weight:700;font-family:var(--mono)}

/* ── PRÉLÈVEMENTS ─────────────────────────── */
.alert-box{
  background:#160e06;border:1px solid rgba(255,170,68,.25);border-radius:11px;
  padding:.75rem .85rem;margin-bottom:.55rem;font-size:.74rem;
}
.alert-title{color:var(--amber);font-weight:700;margin-bottom:.35rem;font-size:.78rem}
.prel-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:.74rem}
.prel-row:last-child{border-bottom:none}
.prel-row.past{opacity:.35}
.prel-badge{font-size:.58rem;padding:2px 7px;border-radius:5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.prel-urgent{background:#2d0a0a;color:#f87171}
.prel-soon{background:#2d1f04;color:var(--amber)}
.prel-ok{background:#0a1e0f;color:var(--green)}
.section-title{font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;padding:8px 0 3px}

/* ── OBJECTIFS ────────────────────────────── */
.obj{padding:9px 0;border-bottom:1px solid var(--border)}
.obj:last-child{border-bottom:none}
.obj-header{display:flex;justify-content:space-between;font-size:.77rem;margin-bottom:.35rem}

/* ── COURS ────────────────────────────────── */
.cours-row{display:flex;justify-content:space-between;font-size:.72rem;padding:4px 0;border-bottom:1px solid var(--border)}
.cours-row:last-child{border-bottom:none}

/* ── REFRESH ──────────────────────────────── */
.refresh{
  position:fixed;bottom:1.3rem;right:1.3rem;
  background:linear-gradient(135deg,var(--orange),var(--amber));
  color:#fff;border:none;border-radius:50%;width:46px;height:46px;
  font-size:1.15rem;cursor:pointer;
  box-shadow:0 4px 16px rgba(242,100,25,.4);
  transition:transform .2s;
}
.refresh:hover{transform:scale(1.08) rotate(30deg)}
.updated{text-align:center;font-size:.6rem;color:#2a3545;padding:.8rem 0 3rem}

/* ── MINI BAR ─────────────────────────────── */
.mini-bar{width:44px;height:3px;background:var(--border);border-radius:2px;overflow:hidden}
.mini-fill{height:100%;border-radius:2px}

.green{color:var(--green)}.amber{color:var(--amber)}.red{color:var(--red)}.orange{color:var(--orange)}
</style>
</head>
<body>

<!-- HEADER STICKY -->
<div class="header">
  <div class="header-top">
    <div class="brand">
      <div class="brand-icon">💼</div>
      <div>
        <div class="brand-name">Comptable</div>
        <div class="brand-sub">Tableau de bord financier</div>
      </div>
    </div>
    <div class="header-solde">
      <div class="lbl">Solde mois</div>
      <div class="val" id="h-solde">—</div>
    </div>
  </div>
  <div class="mois-nav">
    <button class="mois-btn" onclick="changerMois(-1)">◀</button>
    <div>
      <div class="mois-label" id="mois-label">—</div>
      <div class="mois-badge" id="mois-badge"></div>
    </div>
    <button class="mois-btn" id="btn-next" onclick="changerMois(1)">▶</button>
  </div>
</div>

<!-- TABS -->
<div class="tabs">
  <div class="tab active" onclick="setTab('apercu')">Aperçu</div>
  <div class="tab" onclick="setTab('completude')">Cours</div>
  <div class="tab" onclick="setTab('budgets')">Dépenses</div>
  <div class="tab" onclick="setTab('revenus')">Revenus</div>
  <div class="tab" onclick="setTab('prelevements')">Prélèv.</div>
  <div class="tab" onclick="setTab('objectifs')">Objectifs</div>
</div>

<!-- APERÇU -->
<div class="section active" id="tab-apercu">
  <div class="grid">

    <!-- Ligne 1 : Épargne -->
    <div class="card">
      <div class="card-label">Épargne actuelle</div>
      <div class="card-value green" id="a-ep">—</div>
    </div>
    <div class="card">
      <div class="card-label">Projection</div>
      <div class="card-value" id="a-pr">—</div>
    </div>

    <!-- Ligne 2 : Revenus / Charges+Dépenses -->
    <div class="card">
      <div class="card-label">Revenus</div>
      <div class="card-value green" id="a-rv">—</div>
      <div class="card-sub" id="a-rv-det">—</div>
    </div>
    <div class="card">
      <div class="card-label">Charges fixes</div>
      <div class="card-value orange" id="a-cf-total">—</div>
      <div class="card-sub red" id="a-dp-sub">—</div>
    </div>

    <!-- Ligne 3 : Solde + Complétude -->
    <div class="card">
      <div class="card-label">Solde estimé</div>
      <div class="card-value" id="a-sl">—</div>
      <div class="bar" style="margin-top:.5rem"><div class="fill" id="a-sl-b" style="width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-label">Complétude</div>
      <div class="card-value" id="a-co">—</div>
      <div class="bar" style="margin-top:.5rem"><div class="fill" id="a-co-b" style="width:0%"></div></div>
      <div class="card-sub" id="a-co-s">—</div>
    </div>

  </div>
</div>

<!-- COURS -->
<div class="section" id="tab-completude">
  <div class="grid">
    <div class="card"><div class="card-label">Cours effectués</div><div class="card-value green" id="c-nb">—</div></div>
    <div class="card"><div class="card-label">Cours manqués</div><div class="card-value red" id="c-mn">—</div><div class="card-sub" id="c-mv">—</div></div>
    <div class="card full"><div class="card-label" style="margin-bottom:.5rem">Détail cours</div><div id="c-ls">—</div></div>
    <div class="card full" id="c-mc" style="display:none"><div class="card-label" style="margin-bottom:.5rem">Cours manqués</div><div id="c-ml">—</div></div>
  </div>
</div>

<!-- DÉPENSES -->
<div class="section" id="tab-budgets">
  <div class="grid">
    <div class="card full" id="b-ls">Chargement...</div>
  </div>
</div>

<!-- PRÉLÈVEMENTS -->
<div class="section" id="tab-prelevements">
  <div class="grid">
    <div class="card full" id="p-alert" style="display:none"></div>
    <div class="card full" id="p-ls">Chargement...</div>
  </div>
</div>

<!-- REVENUS -->
<div class="section" id="tab-revenus">
  <div class="grid">
    <div class="card"><div class="card-label">Total revenus</div><div class="card-value green" id="r-total">—</div></div>
    <div class="card"><div class="card-label">Complétude</div><div class="card-value" id="r-completude">—</div><div class="card-sub" id="r-co-s">—</div></div>
    <div class="card full" id="r-sources">Chargement...</div>
    <div class="card full" id="r-supp" style="display:none"></div>
  </div>
</div>

<!-- OBJECTIFS -->
<div class="section" id="tab-objectifs">
  <div class="grid">
    <div class="card full" id="o-ls">Chargement...</div>
  </div>
</div>

<button class="refresh" onclick="charger()" title="Actualiser">↻</button>
<div class="updated" id="upd">—</div>

<script>
let moisOffset = 0;

/* ── HELPERS ──────────────────────────────── */
function fmt(n){return Math.round(n).toLocaleString('fr-FR')+' €'}
function fmt2(n){return n.toFixed(2).replace('.',',')+' €'}
function pct(v,m){return Math.min(100,Math.max(0,Math.round(v/m*100)))}
function col(p){return p>=100?'var(--red)':p>=80?'var(--amber)':'var(--green)'}
function cs(v){return v>=500?'var(--green)':v>=0?'var(--amber)':'var(--red)'}

function setTab(t){
  const tabs=['apercu','completude','budgets','revenus','prelevements','objectifs'];
  document.querySelectorAll('.tab').forEach((el,i)=>el.classList.toggle('active',tabs[i]===t));
  document.querySelectorAll('.section').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
}

function changerMois(dir){
  const n=moisOffset+dir;
  if(n>0)return;
  moisOffset=n;
  charger();
}

function toggleDetail(cat){
  document.getElementById('cat-btn-'+cat).classList.toggle('open');
  document.getElementById('cat-det-'+cat).classList.toggle('open');
}

/* ── CHARGES FIXES LISTE ─────────────────── */
const CHARGES_FIXES_LISTE = [
  {nom:'Loyer',montant:832.46},
  {nom:'Tontine 1',montant:500},
  {nom:'Tontine 2',montant:500},
  {nom:'Virement mère',montant:150},
  {nom:'Parking',montant:50},
  {nom:'Mutuelle',montant:57.03},
  {nom:'Énergie',montant:39.40},
  {nom:'Mobile',montant:17.99},
  {nom:'Box',montant:24},
  {nom:'Sport',montant:22.99},
  {nom:'Assurance hab.',montant:8.46},
  {nom:'Assurance auto',montant:64.24},
  {nom:'Sport (2)',montant:44},
  {nom:'Canal+',montant:13},
  {nom:'Cours arabe',montant:31},
  {nom:'Claude.ai',montant:21.60},
  {nom:'Helloasso',montant:12.55},
  {nom:'Stripe',montant:10},
  {nom:'Disney+',montant:6.99},
  {nom:'Crunchyroll',montant:8.99},
  {nom:'Banque',montant:18.30},
];

function renderChargesFixes(totalCharges){
  document.getElementById('a-cf-total').textContent=fmt2(totalCharges||2432.98);
}

/* ── BUDGETS ──────────────────────────────── */
function renderBudgets(d){
  const bl=document.getElementById('b-ls');
  const isCurrent=d.mois_offset===0;
  const totalDep=d.total_dep||0;
  const totalMax=Object.values(d.budgets).reduce((s,b)=>s+b.max,0);
  const totalPct=pct(totalDep,totalMax);
  const totalCol=col(totalPct);

  bl.innerHTML=\`<div class="card-label" style="margin-bottom:.6rem">Dépenses variables\${isCurrent?'':' <span class="badge badge-hist">Archivé</span>'}</div>\`;

  Object.entries(d.totaux).forEach(([k,v])=>{
    const b=d.budgets[k];
    const p=pct(v,b.max);
    const c=col(p);
    const items=(d.detail||{})[k]||[];
    const hasItems=items.length>0;
    bl.innerHTML+=\`
      <div class="cat-btn" id="cat-btn-\${k}" onclick="\${hasItems?'toggleDetail(\\'' + k + '\\')':''}" style="\${!hasItems?'cursor:default':''}">
        <span>\${b.label}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="mini-bar"><div class="mini-fill" style="width:\${p}%;background:\${c}"></div></div>
          <span style="color:\${c};min-width:82px;text-align:right;font-family:var(--mono);font-size:.7rem">\${v.toFixed(0)}€ / \${b.max}€</span>
          <span class="chevron">\${hasItems?'›':''}</span>
        </div>
      </div>
      <div class="cat-detail" id="cat-det-\${k}">
        \${items.length===0
          ? '<div style="color:var(--muted);font-size:.68rem;padding:4px 0">Aucune dépense</div>'
          : items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(dep=>{
              const date=new Date(dep.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
              return \`<div class="dep-item"><span>\${dep.libelle||'—'}</span><div style="text-align:right"><span style="color:var(--text)">\${dep.montant.toFixed(2)} €</span><br><span class="dep-date">\${date}</span></div></div>\`;
            }).join('')
        }
      </div>
    \`;
  });

  // ── TOTAL DÉPENSES (NOUVEAU) ──
  bl.innerHTML+=\`
    <div class="dep-total-bar">
      <div>
        <div class="lbl">Total dépenses variables</div>
        <div style="font-size:.62rem;color:var(--muted);margin-top:2px">Budget max cumulé : \${totalMax} €</div>
      </div>
      <div style="text-align:right">
        <div class="val" style="color:\${totalCol}">\${totalDep.toFixed(0)} €</div>
        <div style="font-size:.6rem;color:var(--muted)">(\${totalPct}%)</div>
      </div>
    </div>
  \`;
}

/* ── PRÉLÈVEMENTS ─────────────────────────── */
function renderPrelevements(d){
  const isCurrent=d.mois_offset===0;
  const pAlert=document.getElementById('p-alert');

  if(isCurrent && d.prelevements_a_venir && d.prelevements_a_venir.length>0){
    const totalSem=d.prelevements_a_venir.reduce((s,p)=>s+p.montant,0);
    pAlert.style.display='block';
    pAlert.innerHTML=\`<div class="alert-box">
      <div class="alert-title">⚠️ Dans les 7 prochains jours — \${totalSem.toFixed(0)} €</div>
      \${d.prelevements_a_venir.map(p=>{
        const q=p.dansJours===0?'Aujourd\\'hui':p.dansJours===1?'Demain':\`Dans \${p.dansJours}j\`;
        return \`<div style="display:flex;justify-content:space-between;margin-top:4px;font-size:.72rem"><span style="color:var(--muted)">\${q} · \${p.nom}</span><span style="color:var(--amber);font-family:var(--mono)">\${p.montant.toFixed(2)} €</span></div>\`;
      }).join('')}
    </div>\`;
  } else {
    pAlert.style.display='none';
  }

  const pl=document.getElementById('p-ls');
  const now=new Date();
  const aujourd=now.getDate();

  pl.innerHTML=\`<div class="card-label" style="margin-bottom:.4rem">Prélèvements du mois\${isCurrent?'':' <span class="badge badge-hist">Archivé</span>'}</div>\`;
  pl.innerHTML+=\`<div class="row"><span style="color:var(--muted);font-size:.65rem">Restant ce mois</span><span style="color:var(--red);font-weight:700;font-family:var(--mono)">-\${d.total_prelevements_restants?.toFixed(0)||'—'} €</span></div>\`;

  if(!isCurrent){
    (d.prelevements_tous||[]).filter(p=>p.frequence!=='trimestriel').forEach(p=>{
      pl.innerHTML+=\`<div class="prel-row"><span>\${p.nom}</span><div style="display:flex;gap:8px;align-items:center"><span style="color:var(--muted)">le \${p.jour||'—'}</span><span style="font-family:var(--mono)">\${p.montant.toFixed(2)} €</span></div></div>\`;
    });
    return;
  }

  const passes=(d.prelevements_tous||[]).filter(p=>p.jour&&p.jour<aujourd&&p.frequence!=='trimestriel');
  const restants=(d.prelevements_tous||[]).filter(p=>p.jour&&p.jour>=aujourd&&p.frequence!=='trimestriel');
  const trimest=(d.prelevements_tous||[]).filter(p=>p.frequence==='trimestriel');

  if(restants.length>0){
    pl.innerHTML+='<div class="section-title">À venir</div>';
    restants.forEach(p=>{
      const diff=p.jour-aujourd;
      let bc='prel-ok',bt=\`le \${p.jour}\`;
      if(diff===0){bc='prel-urgent';bt="Auj.";}
      else if(diff<=2){bc='prel-urgent';bt=\`Dans \${diff}j\`;}
      else if(diff<=5){bc='prel-soon';bt=\`Dans \${diff}j\`;}
      pl.innerHTML+=\`<div class="prel-row"><span>\${p.nom}</span><div style="display:flex;gap:8px;align-items:center"><span class="prel-badge \${bc}">\${bt}</span><span style="font-family:var(--mono)">\${p.montant.toFixed(2)} €</span></div></div>\`;
    });
  }
  if(passes.length>0){
    pl.innerHTML+='<div class="section-title">Déjà passés</div>';
    passes.forEach(p=>{
      pl.innerHTML+=\`<div class="prel-row past"><span>\${p.nom}</span><span style="color:var(--muted);font-family:var(--mono)">\${p.montant.toFixed(2)} €</span></div>\`;
    });
  }
  if(trimest.length>0){
    pl.innerHTML+='<div class="section-title">Trimestriels</div>';
    trimest.forEach(p=>{
      pl.innerHTML+=\`<div class="prel-row"><span>\${p.nom}</span><span style="color:var(--muted);font-family:var(--mono)">\${p.montant.toFixed(2)} €/trim</span></div>\`;
    });
  }
}

/* ── MAIN LOADER ──────────────────────────── */
/* ── REVENUS ──────────────────────────────── */
function renderRevenus(d){
  // Cards résumé
  document.getElementById('r-total').textContent=fmt(d.total_revenus);
  const cp=pct(d.completude,d.objectif_completude);
  const rco=document.getElementById('r-completude');
  rco.textContent=fmt(d.completude);
  rco.style.color=col(cp);
  document.getElementById('r-co-s').textContent=cp+'% de l\'objectif '+d.objectif_completude+' €';

  // Sources fixes
  const sources=[
    {icon:'💼',label:'Salaire LGM',val:d.salaire,sub:'Mensuel net'},
    {icon:'👤',label:'Beau-frère',val:d.beau_frere,sub:'Mensuel fixe'},
    {icon:'📚',label:'Complétude',val:d.completude,sub:d.nb_cours+' cours ce mois'},
  ];
  const rs=document.getElementById('r-sources');
  rs.innerHTML='<div class="card-label" style="margin-bottom:.6rem">Sources de revenus</div>';
  sources.forEach(s=>{
    const barW=Math.min(100,Math.round((s.val/d.total_revenus)*100));
    rs.innerHTML+=\`
      <div class="row">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1rem">\${s.icon}</span>
          <div>
            <div style="font-size:.75rem">\${s.label}</div>
            <div style="font-size:.6rem;color:var(--muted)">\${s.sub}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--mono);font-size:.82rem;color:var(--green)">\${Math.round(s.val).toLocaleString('fr-FR')} €</div>
          <div style="font-size:.58rem;color:var(--muted)">\${barW}%</div>
        </div>
      </div>
      <div class="bar" style="margin:.3rem 0 .5rem"><div class="fill" style="width:\${barW}%;background:var(--green)"></div></div>
    \`;
  });

  // Revenus supplémentaires
  const supp=d.revenus_supp||[];
  const rsupp=document.getElementById('r-supp');
  if(supp.length>0){
    rsupp.style.display='block';
    const totalSupp=supp.reduce((s,r)=>s+r.montant,0);
    rsupp.innerHTML=\`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
      <div class="card-label" style="margin:0">Rentrées supplémentaires</div>
      <span style="font-family:var(--mono);font-size:.8rem;color:var(--green)">+\${Math.round(totalSupp).toLocaleString('fr-FR')} €</span>
    </div>\`;
    supp.forEach(r=>{
      const date=new Date(r.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
      rsupp.innerHTML+=\`<div class="row"><span style="font-size:.75rem">\${r.libelle||'Divers'}</span><div style="text-align:right"><span style="font-family:var(--mono);color:var(--green)">+\${r.montant.toFixed(2)} €</span><br><span style="font-size:.6rem;color:var(--muted)">\${date}</span></div></div>\`;
    });
  } else {
    rsupp.style.display='none';
  }
}

async function charger(){
  try{
    const r=await fetch('/api/dashboard?mois='+moisOffset);
    const d=await r.json();

    // Header solde
    const hSolde=document.getElementById('h-solde');
    hSolde.textContent=(d.solde>=0?'+':'')+Math.round(d.solde).toLocaleString('fr-FR')+' €';
    hSolde.style.color=cs(d.solde);

    // Mois nav
    const mc=d.mois_disponibles?.find(m=>m.offset===moisOffset);
    const lbl=mc?(mc.label.charAt(0).toUpperCase()+mc.label.slice(1)):'—';
    document.getElementById('mois-label').textContent=lbl;
    document.getElementById('mois-badge').textContent=moisOffset===0?'Mois en cours':'Historique';
    const btnN=document.getElementById('btn-next');
    btnN.disabled=moisOffset>=0;

    // Aperçu
    document.getElementById('a-ep').textContent=fmt(d.epargne_base);
    const pr=document.getElementById('a-pr');
    pr.textContent=fmt(d.epargne_estimee);
    pr.style.color=d.epargne_estimee>=12500?'var(--green)':d.epargne_estimee>=10000?'var(--amber)':'var(--red)';

    // Revenus — total + sous-titre sources
    document.getElementById('a-rv').textContent=fmt(d.total_revenus);
    const srcParts=[];
    if(d.salaire) srcParts.push('LGM '+d.salaire+'€');
    if(d.completude) srcParts.push('Cours '+Math.round(d.completude)+'€');
    if((d.revenus_supp||[]).length) srcParts.push('+divers');
    document.getElementById('a-rv-det').textContent=srcParts.join(' · ');

    // Charges fixes + dépenses variables sous-titre
    renderChargesFixes(d.charges_fixes);
    document.getElementById('a-dp-sub').textContent='Variables : -'+Math.round(d.total_dep)+' €';

    // Solde
    const sl=document.getElementById('a-sl');
    sl.textContent=(d.solde>=0?'+':'')+fmt(d.solde);
    sl.style.color=cs(d.solde);
    document.getElementById('a-sl-b').style.cssText='width:'+Math.min(100,Math.max(0,(d.solde/1500)*100))+'%;background:'+cs(d.solde);

    // Complétude
    const cp=pct(d.completude,d.objectif_completude);
    const co=document.getElementById('a-co');
    co.textContent=fmt(d.completude);
    co.style.color=col(cp);
    document.getElementById('a-co-b').style.cssText='width:'+cp+'%;background:'+col(cp);
    document.getElementById('a-co-s').textContent=Math.round(d.completude)+' / '+d.objectif_completude+' € ('+cp+'%)';

    // Cours
    document.getElementById('c-nb').textContent=d.nb_cours;
    document.getElementById('c-mn').textContent=d.nb_cours_manques;
    document.getElementById('c-mv').textContent='-'+fmt(d.total_manque)+' manqués';
    document.getElementById('c-ls').innerHTML=d.cours.length===0
      ?'<div style="color:var(--muted);font-size:.72rem;padding:6px 0">Aucun cours ce mois</div>'
      :d.cours.map(c=>'<div class="cours-row"><span>'+c.eleve+(c.rattrapage?' <span style="color:var(--muted)">(rattrapage)</span>':'')+'</span><span class="green" style="font-family:var(--mono)">+'+c.gain.toFixed(2)+' €</span></div>').join('');
    if(d.nb_cours_manques>0){
      document.getElementById('c-mc').style.display='block';
      document.getElementById('c-ml').innerHTML=d.cours_manques.map(c=>'<div class="cours-row"><span>'+c.eleve+'</span><span class="red" style="font-family:var(--mono)">-'+c.gain_manque.toFixed(2)+' €</span></div>').join('');
    }

    // Revenus
    renderRevenus(d);

    // Budgets
    renderBudgets(d);

    // Prélèvements
    renderPrelevements(d);

    // Objectifs
    const ol=document.getElementById('o-ls');
    ol.innerHTML='<div class="card-label" style="margin-bottom:.6rem">Progression épargne</div>';
    d.objectifs.forEach(o=>{
      const p=pct(d.epargne_estimee,o.montant);
      const c=col(p);
      const delta=Math.round(d.epargne_estimee-o.montant);
      ol.innerHTML+=\`<div class="obj">
        <div class="obj-header">
          <span>\${delta>=0?'✅':'⚠️'} \${o.label}</span>
          <span style="color:\${c};font-family:var(--mono)">\${delta>=0?'+':''}\${delta.toLocaleString('fr-FR')} €</span>
        </div>
        <div class="bar"><div class="fill" style="width:\${p}%;background:\${c}"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:.6rem;color:var(--muted);margin-top:3px">
          <span>\${Math.round(d.epargne_estimee).toLocaleString('fr-FR')} €</span>
          <span>\${o.montant.toLocaleString('fr-FR')} €</span>
        </div>
      </div>\`;
    });

    document.getElementById('upd').textContent='Actualisé à '+new Date().toLocaleTimeString('fr-FR');
  }catch(e){
    document.getElementById('upd').textContent='Erreur de chargement';
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
