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
// CONSTANTES (modifiables dynamiquement)
// ============================================================
let SALAIRE_LGM_DEFAULT = 2500;
let BEAU_FRERE = 320;
let OBJECTIF_COMPLETUDE = 1500;
const EPARGNE_DEPART = 6000;

// Seuils d'alerte (modifiables)
const SEUIL_ALERTE_TOTAL = 3400;   // fixes + variables
const SEUIL_ALERTE_VARIABLE = 1000; // variables seules

let CHARGES_FIXES = {
  'Loyer': 832.46, 'Tontine 1': 500, 'Tontine 2': 500,
  'Virement mère': 150, 'Place parking': 50, 'Malakoff mutuelle': 57.03,
  'ENI énergie': 39.40, 'Bouygues mobile': 17.99, 'Bouygues box': 24,
  'Basic Fit': 22.99, 'Assurance habitation': 8.46, 'Assurance auto': 64.24,
  'Salle sport femme': 44, 'Canal+ frère': 13, 'Cours arabe': 31,
  'Claude.ai': 21.60, 'Helloasso': 12.55, 'Stripe asso': 10,
  'Disney+': 6.99, 'Crunchyroll': 8.99, 'Cotisation bancaire': 18.30,
};

// Prélèvements avec flag suspendu
let PRELEVEMENTS_DATES = [
  { nom: 'Loyer',               montant: 832.46, jour: 1,    suspendu: false },
  { nom: 'Tontine 1',           montant: 500.00, jour: 1,    suspendu: false },
  { nom: 'Helloasso',           montant: 12.55,  jour: 1,    suspendu: false },
  { nom: 'Place parking',       montant: 50.00,  jour: 1,    suspendu: false },
  { nom: 'Salle sport femme',   montant: 44.00,  jour: 1,    suspendu: false },
  { nom: 'Cours arabe',         montant: 31.00,  jour: 3,    suspendu: false },
  { nom: 'Virement mère',       montant: 150.00, jour: 5,    suspendu: false },
  { nom: 'Assurance habitation',montant: 8.46,   jour: 7,    suspendu: false },
  { nom: 'ENI énergie',         montant: 39.40,  jour: 7,    suspendu: false },
  { nom: 'Basic Fit',           montant: 22.99,  jour: 7,    suspendu: false },
  { nom: 'Malakoff mutuelle',   montant: 57.03,  jour: 9,    suspendu: false },
  { nom: 'Crunchyroll',         montant: 8.99,   jour: 13,   suspendu: false },
  { nom: 'Stripe asso',         montant: 10.00,  jour: 13,   suspendu: false },
  { nom: 'Tontine 2',           montant: 500.00, jour: 15,   suspendu: false },
  { nom: 'Bouygues mobile',     montant: 17.99,  jour: 17,   suspendu: false },
  { nom: 'Assurance auto',      montant: 64.24,  jour: 20,   suspendu: false },
  { nom: 'Disney+',             montant: 6.99,   jour: 22,   suspendu: false },
  { nom: 'Canal+ frère',        montant: 13.00,  jour: 24,   suspendu: false },
  { nom: 'Claude.ai',           montant: 21.60,  jour: 27,   suspendu: false },
  { nom: 'Bouygues box',        montant: 24.00,  jour: 30,   suspendu: false },
  { nom: 'Cotisation bancaire', montant: 18.30,  jour: null, suspendu: false, frequence: 'trimestriel' },
];

function getTotalChargesFixes() {
  return PRELEVEMENTS_DATES
    .filter(p => !p.suspendu)
    .reduce((a, p) => a + p.montant, 0);
}

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
  { label: 'Fin juin 2026', montant: 10000 },
  { label: 'Fin août 2026', montant: 13000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

let ELEVES = {};

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

const sessions = {};
const sessionsFiches = {};
const sessionsAnnuler = {};
const sessionsModifier = {};
const sessionsAjoutEleve = {};
const sessionsRevenu = {};
const sessionsEpargne = {};
// Sessions pour modifications avancées
const sessionsModifConfig = {};  // modifier salaire/beau-frère/objectif
const sessionsModifPrel = {};    // modifier un prélèvement
const sessionsInvest = {};       // saisie investissement

// ============================================================
// PERSISTANCE CONFIG SUPABASE
// ============================================================
async function chargerConfig() {
  try {
    const { data, error } = await supabase.from('config').select('cle, valeur');
    if (error) { console.error('chargerConfig error:', error.message); return; }
    if (!data || data.length === 0) return;
    data.forEach(row => {
      if (row.cle === 'salaire_lgm')          SALAIRE_LGM_DEFAULT  = row.valeur;
      if (row.cle === 'beau_frere')            BEAU_FRERE           = row.valeur;
      if (row.cle === 'objectif_completude')   OBJECTIF_COMPLETUDE  = row.valeur;
    });
    // Sync prélèvements depuis config si présents
    data.forEach(row => {
      if (row.cle.startsWith('prel_')) {
        const nomPrel = row.cle.replace('prel_montant_', '');
        const p = PRELEVEMENTS_DATES.find(p => p.nom === nomPrel);
        if (p) { p.montant = row.valeur; CHARGES_FIXES[p.nom] = row.valeur; }
      }
      if (row.cle.startsWith('prel_suspendu_')) {
        const nomPrel = row.cle.replace('prel_suspendu_', '');
        const p = PRELEVEMENTS_DATES.find(p => p.nom === nomPrel);
        if (p) { p.suspendu = row.valeur === 1; }
      }
      if (row.cle.startsWith('prel_jour_')) {
        const nomPrel = row.cle.replace('prel_jour_', '');
        const p = PRELEVEMENTS_DATES.find(p => p.nom === nomPrel);
        if (p) p.jour = row.valeur;
      }
      if (row.cle.startsWith('budget_')) {
        const cat = row.cle.replace('budget_', '');
        if (BUDGETS[cat]) BUDGETS[cat].max = row.valeur;
      }
    });
    console.log('✅ Config chargée depuis Supabase');
  } catch (err) {
    console.error('chargerConfig exception:', err.message);
  }
}

async function sauvegarderConfig(cle, valeur) {
  const { error } = await supabase.from('config')
    .upsert({ cle, valeur, updated_at: new Date().toISOString() }, { onConflict: 'cle' });
  if (error) console.error(`sauvegarderConfig(${cle}) error:`, error.message);
}

// ============================================================
// INVESTISSEMENTS
// ============================================================
async function saveInvestissement(chatId, ticker, montant, prix_unitaire) {
  const nb_parts = montant / prix_unitaire;
  const { error } = await supabase.from('investissements').insert({
    ticker, montant, prix_unitaire, nb_parts,
    chat_id: String(chatId),
  });
  if (error) console.error('saveInvestissement error:', error.message);
}

async function getInvestissements() {
  const { data, error } = await supabase
    .from('investissements')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('getInvestissements error:', error.message); return []; }
  return data || [];
}

async function getPrixActuelETF(ticker) {
  try {
    // Yahoo Finance — pas de clé API nécessaire
    const symbol = ticker === 'ISWD' ? 'ISWD.L' : ticker === 'SGLD' ? 'SGLD.L' : ticker;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const prix = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return prix ? parseFloat(prix) : null;
  } catch (err) {
    console.error('getPrixActuelETF error:', err.message);
    return null;
  }
}

async function afficherPortefeuille(chatId) {
  const investissements = await getInvestissements();
  if (investissements.length === 0) {
    await send(chatId,
      `📈 *Portefeuille vide*\n\nTu n'as pas encore enregistré d'investissement.\n\n` +
      `Utilise /investir pour ajouter un achat.`
    );
    return;
  }

  // Grouper par ticker
  const parTicker = {};
  investissements.forEach(inv => {
    if (!parTicker[inv.ticker]) parTicker[inv.ticker] = { montant_investi: 0, nb_parts: 0, achats: [] };
    parTicker[inv.ticker].montant_investi += inv.montant;
    parTicker[inv.ticker].nb_parts       += inv.nb_parts;
    parTicker[inv.ticker].achats.push(inv);
  });

  let msg = `📈 *Portefeuille investissements*\n\n`;
  let totalInvesti = 0;
  let totalActuel  = 0;

  for (const [ticker, data] of Object.entries(parTicker)) {
    const prixActuel = await getPrixActuelETF(ticker);
    const prixMoyen  = data.montant_investi / data.nb_parts;
    totalInvesti    += data.montant_investi;

    if (prixActuel) {
      const valeurActuelle = prixActuel * data.nb_parts;
      const plusvalue      = valeurActuelle - data.montant_investi;
      const pct            = (plusvalue / data.montant_investi * 100);
      totalActuel         += valeurActuelle;
      const emoji = plusvalue >= 0 ? '🟢' : '🔴';
      msg += `*${ticker}*\n`;
      msg += `${emoji} Valeur actuelle: *${valeurActuelle.toFixed(0)}€*\n`;
      msg += `💶 Investi: ${data.montant_investi.toFixed(0)}€ | Parts: ${data.nb_parts.toFixed(4)}\n`;
      msg += `📊 Prix moyen: ${prixMoyen.toFixed(2)} | Actuel: ${prixActuel.toFixed(2)}\n`;
      msg += `${plusvalue >= 0 ? '📈' : '📉'} +/-value: *${plusvalue >= 0 ? '+' : ''}${plusvalue.toFixed(0)}€* (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)\n\n`;
    } else {
      totalActuel += data.montant_investi;
      msg += `*${ticker}*\n`;
      msg += `💶 Investi: ${data.montant_investi.toFixed(0)}€ | Parts: ${data.nb_parts.toFixed(4)}\n`;
      msg += `⚠️ Cours non disponible actuellement\n\n`;
    }
  }

  if (Object.keys(parTicker).length > 1) {
    const plusvalue = totalActuel - totalInvesti;
    const pct = (plusvalue / totalInvesti * 100);
    msg += `━━━━━━━━━━━━━━\n`;
    msg += `💼 *Total investi: ${totalInvesti.toFixed(0)}€*\n`;
    msg += `💎 *Valeur actuelle: ${totalActuel.toFixed(0)}€*\n`;
    msg += `${plusvalue >= 0 ? '📈' : '📉'} *+/-value: ${plusvalue >= 0 ? '+' : ''}${plusvalue.toFixed(0)}€ (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)*\n`;
  }

  const prochainDCA = new Date();
  prochainDCA.setMonth(prochainDCA.getMonth() + 1);
  prochainDCA.setDate(1);
  msg += `\n📅 Prochain DCA: *${prochainDCA.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })}*`;

  await send(chatId, msg);
}

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
function _minuitParisEnUTC(annee, mois) {
  const dateParis = new Date(`${annee}-${String(mois).padStart(2, '0')}-01T00:00:00`);
  const utcMs = new Date(dateParis.toLocaleString('en-US', { timeZone: 'UTC' }));
  const parisMs = new Date(dateParis.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return new Date(dateParis.getTime() + (utcMs - parisMs)).toISOString();
}

function getDebutMois(moisOffset = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const d = new Date(now.getFullYear(), now.getMonth() + moisOffset, 1);
  return _minuitParisEnUTC(d.getFullYear(), d.getMonth() + 1);
}

function getFinMois(moisOffset = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const d = new Date(now.getFullYear(), now.getMonth() + moisOffset + 1, 1);
  return _minuitParisEnUTC(d.getFullYear(), d.getMonth() + 1);
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
    supabase.from('epargne').select('*').lt('created_at', fin).order('created_at', { ascending: false }).limit(1),
  ]);

  const depenses = d1.data || [];
  const cours = d2.data || [];
  const coursManques = d3.data || [];
  const revenus = d4.data || [];
  const salaire = d5.data?.length > 0 ? d5.data[0].montant : SALAIRE_LGM_DEFAULT;
  const epargneBase = d6.data?.length > 0 ? d6.data[0].montant : EPARGNE_DEPART;

  const TOTAL_CHARGES_FIXES = getTotalChargesFixes();

  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });

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
    epargneEstimee, salaire, epargneBase, moisOffset,
    chargesFixes: TOTAL_CHARGES_FIXES
  };
}

// ============================================================
// ALERTES DÉPASSEMENT
// ============================================================
async function verifierAlertesBudget(chatId, totalDep) {
  const TOTAL_CHARGES_FIXES = getTotalChargesFixes();
  const totalGlobal = TOTAL_CHARGES_FIXES + totalDep;

  if (totalGlobal > SEUIL_ALERTE_TOTAL) {
    await send(chatId,
      `🚨 *ALERTE — Seuil global dépassé !*\n\n` +
      `Fixes: *${TOTAL_CHARGES_FIXES.toFixed(0)}€* + Variables: *${totalDep.toFixed(0)}€* = *${totalGlobal.toFixed(0)}€*\n` +
      `⚠️ Seuil: *${SEUIL_ALERTE_TOTAL}€* — Dépassement: *+${(totalGlobal - SEUIL_ALERTE_TOTAL).toFixed(0)}€*`
    );
  } else if (totalDep > SEUIL_ALERTE_VARIABLE) {
    await send(chatId,
      `⚠️ *ALERTE — Dépenses variables dépassées !*\n\n` +
      `Variables ce mois: *${totalDep.toFixed(0)}€* > seuil *${SEUIL_ALERTE_VARIABLE}€*\n` +
      `Dépassement: *+${(totalDep - SEUIL_ALERTE_VARIABLE).toFixed(0)}€*`
    );
  }
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

async function saveCoursDeplace(chatId, eleve) {
  // On enregistre comme cours manqué avec flag déplacé (libellé spécifique)
  const gain_manque = ELEVES[eleve].taux * ELEVES[eleve].duree;
  const { error } = await supabase.from('cours_manques').insert({ eleve, gain_manque, chat_id: String(chatId), libelle: 'déplacé' });
  if (error) console.error('saveCoursDeplace error:', error);
  return gain_manque;
}

async function saveDepense(chatId, montant, categorie, libelle) {
  const { error } = await supabase.from('depenses').insert({ montant, categorie, libelle, chat_id: String(chatId) });
  if (error) console.error('saveDepense error:', error);
  // Vérifier alertes après chaque dépense
  const d = await getData();
  await verifierAlertesBudget(chatId, d.totalDep);
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
// SAVE ÉLÈVE CUSTOM
// ============================================================
async function saveEleveCustom(chatId, eleveData) {
  const payload = {
    nom: eleveData.nom, niveau: eleveData.niveau, taux: eleveData.taux, duree: eleveData.duree,
    tda: eleveData.tda || false, fiche_hebdo: eleveData.ficheHebdo || false,
    question_2h: eleveData.question2h !== false, fiche: eleveData.fiche !== false,
    jour: eleveData.jour, heure: eleveData.heure, minute: eleveData.minute || 0,
    une_semaine_sur_deux: eleveData.uneSemaineSurDeux || false, actif: true, chat_id: String(chatId),
  };
  const { data, error } = await supabase.from('eleves_custom').insert(payload).select();
  if (error) { console.error('saveEleveCustom ERROR:', JSON.stringify(error)); return false; }
  return true;
}

// ============================================================
// SUSPENSION / RÉACTIVATION ÉLÈVE
// ============================================================
async function suspendreEleve(nom) {
  const { error } = await supabase.from('eleves_custom').update({ actif: false }).eq('nom', nom);
  if (!error) { delete ELEVES[nom]; return true; }
  return false;
}

async function reactiverEleve(nom) {
  const { data, error } = await supabase.from('eleves_custom').update({ actif: true }).eq('nom', nom).select();
  if (!error && data && data.length > 0) {
    const e = data[0];
    ELEVES[e.nom] = {
      niveau: e.niveau, taux: e.taux, duree: e.duree, tda: e.tda || false,
      ficheHebdo: e.fiche_hebdo || false, question2h: e.question_2h !== false,
      fiche: e.fiche !== false, jour: e.jour, heure: e.heure, minute: e.minute || 0,
      uneSemaineSurDeux: e.une_semaine_sur_deux || false,
    };
    return true;
  }
  return false;
}

// ============================================================
// SNAPSHOT MENSUEL
// ============================================================
async function sauvegarderSnapshotMensuel() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data: existing } = await supabase.from('snapshots_mensuels').select('id').eq('mois', mois).limit(1);
  if (existing && existing.length > 0) { console.log(`Snapshot ${mois} déjà existant, skip.`); return; }
  const data = await getData(0);
  const snapshot = {
    salaire: data.salaire, completude: data.completude, total_revenus: data.totalRevenus,
    total_depenses: data.totalDep, solde: data.solde, epargne_base: data.epargneBase,
    epargne_estimee: data.epargneEstimee, nb_cours: data.cours.length,
    nb_cours_manques: data.coursManques.length, total_manque: data.totalManque,
    totaux_budgets: data.totaux, cours: data.cours, cours_manques: data.coursManques,
    revenus_supp: data.revenus,
  };
  const { error } = await supabase.from('snapshots_mensuels').insert({ mois, donnees: snapshot });
  if (error) console.error('Snapshot mensuel erreur:', error.message);
  else {
    console.log(`✅ Snapshot ${mois} sauvegardé`);
    await send(CHAT_ID, `📦 *Snapshot de ${mois} sauvegardé !*\nSolde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€* — Épargne estimée: *${data.epargneEstimee.toFixed(0)}€*`);
  }
}

async function envoyerBilanMensuel(chatId) {
  const { data: snapshots } = await supabase.from('snapshots_mensuels').select('*').order('mois', { ascending: false }).limit(6);
  if (!snapshots || snapshots.length === 0) {
    await send(chatId, '❌ Aucun snapshot mensuel trouvé.\n_Le premier sera créé automatiquement le dernier jour du mois._');
    return;
  }
  let msg = `📅 *Historique mensuel*\n\n`;
  snapshots.forEach(s => {
    const d = s.donnees;
    const emoji = d.solde >= 0 ? '🟢' : '🔴';
    msg += `*${s.mois}*\n${emoji} Solde: *${d.solde >= 0 ? '+' : ''}${d.solde?.toFixed(0)}€*\n`;
    msg += `📚 Complétude: ${d.completude?.toFixed(0)}€ — ${d.nb_cours} cours\n`;
    msg += `💎 Épargne fin de mois: ${d.epargne_estimee?.toFixed(0)}€\n\n`;
  });
  await send(chatId, msg);
}

async function afficherProgressionEpargne(chatId, montant) {
  let msg = `💎 *Épargne mise à jour : ${montant.toLocaleString('fr-FR')} €*\n\n📊 *Progression vers tes objectifs :*\n\n`;
  OBJECTIFS.forEach(o => {
    const delta = montant - o.montant;
    const pct = Math.min(100, Math.round((montant / o.montant) * 100));
    const barre = Math.round(pct / 10);
    const barreStr = '█'.repeat(barre) + '░'.repeat(10 - barre);
    msg += `${delta >= 0 ? '✅' : '⏳'} *${o.label}* — ${o.montant.toLocaleString('fr-FR')} €\n`;
    msg += `\`${barreStr}\` ${pct}%\n`;
    msg += delta >= 0 ? `_+${delta.toFixed(0)} € au-dessus_ ✨\n\n` : `_Il manque ${Math.abs(delta).toFixed(0)} €_\n\n`;
  });
  await send(chatId, msg);
}

// ============================================================
// SUIVI PRÉLÈVEMENTS
// ============================================================
function getPrelEvementsAVenir(joursAvance = 7) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const aujourdhui = now.getDate();
  const finPeriode = aujourdhui + joursAvance;
  const dernierJour = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const aVenir = [];
  PRELEVEMENTS_DATES.forEach(p => {
    if (!p.jour || p.suspendu) return;
    let jourPrelevement = p.jour > dernierJour ? dernierJour : p.jour;
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
    if (!p.jour || p.suspendu) return;
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
  const TOTAL_CHARGES_FIXES = getTotalChargesFixes();
  const elevesInfo = Object.entries(ELEVES).map(([n, e]) =>
    `${n} (${e.niveau}, ${e.taux}€/h, ${e.duree}h, ${JOURS_NOMS[e.jour]} à ${e.heure}h${e.minute > 0 ? e.minute.toString().padStart(2,'0') : '00'})`
  ).join('\n');
  const budgetsInfo = Object.entries(BUDGETS).map(([k, b]) => `${b.label}: ${data.totaux[k]?.toFixed(0) || 0}€ / ${b.max}€`).join('\n');
  const objectifsInfo = OBJECTIFS.map(o => {
    const delta = data.epargneBase - o.montant;
    return `${o.label}: ${o.montant.toLocaleString()}€ (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}€)`;
  }).join('\n');
  const prelevementsInfo = PRELEVEMENTS_DATES.filter(p => p.jour)
    .map(p => `${p.suspendu ? '⏸️' : ''}${p.nom}: ${p.montant}€ (le ${p.jour})${p.suspendu ? ' [SUSPENDU]' : ''}`)
    .join('\n');

  const ctx = `Tu es L'Agent, assistant personnel intelligent de Nour-Dine.
Tu es direct, naturel, bienveillant et proactif.
Tu réponds à TOUTES les questions naturellement, pas seulement les commandes.
Tu analyses, tu conseilles, tu calcules si besoin.
Tu parles français naturellement, jamais de JSON ni de balises techniques.
Max 6 lignes sauf si on te demande un détail complet.

=== SITUATION FINANCIÈRE ===
Salaire LGM: ${data.salaire}€
Beau-frère: ${BEAU_FRERE}€
Complétude cours: ${data.completude.toFixed(0)}€ / ${OBJECTIF_COMPLETUDE}€
Revenus supplémentaires: ${data.revenusSupp.toFixed(0)}€
Total revenus: ${data.totalRevenus.toFixed(0)}€
Charges fixes totales: ${TOTAL_CHARGES_FIXES.toFixed(0)}€
Total dépenses: ${data.totalDep.toFixed(0)}€
Solde du mois: ${data.solde.toFixed(0)}€
Épargne actuelle: ${data.epargneBase.toLocaleString()}€
Épargne estimée fin de mois: ${data.epargneEstimee.toFixed(0)}€

=== BUDGETS CE MOIS ===
${budgetsInfo}

=== ÉLÈVES ACTIFS ===
${elevesInfo || 'Aucun élève actif'}
Cours effectués ce mois: ${data.cours.length}
Cours manqués ce mois: ${data.coursManques.length}
Manque à gagner: ${data.totalManque.toFixed(0)}€

=== PRÉLÈVEMENTS ===
${prelevementsInfo}
Total charges fixes actives: ${TOTAL_CHARGES_FIXES.toFixed(0)}€/mois

=== OBJECTIFS ÉPARGNE ===
${objectifsInfo}

=== COMMANDES DISPONIBLES ===
/bilan /completude /objectifs /prelevements /config /ajouteleve /suspendre /reactiver /annuler /modifier /revenu /epargne /fiche /historique`;

  const result = await model.generateContent(ctx + '\n\nMessage de Nour-Dine: ' + message);
  return result.response.text();
}

// ============================================================
// DÉTECTION
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
  const m = texte.match(/(\d+([.,]\d{1,2})?)\s*€/);
  if (m) return parseFloat(m[1].replace(',', '.'));
  const m2 = texte.match(/(\d+([.,]\d{1,2})?)/);
  return m2 ? parseFloat(m2[1].replace(',', '.')) : null;
}

function trouverCategorie(texte) {
  const t = texte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\bessence\b/.test(t)) return 'essence';
  if (/\bcourses\b/.test(t)) return 'courses';
  if (/\brestos?\b/.test(t)) return 'restos';
  if (/\bvoiture\b/.test(t)) return 'voiture';
  if (/\bsante\b/.test(t)) return 'sante';
  if (/\bmaison\b/.test(t)) return 'maison';
  if (/\bshopping\b/.test(t)) return 'shopping';
  if (/\bdivers\b/.test(t)) return 'divers';
  if (/\bloisirs?\b/.test(t)) return 'loisirs';
  if (/plein|carburant|station|total|esso/.test(t)) return 'essence';
  if (/leclerc|carrefour|lidl|cora|supermarche|aldi/.test(t)) return 'courses';
  if (/restaurant|mcdo|burger|pizza|kebab|sushi/.test(t)) return 'restos';
  if (/medecin|pharmacie|docteur|doctolib/.test(t)) return 'sante';
  if (/ikea|bricolage|castorama/.test(t)) return 'maison';
  if (/garage|reparation|pneu|peage/.test(t)) return 'voiture';
  if (/vetement|zara|coiffeur|hm/.test(t)) return 'shopping';
  if (/cinema|concert|sortie/.test(t)) return 'loisirs';
  return null;
}

const JOURS_NOMS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const NIVEAUX_VALIDES = ['CP', 'CE1', 'CE2', 'CM1', 'CM2', '6e', '5e', '4e', '3e', '2nde', '1ère', 'Terminale'];

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
// AJOUT ÉLÈVE — FLOW
// ============================================================
async function demarrerAjoutEleve(chatId) {
  sessionsAjoutEleve[chatId] = { etape: 'nom' };
  await send(chatId, `👤 *Ajouter un nouvel élève*\n\nÉtape 1/7 — Quel est son prénom ?\n_Ex: Thomas, Marie..._`);
}

async function traiterAjoutEleve(chatId, texte) {
  const sess = sessionsAjoutEleve[chatId];
  if (!sess) return false;
  switch (sess.etape) {
    case 'nom': {
      const nom = texte.trim();
      if (nom.length < 2 || nom.length > 30) { await send(chatId, '❌ Prénom invalide. Réessaie (2-30 caractères).'); return true; }
      if (ELEVES[nom]) { await send(chatId, `❌ *${nom}* existe déjà !`); delete sessionsAjoutEleve[chatId]; return true; }
      sess.nom = nom; sess.etape = 'niveau';
      const rows = [];
      for (let i = 0; i < NIVEAUX_VALIDES.length; i += 4)
        rows.push(NIVEAUX_VALIDES.slice(i, i+4).map(n => ({ t: n, d: `ae_niv_${n}` })));
      rows.push([{ t: '↩️ Annuler', d: 'ae_annuler' }]);
      await sendBtns(chatId, `👤 *${nom}*\n\nÉtape 2/7 — Quel niveau ?`, rows);
      return true;
    }
    case 'taux': {
      const taux = parseFloat(texte.replace(',', '.'));
      if (isNaN(taux) || taux < 10 || taux > 100) { await send(chatId, '❌ Taux invalide (entre 10 et 100). Ex: *24.50*'); return true; }
      sess.taux = taux; sess.etape = 'duree';
      await sendBtns(chatId, `👤 *${sess.nom}* — ${taux}€/h\n\nÉtape 4/7 — Durée des séances ?`, [
        [{ t: '1h', d: 'ae_dur_1' }, { t: '1h30', d: 'ae_dur_1.5' }, { t: '2h', d: 'ae_dur_2' }],
        [{ t: '↩️ Annuler', d: 'ae_annuler' }]
      ]);
      return true;
    }
    case 'heure': {
      const m = texte.match(/^(\d{1,2})h(\d{0,2})$/i);
      if (!m) { await send(chatId, '❌ Format invalide. Ex: *17h00* ou *9h30*'); return true; }
      const h = parseInt(m[1]), min = parseInt(m[2] || '0');
      if (h < 7 || h > 21 || min % 15 !== 0) { await send(chatId, '❌ Heure invalide (7h-21h, minutes multiples de 15). Ex: *17h00*'); return true; }
      sess.heure = h; sess.minute = min; sess.etape = 'options';
      await sendBtns(chatId,
        `👤 *${sess.nom}* — ${JOURS_NOMS[sess.jour]} à ${h}h${min > 0 ? min.toString().padStart(2,'0') : '00'}\n\nÉtape 7/7 — Options spéciales ?\n_Coche/décoche, puis valide_`,
        [
          [{ t: '☐ TDA/TDAH', d: 'ae_opt_tda' }, { t: '☐ Fiche hebdo', d: 'ae_opt_hebdo' }],
          [{ t: '☐ 1 semaine/2', d: 'ae_opt_2sem' }, { t: '✅ Valider', d: 'ae_opt_valider' }],
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
  if (data === 'ae_annuler') { delete sessionsAjoutEleve[chatId]; await send(chatId, '❌ Ajout d\'élève annulé.'); return; }

  if (data.startsWith('ae_niv_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.niveau = data.replace('ae_niv_', ''); sess.etape = 'taux';
    await send(chatId, `👤 *${sess.nom}* — ${sess.niveau}\n\nÉtape 3/7 — Quel taux horaire ?\n_Ex: 24.50_ (en euros)`);
    return;
  }

  if (data.startsWith('ae_dur_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.duree = parseFloat(data.replace('ae_dur_', '')); sess.etape = 'jour';
    const rows = JOURS_NOMS.map((j, i) => [{ t: j, d: `ae_jour_${i}` }]);
    rows.push([{ t: '↩️ Annuler', d: 'ae_annuler' }]);
    await sendBtns(chatId, `👤 *${sess.nom}* — ${sess.duree}h/séance\n\nÉtape 5/7 — Quel jour ?`, rows);
    return;
  }

  if (data.startsWith('ae_jour_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.jour = parseInt(data.replace('ae_jour_', '')); sess.etape = 'heure';
    await send(chatId, `👤 *${sess.nom}* — ${JOURS_NOMS[sess.jour]}\n\nÉtape 6/7 — À quelle heure ?\n_Ex: 17h00, 9h30_`);
    return;
  }

  if (data.startsWith('ae_opt_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    const opt = data.replace('ae_opt_', '');
    if (!sess.options) sess.options = {};
    if (opt === 'valider') {
      const eleveData = {
        nom: sess.nom, niveau: sess.niveau, taux: sess.taux, duree: sess.duree,
        jour: sess.jour, heure: sess.heure, minute: sess.minute || 0,
        tda: sess.options.tda || false, ficheHebdo: sess.options.ficheHebdo || false,
        uneSemaineSurDeux: sess.options.uneSemaineSurDeux || false, question2h: true, fiche: true,
      };
      const ok = await saveEleveCustom(chatId, eleveData);
      if (ok) {
        ELEVES[eleveData.nom] = eleveData;
        const resume = [
          `✅ *${eleveData.nom}* ajouté avec succès !`,
          `📚 ${eleveData.niveau} — ${eleveData.taux}€/h — ${eleveData.duree}h/séance`,
          `📅 ${JOURS_NOMS[eleveData.jour]} à ${eleveData.heure}h${eleveData.minute > 0 ? eleveData.minute.toString().padStart(2,'0') : '00'}`,
          eleveData.tda ? '🧠 TDA activé' : null,
          eleveData.ficheHebdo ? '📋 Fiche hebdo' : null,
          eleveData.uneSemaineSurDeux ? '🔄 1 semaine/2' : null,
        ].filter(Boolean).join('\n');
        await send(chatId, resume);
      } else {
        await send(chatId, '❌ Erreur Supabase lors de l\'ajout.');
      }
      delete sessionsAjoutEleve[chatId];
      return;
    }
    if (opt === 'tda') sess.options.tda = !sess.options.tda;
    else if (opt === 'hebdo') sess.options.ficheHebdo = !sess.options.ficheHebdo;
    else if (opt === '2sem') sess.options.uneSemaineSurDeux = !sess.options.uneSemaineSurDeux;
    const tdaLabel   = `${sess.options.tda ? '✅' : '☐'} TDA/TDAH`;
    const hebdoLabel = `${sess.options.ficheHebdo ? '✅' : '☐'} Fiche hebdo`;
    const semLabel   = `${sess.options.uneSemaineSurDeux ? '✅' : '☐'} 1 semaine/2`;
    await sendBtns(chatId, `👤 *${sess.nom}* — Options spéciales\n_Coche/décoche, puis valide_`, [
      [{ t: tdaLabel, d: 'ae_opt_tda' }, { t: hebdoLabel, d: 'ae_opt_hebdo' }],
      [{ t: semLabel, d: 'ae_opt_2sem' }, { t: '✅ Valider', d: 'ae_opt_valider' }],
      [{ t: '↩️ Annuler', d: 'ae_annuler' }]
    ]);
    return;
  }

  // ── SUSPENSION / RÉACTIVATION ÉLÈVE ───────────────────
  if (data.startsWith('susp_')) {
    const nom = data.replace('susp_', '');
    const ok = await suspendreEleve(nom);
    await send(chatId, ok
      ? `⏸️ *${nom}* suspendu.\nPlus de rappels automatiques, plus de cours enregistrés.\n_/reactiver pour le remettre quand tu reprends._`
      : `❌ Erreur lors de la suspension de ${nom}.`);
    return;
  }

  if (data.startsWith('react_')) {
    const nom = data.replace('react_', '');
    const ok = await reactiverEleve(nom);
    await send(chatId, ok ? `▶️ *${nom}* réactivé !` : `❌ Erreur lors de la réactivation de ${nom}.`);
    return;
  }

  // ── COURS DÉPLACÉ ──────────────────────────────────────
  if (data === 'cours_deplace') {
    const eleve = session.eleve;
    if (!eleve) return;
    const gain_manque = await saveCoursDeplace(chatId, eleve);
    await send(chatId, `📅 Cours *${eleve}* marqué comme *déplacé*\n_Le cours sera rattrapé ultérieurement. Pense à signaler le rattrapage !_`);
    if (session.fileAttente && session.fileAttente.length > 0) {
      const next = session.fileAttente[0];
      const reste = session.fileAttente.slice(1);
      sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
      await sendBtns(chatId, `📚 Cours suivant — *${next}* — effectué ?`,
        [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
      );
    } else {
      delete sessions[chatId];
    }
    return;
  }

  // ── OUI/NON cours ──────────────────────────────────────
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
          [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
        );
      } else { delete sessions[chatId]; }
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
          [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
        );
      } else { delete sessions[chatId]; }
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
        [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
      );
    } else { delete sessions[chatId]; }
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
    delete sessions[chatId]; delete sessionsEpargne[chatId];
    delete sessionsModifConfig[chatId]; delete sessionsModifPrel[chatId];
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
  if (data === 'fiche_annuler') { delete sessionsFiches[chatId]; await send(chatId, '❌ Génération de fiche annulée.'); return; }

  // ── Annuler type ───────────────────────────────────────
  if (data === 'ann_cours_fait') {
    const rows = [];
    const noms = Object.keys(ELEVES);
    for (let i = 0; i < noms.length; i += 3) rows.push(noms.slice(i, i+3).map(n => ({ t: n, d: 'ann_cf_' + n })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    sessionsAnnuler[chatId] = { type: 'cours_fait' };
    await sendBtns(chatId, '📚 Quel cours effectué annuler ?', rows);
    return;
  }
  if (data === 'ann_cours_manque') {
    const rows = [];
    const noms = Object.keys(ELEVES);
    for (let i = 0; i < noms.length; i += 3) rows.push(noms.slice(i, i+3).map(n => ({ t: n, d: 'ann_cm_' + n })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '❌ Quel cours manqué annuler ?', rows);
    return;
  }
  if (data === 'ann_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: 'ann_dep_' + k })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '💸 Quelle catégorie de dépense annuler ?', rows);
    return;
  }
  if (data === 'ann_revenu') {
    const debut = new Date(); debut.setUTCDate(1); debut.setUTCHours(0, 0, 0, 0);
    const { data: revenus } = await supabase.from('revenus').select('id, montant, libelle, created_at').gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(8);
    if (!revenus || revenus.length === 0) { await send(chatId, '❌ Aucun revenu enregistré ce mois.'); return; }
    const rows = revenus.map(r => {
      const date = new Date(r.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      return [{ t: `${r.montant}€ — ${(r.libelle || '?').slice(0, 20)} (${date})`, d: `ann_rev_id_${r.id}` }];
    });
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '💰 *Quel revenu annuler ?*', rows);
    return;
  }
  if (data.startsWith('ann_rev_id_')) {
    const id = data.replace('ann_rev_id_', '');
    const { data: item } = await supabase.from('revenus').select('montant, libelle').eq('id', id).single();
    const { error } = await supabase.from('revenus').delete().eq('id', id);
    await send(chatId, !error && item ? `✅ Revenu annulé : *+${item.montant}€* — ${item.libelle || '?'}` : '❌ Erreur lors de la suppression.');
    return;
  }
  if (data.startsWith('ann_cf_')) {
    const eleve = data.replace('ann_cf_', '');
    const ok = await annulerDernierCours(eleve);
    delete sessionsAnnuler[chatId];
    if (ok) { await send(chatId, `✅ Dernier cours de *${eleve}* annulé !`); await resumeCompletude(chatId); }
    else await send(chatId, `❌ Aucun cours trouvé pour *${eleve}* ce mois.`);
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
    for (let i = 0; i < cats.length; i += 3)
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label + ' (' + b.max + '€)', d: 'mod_bud_' + k })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '📊 Quel budget modifier ?', rows);
    return;
  }
  if (data === 'mod_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3)
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: 'mod_dep_' + k })));
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

  // ── CONFIG — modifier revenus fixes / charges ──────────
  if (data === 'cfg_salaire') {
    sessionsModifConfig[chatId] = { champ: 'salaire' };
    await send(chatId, `💼 *Salaire LGM actuel : ${SALAIRE_LGM_DEFAULT}€*\n\nEnvoie le nouveau montant :`);
    return;
  }
  if (data === 'cfg_beaufre') {
    sessionsModifConfig[chatId] = { champ: 'beaufre' };
    await send(chatId, `👨‍👩‍👦 *Beau-frère actuel : ${BEAU_FRERE}€*\n\nEnvoie le nouveau montant :`);
    return;
  }
  if (data === 'cfg_objectif') {
    sessionsModifConfig[chatId] = { champ: 'objectif' };
    await send(chatId, `🎯 *Objectif Complétude actuel : ${OBJECTIF_COMPLETUDE}€*\n\nEnvoie le nouveau montant mensuel cible :`);
    return;
  }
  if (data === 'cfg_charges') {
    // Afficher la liste des charges modifiables
    const items = Object.entries(CHARGES_FIXES);
    const rows = [];
    for (let i = 0; i < items.length; i += 2)
      rows.push(items.slice(i, i+2).map(([k, v]) => ({ t: `${k} (${v}€)`, d: `cfg_chg_${k}` })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '🏦 *Quelle charge fixe modifier ?*', rows);
    return;
  }
  if (data.startsWith('cfg_chg_')) {
    const nom = data.replace('cfg_chg_', '');
    sessionsModifConfig[chatId] = { champ: 'charge', nom };
    await send(chatId, `🏦 *${nom}* — montant actuel : *${CHARGES_FIXES[nom]}€*\n\nEnvoie le nouveau montant :`);
    return;
  }

  // ── PRÉLÈVEMENTS — suspendre / réactiver / modifier ────
  if (data === 'prel_suspendre') {
    const actifs = PRELEVEMENTS_DATES.filter(p => !p.suspendu && p.jour);
    const rows = [];
    for (let i = 0; i < actifs.length; i += 2)
      rows.push(actifs.slice(i, i+2).map(p => ({ t: `${p.nom} (${p.montant}€)`, d: `prel_susp_${p.nom}` })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '⏸️ *Quel prélèvement suspendre ?*', rows);
    return;
  }
  if (data === 'prel_reactiver') {
    const suspendus = PRELEVEMENTS_DATES.filter(p => p.suspendu);
    if (suspendus.length === 0) { await send(chatId, '✅ Aucun prélèvement suspendu.'); return; }
    const rows = [];
    for (let i = 0; i < suspendus.length; i += 2)
      rows.push(suspendus.slice(i, i+2).map(p => ({ t: `${p.nom} (${p.montant}€)`, d: `prel_react_${p.nom}` })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '▶️ *Quel prélèvement réactiver ?*', rows);
    return;
  }
  if (data === 'prel_modifier') {
    const rows = [];
    for (let i = 0; i < PRELEVEMENTS_DATES.length; i += 2)
      rows.push(PRELEVEMENTS_DATES.slice(i, i+2).map(p => ({
        t: `${p.suspendu ? '⏸️' : ''}${p.nom} (${p.montant}€)`,
        d: `prel_mod_${p.nom}`
      })));
    rows.push([{ t: '↩️ Retour', d: 'annuler' }]);
    await sendBtns(chatId, '✏️ *Quel prélèvement modifier ?*', rows);
    return;
  }
  if (data.startsWith('prel_susp_')) {
    const nom = data.replace('prel_susp_', '');
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (p) { p.suspendu = true; CHARGES_FIXES[nom] = 0; }
    await sauvegarderConfig(`prel_suspendu_${nom}`, 1);
    await send(chatId, `⏸️ *${nom}* suspendu — ${p?.montant.toFixed(2) || '?'}€ retirés des charges fixes.\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegardé ✓_`);
    return;
  }
  if (data.startsWith('prel_react_')) {
    const nom = data.replace('prel_react_', '');
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (p) { p.suspendu = false; CHARGES_FIXES[nom] = p.montant; }
    await sauvegarderConfig(`prel_suspendu_${nom}`, 0);
    await send(chatId, `▶️ *${nom}* réactivé — *${p?.montant.toFixed(2) || '?'}€* de nouveau dans les charges.\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegardé ✓_`);
    return;
  }
  if (data.startsWith('prel_mod_')) {
    const nom = data.replace('prel_mod_', '');
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (!p) return;
    sessionsModifPrel[chatId] = { nom, etape: 'choix_champ' };
    await sendBtns(chatId,
      `✏️ *${nom}*\nMontant actuel: *${p.montant}€* | Jour: *le ${p.jour || '?'}*\n\nQue veux-tu modifier ?`,
      [
        [{ t: '💶 Montant', d: 'prel_chg_montant' }, { t: '📅 Jour', d: 'prel_chg_jour' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]
    );
    return;
  }
  if (data === 'prel_chg_montant') {
    const sess = sessionsModifPrel[chatId];
    if (!sess) return;
    sess.etape = 'attente_montant';
    await send(chatId, `💶 Nouveau montant pour *${sess.nom}* (actuel: ${PRELEVEMENTS_DATES.find(p=>p.nom===sess.nom)?.montant}€) :`);
    return;
  }
  if (data === 'prel_chg_jour') {
    const sess = sessionsModifPrel[chatId];
    if (!sess) return;
    sess.etape = 'attente_jour';
    await send(chatId, `📅 Nouveau jour de prélèvement pour *${sess.nom}* (1-31) :`);
    return;
  }

  // ── Investissement ─────────────────────────────────────
  if (data.startsWith('inv_ticker_')) {
    const ticker = data.replace('inv_ticker_', '');
    if (ticker === 'autre') {
      sessionsInvest[chatId] = { etape: 'ticker_autre' };
      await send(chatId, `📈 Quel ticker ? (ex: AAPL, MSFT, AMZN)`);
    } else {
      sessionsInvest[chatId] = { ticker, etape: 'montant' };
      await send(chatId, `📈 *${ticker}*\n\nMontant investi en € ? (ex: *200*)`);
    }
    return;
  }

  // ── Revenu type ────────────────────────────────────────
  if (data.startsWith('rev_type_')) {
    const type = data.replace('rev_type_', '');
    if (type === '__autre__') {
      sessionsRevenu[chatId] = { type: null, etape: 'libelle_custom' };
      await send(chatId, `💰 *Autre revenu*\n\nDonne un libellé court pour cette rentrée :`);
    } else {
      sessionsRevenu[chatId] = { type, etape: 'montant' };
      await send(chatId, `💰 *${type}*\n\nMontant reçu ? (ex: *150*)`);
    }
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
    if (texte === '/start') {
      delete sessions[chatId];
      await send(chatId,
        `👋 Salut Nour-Dine ! Je suis *L'Agent*.\n\n` +
        `📚 _"j'ai fait cours avec Margaux"_ → signaler un cours\n` +
        `💸 _"j'ai fait le plein pour 60€"_ → dépense\n` +
        `💎 /epargne → mettre à jour ton épargne\n` +
        `📈 /investir → enregistrer un achat ETF/or\n` +
        `💼 /portefeuille → voir ton portefeuille\n` +
        `👤 /ajouteleve → nouvel élève\n` +
        `⏸️ /suspendre → mettre un élève en pause\n` +
        `▶️ /reactiver → réactiver un élève suspendu\n` +
        `💰 /revenu → enregistrer une rentrée\n` +
        `📅 /prelevements → voir ce qui arrive\n` +
        `⚙️ /config → modifier salaire, charges, prélèvements\n` +
        `📅 /historique → bilan des mois précédents\n` +
        `🌐 Dashboard: https://budget-bot-1ohb.onrender.com/dashboard`
      );
      return;
    }

    if (texte === '/reset') { delete sessions[chatId]; await send(chatId, '🔄 Conversation réinitialisée !'); return; }
    if (texte === '/fiche') { await demarrerFiche(chatId); return; }

    if (texte === '/ajouteleve' || texte === '/ajouter' || /ajouter?\s+[ée]l[eè]ve/i.test(texte)) {
      await demarrerAjoutEleve(chatId);
      return;
    }

    // ── COMMANDE /config ───────────────────────────────────
    if (texte === '/config') {
      await sendBtns(chatId, '⚙️ *Configuration — Que veux-tu modifier ?*', [
        [{ t: '💼 Salaire LGM', d: 'cfg_salaire' }, { t: '👨‍👩‍👦 Beau-frère', d: 'cfg_beaufre' }],
        [{ t: '🎯 Objectif Complétude', d: 'cfg_objectif' }, { t: '🏦 Charges fixes', d: 'cfg_charges' }],
        [{ t: '📅 Prélèvements', d: 'mod_prelevements' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    // ── COMMANDE /prelevements (gestion) ───────────────────
    if (texte === '/gererprelevements' || texte === '/gerer') {
      await sendBtns(chatId, '📅 *Gérer les prélèvements*', [
        [{ t: '⏸️ Suspendre', d: 'prel_suspendre' }, { t: '▶️ Réactiver', d: 'prel_reactiver' }],
        [{ t: '✏️ Modifier montant/jour', d: 'prel_modifier' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/suspendre' || texte === '/archiveleve') {
      const actifs = Object.keys(ELEVES);
      if (actifs.length === 0) { await send(chatId, '❌ Aucun élève actif.'); return; }
      const rows = [];
      for (let i = 0; i < actifs.length; i += 3)
        rows.push(actifs.slice(i, i+3).map(n => ({ t: n, d: `susp_${n}` })));
      rows.push([{ t: '↩️ Annuler', d: 'annuler' }]);
      await sendBtns(chatId, '⏸️ *Quel élève suspendre ?*\n_Il pourra être réactivé avec /reactiver._', rows);
      return;
    }

    if (texte === '/reactiver') {
      const { data: suspendus } = await supabase.from('eleves_custom').select('nom').eq('actif', false);
      if (!suspendus || suspendus.length === 0) { await send(chatId, '✅ Aucun élève suspendu en ce moment.'); return; }
      const rows = [];
      for (let i = 0; i < suspendus.length; i += 3)
        rows.push(suspendus.slice(i, i+3).map(e => ({ t: e.nom, d: `react_${e.nom}` })));
      rows.push([{ t: '↩️ Annuler', d: 'annuler' }]);
      await sendBtns(chatId, '▶️ *Quel élève réactiver ?*', rows);
      return;
    }

    if (texte === '/historique') { await envoyerBilanMensuel(chatId); return; }
    if (texte === '/snapshot') { await send(chatId, '📦 Sauvegarde du snapshot en cours...'); await sauvegarderSnapshotMensuel(); return; }

    // ── COMMANDE /portefeuille ─────────────────────────────
    if (texte === '/portefeuille' || texte === '/invest' || texte === '/portfolio') {
      await afficherPortefeuille(chatId);
      return;
    }

    // ── COMMANDE /investir ─────────────────────────────────
    if (texte === '/investir') {
      await sendBtns(chatId, '📈 *Quel actif as-tu acheté ?*', [
        [{ t: 'ISWD — ETF World Islamic', d: 'inv_ticker_ISWD' }],
        [{ t: 'SGLD — Or physique',       d: 'inv_ticker_SGLD' }],
        [{ t: '📝 Autre ticker',           d: 'inv_ticker_autre' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/epargne') {
      const data = await getData();
      sessionsEpargne[chatId] = { etape: 'saisie' };
      await send(chatId,
        `💎 *Mise à jour épargne*\n\nActuelle en base : *${data.epargneBase.toLocaleString('fr-FR')} €*\n\nEnvoie le nouveau montant total de ton épargne :\n_Ex: 9500_`
      );
      return;
    }

    if (texte === '/revenu' || texte === '/revenus') {
      await sendBtns(chatId, '💰 *Quel type de rentrée d\'argent ?*', [
        [{ t: '💼 Vinted / vente', d: 'rev_type_Vente Vinted' }, { t: '🔄 Remboursement', d: 'rev_type_Remboursement' }],
        [{ t: '🎁 Cadeau / don',   d: 'rev_type_Cadeau' },       { t: '📦 Autre',         d: 'rev_type___autre__' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/prelevements' || texte === '/prélèvements') {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const aujourd = now.getDate();
      const aVenir7j = getPrelEvementsAVenir(7);
      const totalRestant = getTotalPrelevementsRestants();
      const suspendus = PRELEVEMENTS_DATES.filter(p => p.suspendu);
      let msg = `📅 *Prélèvements — Suivi du mois*\n\n📍 Nous sommes le *${aujourd}*\n`;
      msg += `💰 Total charges actives: *${getTotalChargesFixes().toFixed(2)}€/mois*\n`;
      msg += `💰 Restant ce mois: *${totalRestant.toFixed(2)}€*\n`;
      if (suspendus.length > 0) {
        msg += `\n⏸️ *Suspendus (${suspendus.length}):* ${suspendus.map(p => p.nom).join(', ')}\n`;
      }
      if (aVenir7j.length > 0) {
        msg += `\n⚠️ *Dans les 7 prochains jours:*\n`;
        aVenir7j.forEach(p => {
          const quand = p.dansJours === 0 ? 'Aujourd\'hui' : p.dansJours === 1 ? 'Demain' : `Dans ${p.dansJours}j`;
          msg += `• ${quand} (${p.jourEffectif}) — ${p.nom}: *${p.montant.toFixed(2)}€*\n`;
        });
        msg += `\n💸 Total cette semaine: *${aVenir7j.reduce((s, p) => s + p.montant, 0).toFixed(2)}€*\n`;
      } else {
        msg += `\n✅ Aucun prélèvement dans les 7 prochains jours\n`;
      }
      msg += `\n_Gérer: /gererprelevements_`;
      await send(chatId, msg);
      return;
    }

    // callback depuis /config
    if (texte === '/modifier' || texte === 'mod_prelevements') {
      await sendBtns(chatId, '✏️ *Que veux-tu modifier ?*', [
        [{ t: '📊 Un budget catégorie', d: 'mod_budget' }],
        [{ t: '💸 Rectifier une dépense', d: 'mod_depense' }],
        [{ t: '📅 Prélèvements', d: 'mod_prelevements' }],
        [{ t: '↩️ Annuler', d: 'annuler' }]
      ]);
      return;
    }

    // ── ÉTATS ACTIFS ───────────────────────────────────────

    // Session modification prélèvement (montant ou jour)
    if (sessionsModifPrel[chatId]?.etape === 'attente_montant') {
      const sess = sessionsModifPrel[chatId];
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, '❌ Montant invalide.'); return; }
      const p = PRELEVEMENTS_DATES.find(p => p.nom === sess.nom);
      if (p) {
        p.montant = montant;
        CHARGES_FIXES[p.nom] = montant;
        await sauvegarderConfig(`prel_montant_${p.nom}`, montant);
      }
      delete sessionsModifPrel[chatId];
      await send(chatId, `✅ *${sess.nom}* mis à jour : *${montant}€*\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegardé ✓_`);
      return;
    }

    if (sessionsModifPrel[chatId]?.etape === 'attente_jour') {
      const sess = sessionsModifPrel[chatId];
      const jour = parseInt(texte);
      if (isNaN(jour) || jour < 1 || jour > 31) { await send(chatId, '❌ Jour invalide (1-31).'); return; }
      const p = PRELEVEMENTS_DATES.find(p => p.nom === sess.nom);
      if (p) {
        p.jour = jour;
        await sauvegarderConfig(`prel_jour_${p.nom}`, jour);
      }
      delete sessionsModifPrel[chatId];
      await send(chatId, `✅ *${sess.nom}* — nouveau jour : *le ${jour}* — Sauvegardé ✓`);
      return;
    }

    // Session modification config (salaire, beau-frère, objectif, charge)
    if (sessionsModifConfig[chatId]) {
      const sess = sessionsModifConfig[chatId];
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, '❌ Montant invalide. Ex: *2500*'); return; }
      let msg = '';
      if (sess.champ === 'salaire') {
        SALAIRE_LGM_DEFAULT = montant;
        await sauvegarderConfig('salaire_lgm', montant);
        msg = `✅ Salaire LGM mis à jour : *${montant}€/mois*\n_Sauvegardé en base ✓_`;
      } else if (sess.champ === 'beaufre') {
        BEAU_FRERE = montant;
        await sauvegarderConfig('beau_frere', montant);
        msg = `✅ Revenu beau-frère mis à jour : *${montant}€/mois*\n_Sauvegardé en base ✓_`;
      } else if (sess.champ === 'objectif') {
        OBJECTIF_COMPLETUDE = montant;
        await sauvegarderConfig('objectif_completude', montant);
        msg = `✅ Objectif Complétude mis à jour : *${montant}€/mois*\n_Sauvegardé en base ✓_`;
      } else if (sess.champ === 'charge') {
        const nom = sess.nom;
        const ancien = CHARGES_FIXES[nom];
        CHARGES_FIXES[nom] = montant;
        const prel = PRELEVEMENTS_DATES.find(p => p.nom === nom);
        if (prel) prel.montant = montant;
        await sauvegarderConfig(`prel_montant_${nom}`, montant);
        msg = `✅ *${nom}* : ${ancien}€ → *${montant}€*\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegardé ✓_`;
      }
      delete sessionsModifConfig[chatId];
      await send(chatId, msg);
      return;
    }

    // Session investissement
    if (sessionsInvest[chatId]) {
      const sess = sessionsInvest[chatId];
      if (sess.etape === 'ticker_autre') {
        const ticker = texte.trim().toUpperCase();
        if (ticker.length < 2 || ticker.length > 10) { await send(chatId, '❌ Ticker invalide. Ex: AAPL, MSFT'); return; }
        sess.ticker = ticker;
        sess.etape = 'montant';
        await send(chatId, `📈 *${ticker}*\n\nMontant investi en € ? (ex: *200*)`);
        return;
      }
      if (sess.etape === 'montant') {
        const montant = parseFloat(texte.replace(',', '.'));
        if (isNaN(montant) || montant <= 0) { await send(chatId, '❌ Montant invalide. Ex: *200*'); return; }
        sess.montant = montant;
        sess.etape = 'prix';
        await send(chatId, `📈 *${sess.ticker}* — ${montant}€\n\nPrix unitaire de la part au moment de l'achat ? (ex: *51.05*)`);
        return;
      }
      if (sess.etape === 'prix') {
        const prix = parseFloat(texte.replace(',', '.'));
        if (isNaN(prix) || prix <= 0) { await send(chatId, '❌ Prix invalide. Ex: *51.05*'); return; }
        const nb_parts = sess.montant / prix;
        await saveInvestissement(chatId, sess.ticker, sess.montant, prix);
        delete sessionsInvest[chatId];
        await send(chatId,
          `✅ *Achat enregistré !*\n\n` +
          `📈 ${sess.ticker}\n` +
          `💶 Montant: *${sess.montant}€*\n` +
          `📊 Prix unitaire: *${prix}€*\n` +
          `🔢 Parts achetées: *${nb_parts.toFixed(4)}*\n\n` +
          `_/portefeuille pour voir ta situation complète_`
        );
        return;
      }
    }

    if (sessionsAjoutEleve[chatId]) {
      const handled = await traiterAjoutEleve(chatId, texte);
      if (handled) return;
    }

    // Session revenu — libellé custom
    if (sessionsRevenu[chatId]?.etape === 'libelle_custom') {
      const libelle = texte.trim();
      if (!libelle || libelle.length < 2) { await send(chatId, '❌ Libellé trop court. Réessaie.'); return; }
      sessionsRevenu[chatId] = { type: libelle, etape: 'montant' };
      await send(chatId, `💰 *${libelle}*\n\nMontant reçu ? (ex: *150*)`);
      return;
    }

    if (sessionsRevenu[chatId]?.etape === 'montant') {
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        const type = sessionsRevenu[chatId].type;
        await saveRevenu(chatId, montant, type);
        delete sessionsRevenu[chatId];
        await send(chatId, `✅ Rentrée *+${montant}€* enregistrée ! (${type})`);
      } else {
        await send(chatId, 'Envoie un montant valide, ex: *150*');
      }
      return;
    }

    if (sessionsModifier[chatId]?.etape === 'attente_montant_budget') {
      const cat = sessionsModifier[chatId].categorie;
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        BUDGETS[cat].max = montant;
        delete sessionsModifier[chatId];
        await send(chatId, `✅ Budget *${BUDGETS[cat].label}* mis à jour : *${montant} €/mois*`);
      } else { await send(chatId, 'Envoie un montant valide, ex: *400*'); }
      return;
    }

    if (sessionsModifier[chatId]?.etape === 'attente_rectif_depense') {
      const cat = sessionsModifier[chatId].categorie;
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        const item = await annulerDerniereDepense(cat);
        if (item) {
          await saveDepense(chatId, montant, cat, item.libelle || texte);
          delete sessionsModifier[chatId];
          await send(chatId, `✅ Dépense rectifiée : *${montant} €* — ${BUDGETS[cat].label}\nAncien montant : ${item.montant} €`);
        } else { await send(chatId, `Aucune dépense trouvée pour ${BUDGETS[cat].label} ce mois.`); delete sessionsModifier[chatId]; }
      } else { await send(chatId, 'Envoie le nouveau montant, ex: *45*'); }
      return;
    }

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

    if (texte === '/bilan') {
      const data = await getData();
      const TOTAL_CF = getTotalChargesFixes();
      let m = `📊 *Bilan ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      Object.entries(data.totaux).forEach(([k, v]) => {
        const e = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        m += `${e} ${BUDGETS[k].label}: ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      const totalGlobal = TOTAL_CF + data.totalDep;
      const emojiGlobal = totalGlobal > SEUIL_ALERTE_TOTAL ? '🔴' : totalGlobal > SEUIL_ALERTE_TOTAL * 0.9 ? '🟡' : '🟢';
      m += `\n${emojiGlobal} Total (fixes+variables): *${totalGlobal.toFixed(0)}€* / seuil ${SEUIL_ALERTE_TOTAL}€`;
      m += `\n💰 *Solde: ${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
      await send(chatId, m);
      return;
    }

    if (texte === '/completude') {
      const data = await getData();
      let m = `📚 *Complétude ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}*\n\n`;
      m += `🟢 *${data.completude.toFixed(2)}€* / ${OBJECTIF_COMPLETUDE}€\nCours: ${data.cours.length}\n`;
      if (data.cours.length > 0) {
        m += `\n*Détail:*\n`;
        data.cours.forEach(c => { m += `• ${c.eleve}${c.rattrapage ? ' (rattrapage)' : ''}: +${c.gain.toFixed(2)}€\n`; });
      }
      if (data.coursManques.length > 0) {
        m += `\n❌ *Manques:*\n`;
        data.coursManques.forEach(c => { m += `• ${c.eleve}${c.libelle === 'déplacé' ? ' 📅 (déplacé)' : ''}: -${c.gain_manque.toFixed(2)}€\n`; });
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
          [{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }],
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
        return;
      }
    }

    if (/salaire|lgm|paie/i.test(texte) && montant && montant > 1000) {
      await saveSalaire(chatId, montant);
      await send(chatId, `✅ Salaire LGM enregistré: *${montant}€* 📊`);
      return;
    }

    if (/epargne|épargne|economies|économies|capital|livret|compte epargne/i.test(texte) && montant && montant > 100) {
      await saveEpargne(chatId, montant);
      await afficherProgressionEpargne(chatId, montant);
      return;
    }

    if (/recu|vinted|remboursement|rentree|participation/i.test(texte) && montant) {
      await saveRevenu(chatId, montant, texte);
      await send(chatId, `✅ Rentrée *+${montant}€* enregistrée !`);
      return;
    }

    // ── NLP ÉTENDU ─────────────────────────────────────────
    const data = await getData();
    const elevesNLP = trouverTousLesEleves(texte);
    const eleveNLP = elevesNLP[0] || null;

    if (eleveNLP) {
      const signesAbsence = /absent|pas (l[aà]|venu|v[eè]nu|pu|fait|venir)|annul|pr[eé]venu|cancel|s.est d[eé]sist|pa(s)? (eu|pu)|a pas|na pas/i.test(texte);
      const signesCours = /\bcours\b|\bseance\b|\brattrapage\b|\bfait cours\b|\bvu\b|\btermin|\bfini\b|j.ai fait|on a fait|effectu/i.test(texte);
      const signesDeplace = /deplace|déplacé|reporté|reporte|autre.*jour|change.*jour|pas.*ce.*soir/i.test(texte);

      if (signesDeplace && eleveNLP) {
        const gain_manque = await saveCoursDeplace(chatId, eleveNLP);
        await send(chatId, `📅 Cours *${eleveNLP}* marqué comme déplacé.`);
        return;
      }

      if (signesAbsence) {
        for (const el of elevesNLP) {
          const gain_manque = await saveCoursManque(chatId, el);
          await send(chatId, `❌ Cours ${el} non effectué\n💸 Manque: *-${gain_manque.toFixed(2)}€*`);
        }
        return;
      }

      if (signesCours) {
        const rattrapage = /rattrapage/i.test(texte);
        const fileAttente = elevesNLP.slice(1);
        sessions[chatId] = { eleve: eleveNLP, rattrapage, etape: 'confirmation', fileAttente };
        await sendBtns(chatId,
          `📚 Cours avec *${eleveNLP}*${rattrapage ? ' _(rattrapage)_' : ''} — effectué ?`,
          [[{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }], [{ t: '↩️ Annuler', d: 'annuler' }]]
        );
        return;
      }
    }

    const montantNLP = trouverMontant(texte);
    if (montantNLP && montantNLP > 0 && montantNLP < 5000) {
      let catNLP = trouverCategorie(texte);
      if (!catNLP) {
        if (/plein|carburant|essence|gasoil|sans.plomb|bp |total |esso|shell/i.test(texte)) catNLP = 'essence';
        else if (/mang|d[eé]jeuner|d[iî]ner|midi|resto|brasserie|boulang|vienno|sandwich|snack|fast.?food|mcdonald|kfc|burger|pizza|kebab|sushi|japonais|chinois|thaï|caf[eé]|boba/i.test(texte)) catNLP = 'restos';
        else if (/leclerc|carrefour|lidl|aldi|monop|intermarché|casino|franprix|g20|simply|super|hyper|marché|primeur|épicerie|alimentation|courses|commissions/i.test(texte)) catNLP = 'courses';
        else if (/médecin|docteur|pharmac|infirm|kiné|ostéo|dentiste|opticien|clinique|hôpital|urgence|doctolib|ordonnance|médicament|doliprane|smur/i.test(texte)) catNLP = 'sante';
        else if (/coiffeur|coif|ongle|nail|lash|brow|maquillage|sephora|zara|h&m|hm|primark|vêtement|habit|fringue|chaussure|sac|accessoire|bijou|montre|parfum/i.test(texte)) catNLP = 'shopping';
        else if (/cinéma|concert|spectacle|théâtre|musée|sortie|bowling|karting|escape|parc|zoo|aquarium|netflix|amazon|spotify|jeu|jeux/i.test(texte)) catNLP = 'loisirs';
        else if (/ikea|leroy|castorama|brico|déco|meuble|rideau|ampoule|outil|plomberie|électricité|peinture|rénovation/i.test(texte)) catNLP = 'maison';
        else if (/garage|mécanicien|pneu|vidange|révision|contrôle.technique|péage|autoroute|parking|horodateur|pv |amende|stationnement|lavage.voiture/i.test(texte)) catNLP = 'voiture';
      }
      if (catNLP) {
        await saveDepense(chatId, montantNLP, catNLP, texte);
        const newData = await getData();
        const restant = BUDGETS[catNLP].max - newData.totaux[catNLP];
        const emoji = restant < 0 ? '🔴' : restant < BUDGETS[catNLP].max * 0.2 ? '🟡' : '🟢';
        await send(chatId, `✅ *${montantNLP}€* — ${BUDGETS[catNLP].label}\n${emoji} Restant: *${restant.toFixed(0)}€* / ${BUDGETS[catNLP].max}€`);
        return;
      }
      sessions[chatId] = { montant: montantNLP, libelle: texte, etape: 'choix_cat' };
      const cats = Object.entries(BUDGETS);
      const rows = [];
      for (let i = 0; i < cats.length; i += 3)
        rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
      rows.push([{ t: '↩️ Annuler', d: 'annuler' }]);
      await sendBtns(chatId, `💸 *${montantNLP}€* — Quelle catégorie ?`, rows);
      return;
    }

    if (/salaire|lgm|paie|virement.*lgm|lgm.*virement/i.test(texte) && montantNLP && montantNLP > 1000) {
      await saveSalaire(chatId, montantNLP);
      await send(chatId, `✅ Salaire LGM enregistré: *${montantNLP}€* 📊`);
      return;
    }

    if (/epargne|épargne|économie|économies|livret|capital|j.ai mis|j.ai économisé|mis de c[oô]t[eé]/i.test(texte) && montantNLP && montantNLP > 100) {
      await saveEpargne(chatId, montantNLP);
      await afficherProgressionEpargne(chatId, montantNLP);
      return;
    }

    if (/reçu|vinted|remboursement|rentrée|rentr[eé]e|participation|prime|bonus|cash|gagné|vendu/i.test(texte) && montantNLP && montantNLP > 0) {
      await saveRevenu(chatId, montantNLP, texte);
      await send(chatId, `✅ Rentrée *+${montantNLP}€* enregistrée !`);
      return;
    }

    // Fallback Gemini
    try {
      const reponse = await geminiParle(chatId, texte, data);
      await send(chatId, reponse);
    } catch (err) {
      console.error('geminiParle error:', err.message);
      await send(chatId, `Je n'ai pas compris. Essaie:\n• _"cours avec [prénom]"_\n• _"[montant]€ [lieu/type]"_\n• /bilan /completude /prelevements`);
    }

  } catch (err) {
    console.error('Erreur webhook:', err.message);
    await send(chatId, 'Erreur technique, réessaie.');
  }
});

// ============================================================
// ROUTE /depense
// ============================================================
app.post('/depense', async (req, res) => {
  res.sendStatus(200);
  try {
    const { chat_id, text } = req.body;
    const chatId = chat_id || CHAT_ID;
    const montant = trouverMontant(text);
    const cat = trouverCategorie(text);
    if (!montant || montant <= 0) { await send(chatId, '❌ Montant invalide reçu depuis le raccourci.'); return; }
    if (cat) {
      await saveDepense(chatId, montant, cat, text);
      const newData = await getData();
      const restant = BUDGETS[cat].max - newData.totaux[cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[cat].max * 0.2 ? '🟡' : '🟢';
      await send(chatId, `🍎 *Apple Pay — ${montant}€*\n✅ ${BUDGETS[cat].label}\n${emoji} Restant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
    } else {
      sessions[chatId] = { montant, libelle: text, etape: 'choix_cat' };
      const cats = Object.entries(BUDGETS);
      const rows = [];
      for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i + 3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
      rows.push([{ t: '↩️ Annuler', d: 'annuler' }]);
      await sendBtns(chatId, `🍎 *Apple Pay — ${montant}€*\n\nQuelle catégorie ?`, rows);
    }
  } catch (err) { console.error('/depense error:', err.message); }
});

// ============================================================
// API DASHBOARD
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const moisOffset = parseInt(req.query.mois || '0');
    const data = await getData(moisOffset);
    const aVenir = getPrelEvementsAVenir(7);
    const totalRestant = getTotalPrelevementsRestants();
    const TOTAL_CF = getTotalChargesFixes();

    const moisDisponibles = [];
    for (let i = -5; i <= 0; i++) {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      moisDisponibles.push({ offset: i, label: d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' }), isCurrent: i === 0 });
    }

    const planningDashboard = {};
    Object.entries(ELEVES).forEach(([nom, p]) => {
      planningDashboard[nom] = { jour: p.jour, taux: p.taux, duree: p.duree, uneSemaineSurDeux: p.uneSemaineSurDeux || false, niveau: p.niveau };
    });

    const potentiel = calculerPotentielRestant(moisOffset, data.cours, data.coursManques);
    const { data: snapshots } = await supabase.from('snapshots_mensuels').select('mois, donnees').order('mois', { ascending: false }).limit(12);

    res.json({
      salaire: data.salaire, beau_frere: BEAU_FRERE, completude: data.completude,
      objectif_completude: OBJECTIF_COMPLETUDE, total_revenus: data.totalRevenus,
      charges_fixes: TOTAL_CF, total_dep: data.totalDep, solde: data.solde,
      epargne_base: data.epargneBase, epargne_estimee: data.epargneEstimee,
      total_manque: data.totalManque, nb_cours: data.cours.length, nb_cours_manques: data.coursManques.length,
      cours: data.cours, cours_manques: data.coursManques, totaux: data.totaux, detail: data.detail,
      budgets: BUDGETS, objectifs: OBJECTIFS, revenus_supp: data.revenus,
      prelevements_a_venir: aVenir, total_prelevements_restants: totalRestant,
      prelevements_tous: PRELEVEMENTS_DATES, mois_offset: moisOffset, mois_disponibles: moisDisponibles,
      planning: planningDashboard, potentiel_restant: potentiel.montantRestant,
      jours_restants_count: potentiel.joursRestantsCount, eleves_restants: potentiel.elevesRestants,
      calendrier: potentiel.calendrier, dernier_jour: potentiel.dernierJour,
      annee_mois: { annee: potentiel.annee, mois: potentiel.mois },
      snapshots_mensuels: snapshots || [],
      seuil_alerte_total: SEUIL_ALERTE_TOTAL,
      seuil_alerte_variable: SEUIL_ALERTE_VARIABLE,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'dashboard.html')); });
app.get('/dashboard', (req, res) => { res.sendFile(path.join(__dirname, 'dashboard.html')); });

// ============================================================
// MESSAGES AUTOMATIQUES
// ============================================================
async function envoyerRappelBiHebdo() {
  const data = await getData();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - data.completude);
  const pct = Math.min(100, Math.round((data.completude / OBJECTIF_COMPLETUDE) * 100));
  const emoji = data.completude >= OBJECTIF_COMPLETUDE ? '🟢' : data.completude >= 1000 ? '🟡' : '🔴';
  let msg = `📊 *Point bi-hebdo*\n\n${emoji} Complétude: *${data.completude.toFixed(0)}€* / ${OBJECTIF_COMPLETUDE}€ (${pct}%)\n`;
  if (manque > 0) msg += `⚠️ Il manque: *${manque.toFixed(0)}€*\n`;
  msg += `💰 Solde estimé: *${data.solde.toFixed(0)}€*\n`;
  msg += `💎 Épargne projetée: *${data.epargneEstimee.toFixed(0)}€*`;
  await send(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  let msg = `🗓️ *Synthèse de fin de mois*\n\n`;
  msg += `💰 Revenus totaux: *${data.totalRevenus.toFixed(0)}€*\n`;
  msg += `📚 Complétude: *${data.completude.toFixed(0)}€* / ${OBJECTIF_COMPLETUDE}€\n`;
  msg += `💸 Dépenses: *${data.totalDep.toFixed(0)}€*\n`;
  msg += `📊 Solde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*\n`;
  msg += `💎 Épargne estimée: *${data.epargneEstimee.toFixed(0)}€*\n\n`;
  msg += `_Bilan sauvegardé. Nouveau mois qui commence !_`;
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
  setInterval(() => { fetch(`https://budget-bot-1ohb.onrender.com/health`).catch(() => {}); }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const jour = now.getDay(), heure = now.getHours(), minute = now.getMinutes();

    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) await envoyerRappelBiHebdo();

    if (heure === 20 && minute === 0) {
      const dernierJourDuMois = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      if (now.getDate() === dernierJourDuMois) {
        await sauvegarderSnapshotMensuel();
        await envoyerSyntheseMensuelle();
      }
    }

    const demain = now.getDate() + 1;
    if (heure === 9 && minute === 0) {
      const alertes = PRELEVEMENTS_DATES.filter(p => p.jour === demain && !p.suspendu);
      if (alertes.length > 0) {
        const total = alertes.reduce((s, p) => s + p.montant, 0);
        let msg = `⚠️ *Prélèvements demain (${demain})*\n\n`;
        alertes.forEach(p => msg += `• ${p.nom}: *${p.montant.toFixed(2)}€*\n`);
        msg += `\n💸 Total: *${total.toFixed(2)}€*\n_Vérifie que ton compte est alimenté !_`;
        await send(CHAT_ID, msg);
      }
    }

    // Rappel DCA investissement — 1er du mois à 10h
    if (now.getDate() === 1 && heure === 10 && minute === 0) {
      const investissements = await getInvestissements();
      const parTicker = {};
      investissements.forEach(inv => {
        if (!parTicker[inv.ticker]) parTicker[inv.ticker] = 0;
        parTicker[inv.ticker] += inv.montant;
      });
      const totalInvesti = Object.values(parTicker).reduce((a, b) => a + b, 0);
      let msg = `📅 *Rappel DCA mensuel*\n\n`;
      msg += `C'est le 1er du mois — as-tu pensé à ton versement ISWD ?\n\n`;
      if (totalInvesti > 0) {
        msg += `💼 Total investi à ce jour: *${totalInvesti.toFixed(0)}€*\n`;
        Object.entries(parTicker).forEach(([t, m]) => { msg += `• ${t}: ${m.toFixed(0)}€\n`; });
        msg += `\n`;
      }
      msg += `_/investir pour enregistrer ton achat du mois_`;
      await send(CHAT_ID, msg);
    }

    for (const [nomEleve, profil] of Object.entries(ELEVES)) {
      if (profil.uneSemaineSurDeux && !estSemaineSerena()) continue;
      const totalMin = profil.minute + Math.floor(profil.duree * 60);
      const heureFin = profil.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;
      if (heure === heureFin && minute === minuteFin) {
        sessions[CHAT_ID] = { eleve: nomEleve, rattrapage: false, etape: 'confirmation' };
        await sendBtns(CHAT_ID,
          `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${nomEleve}* ?`,
          [
            [{ t: '✅ Oui', d: 'cours_oui' }, { t: '❌ Non', d: 'cours_non' }, { t: '📅 Déplacé', d: 'cours_deplace' }],
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
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, { method: 'POST', body: form, headers: form.getHeaders() });
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
  const regles = `REGLES ABSOLUES:\n- Texte brut uniquement, ZERO LaTeX\n- Fractions: ecrire "3/4", puissances: "x^2", racines: "racine(9)"\n- Exercices numerotes clairement\n- Corrige complet apres "=== CORRIGE ==="\n- Adapte au programme officiel de ${profil.niveau} en France`;
  let prompt = '';
  if (profil.format === 'hebdo') {
    prompt = `Tu es professeur de mathematiques experimente. Cree une fiche hebdomadaire pour ${eleve}, eleve de ${profil.niveau}.\nChapitre: ${chapitre}\n${regles}\n${profil.note ? 'Note pedagogique: ' + profil.note : ''}\nFORMAT STRICT: LUNDI/MARDI/MERCREDI/JEUDI/VENDREDI avec 2 exercices chacun.\n=== CORRIGE ===\n[Corrige complet]`;
  } else if (profil.format === 'tda') {
    prompt = `Tu es professeur specialise TDA/TDAH. Cree une fiche pour ${eleve}, eleve de ${profil.niveau}.\nChapitre: ${chapitre}\n${regles}\n${profil.note ? 'Note pedagogique: ' + profil.note : ''}\nCONSIGNES: Maximum 4 exercices, 1 phrase par consigne.\n=== CORRIGE ===\n[Corrige complet]`;
  } else {
    prompt = `Tu es professeur de mathematiques experimente. Cree une fiche pour ${eleve}, eleve de ${profil.niveau}.\nChapitre: ${chapitre}\n${regles}\n${profil.note ? 'Note pedagogique: ' + profil.note : ''}\n4 a 5 exercices de difficulte progressive.\n=== CORRIGE ===\n[Corrige detaille]`;
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
  for (let i = 0; i < elevesDispo.length; i += 3)
    rows.push(elevesDispo.slice(i, i + 3).map(n => ({ t: n, d: `fiche_eleve_${n}` })));
  rows.push([{ t: '↩️ Annuler', d: 'fiche_annuler' }]);
  await sendBtns(chatId, '📚 *Génération de fiche*\n\nPour quel élève ?', rows);
}

// ============================================================
// CALCUL POTENTIEL RESTANT
// ============================================================
function calculerPotentielRestant(moisOffset, cours, coursManques) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const refDate = new Date(now.getFullYear(), now.getMonth() + moisOffset, 1);
  const annee = refDate.getFullYear();
  const mois = refDate.getMonth();
  const isCurrent = moisOffset === 0;
  const todayNum = isCurrent ? now.getDate() : 0;
  const dernierJour = new Date(annee, mois + 1, 0).getDate();

  const joursAvecCours = {};
  for (let d = 1; d <= dernierJour; d++) {
    const date = new Date(annee, mois, d);
    const jourSemaine = date.getDay();
    const elevesJour = [];
    for (const [nom, p] of Object.entries(ELEVES)) {
      if (p.jour !== jourSemaine) continue;
      if (p.uneSemaineSurDeux) {
        const ref = new Date('2026-05-10');
        const diff = Math.floor((date - ref) / (7 * 24 * 60 * 60 * 1000));
        if (diff % 2 !== 0) continue;
      }
      elevesJour.push(nom);
    }
    if (elevesJour.length > 0) joursAvecCours[d] = elevesJour;
  }

  let montantRestant = 0, joursRestantsCount = 0;
  const elevesRestants = {};
  const jourDepart = isCurrent ? todayNum + 1 : 1;
  for (let d = jourDepart; d <= dernierJour; d++) {
    if (joursAvecCours[d]) {
      joursAvecCours[d].forEach(nom => {
        const p = ELEVES[nom];
        if (p) {
          montantRestant += p.taux * p.duree;
          joursRestantsCount++;
          if (!elevesRestants[nom]) elevesRestants[nom] = 0;
          elevesRestants[nom]++;
        }
      });
    }
  }

  const calendrier = {};
  for (let d = 1; d <= dernierJour; d++) {
    calendrier[d] = {
      prevus: joursAvecCours[d] || [],
      estPasse: isCurrent ? d < todayNum : moisOffset < 0,
      estAujourdHui: isCurrent && d === todayNum,
      estFutur: isCurrent ? d > todayNum : false,
    };
  }

  return { montantRestant, joursRestantsCount, elevesRestants, calendrier, dernierJour, annee, mois };
}

// ============================================================
// DÉMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`L'Agent écoute sur le port ${PORT}`);
  await chargerConfig();
  await chargerElevesCustom();
  demarrerScheduler();
});

module.exports = app;
