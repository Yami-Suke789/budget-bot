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
  'Virement mere': 150, 'Place parking': 50, 'Malakoff mutuelle': 57.03,
  'ENI energie': 39.40, 'Bouygues mobile': 17.99, 'Bouygues box': 24,
  'Basic Fit': 22.99, 'Assurance habitation': 8.46, 'Assurance auto': 64.24,
  'Salle sport femme': 44, 'Canal+ frere': 13, 'Cours arabe': 31,
  'Claude.ai': 21.60, 'Helloasso': 12.55, 'Stripe asso': 10,
  'Disney+': 6.99, 'Crunchyroll': 8.99, 'Cotisation bancaire': 18.30,
};

// Prelevements avec flag suspendu
let PRELEVEMENTS_DATES = [
  { nom: 'Loyer',               montant: 832.46, jour: 1,    suspendu: false },
  { nom: 'Tontine 1',           montant: 500.00, jour: 1,    suspendu: false },
  { nom: 'Helloasso',           montant: 12.55,  jour: 1,    suspendu: false },
  { nom: 'Place parking',       montant: 50.00,  jour: 1,    suspendu: false },
  { nom: 'Salle sport femme',   montant: 44.00,  jour: 1,    suspendu: false },
  { nom: 'Cours arabe',         montant: 31.00,  jour: 3,    suspendu: false },
  { nom: 'Virement mere',       montant: 150.00, jour: 5,    suspendu: false },
  { nom: 'Assurance habitation',montant: 8.46,   jour: 7,    suspendu: false },
  { nom: 'ENI energie',         montant: 39.40,  jour: 7,    suspendu: false },
  { nom: 'Basic Fit',           montant: 22.99,  jour: 7,    suspendu: false },
  { nom: 'Malakoff mutuelle',   montant: 57.03,  jour: 9,    suspendu: false },
  { nom: 'Crunchyroll',         montant: 8.99,   jour: 13,   suspendu: false },
  { nom: 'Stripe asso',         montant: 10.00,  jour: 13,   suspendu: false },
  { nom: 'Tontine 2',           montant: 500.00, jour: 15,   suspendu: false },
  { nom: 'Bouygues mobile',     montant: 17.99,  jour: 17,   suspendu: false },
  { nom: 'Assurance auto',      montant: 64.24,  jour: 20,   suspendu: false },
  { nom: 'Disney+',             montant: 6.99,   jour: 22,   suspendu: false },
  { nom: 'Canal+ frere',        montant: 13.00,  jour: 24,   suspendu: false },
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
  essence:  { label: 'Essence',  max: 300 },
  courses:  { label: 'Courses',  max: 500 },
  restos:   { label: 'Restos',   max: 80  },
  sante:    { label: 'Sante',    max: 60  },
  maison:   { label: 'Maison',   max: 50  },
  voiture:  { label: 'Voiture',  max: 50  },
  shopping: { label: 'Shopping', max: 50  },
  loisirs:  { label: 'Loisirs',  max: 50  },
  divers:   { label: 'Divers',   max: 50  },
  Dyneos:   { label: 'Dyneos',   max: 300 },
};

const OBJECTIFS = [
  { label: 'Fin juin 2026', montant: 10000 },
  { label: 'Fin aout 2026', montant: 13000 },
  { label: 'Janvier 2027',  montant: 20000 },
];

// ============================================================
// VTC — CONSTANTES
// ============================================================
const OBJECTIF_VTC_MENSUEL = 3892;
const SEMAINES_PAR_MOIS = 4.357;
let VTC_CHARGES_FIXES = { 'Clicar': 167 }; // euros/semaine
const VTC_URSSAF_TAUX = 0.212; // 21.2%
let VTC_RATTACHEMENT_MENSUEL = 60; // euros/mois, tant que non auto-entrepreneur
let VTC_RATTACHEMENT_ACTIF = true; // tant que non auto-entrepreneur : true = rattachement, false = URSSAF
let VTC_OBJECTIF_HEBDO = 1000; // euros/semaine — objectif de CA net (le "CA" saisi = net perçu par course)
let VTC_ESSENCE_BASE_HEBDO = 60; // euros/semaine — minimum essence retenu dans le seuil, meme si non declaree cette semaine-la
const VTC_PLATEFORMES_VALIDES = ['uber', 'bolt', 'heetch', 'autre'];
const VTC_DEP_CATEGORIES = {
  essence:   { label: 'Essence' },
  nettoyage: { label: 'Nettoyage' },
  peage:     { label: 'Peage/Parking' },
  autre:     { label: 'Autre' },
};

// ============================================================
// EPARGNE — SOURCES (ledger de mouvements)
// ============================================================
const EPARGNE_SOURCES = {
  vtc:        { label: 'VTC',        color: '#F26419' },
  turo:       { label: 'Turo',       color: '#4ade80' },
  dyneos:     { label: 'Dyneos',     color: '#a78bfa' },
  completude: { label: 'Complétude', color: '#60a5fa' },
  autre:      { label: 'Autre',      color: '#8892a0' },
};

// ============================================================
// TURO — CONSTANTES
// ============================================================
const TURO_SPLIT_COUSIN = 0.50; // 50/50 sur le revenu net Turo (apres frais Turo)

const TURO_CATEGORIES = {
  assurance:  { label: 'Assurance',          recurrentDefaut: true  },
  ct:         { label: 'Controle technique', recurrentDefaut: false },
  reparation: { label: 'Reparation',         recurrentDefaut: false },
  entretien:  { label: 'Entretien/nettoyage',recurrentDefaut: false },
  equipement: { label: 'Equipement',         recurrentDefaut: false },
  autre:      { label: 'Autre',              recurrentDefaut: false },
};

const sessionsTuroDep = {};
const sessionsTuroLoc = {};

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
      console.log(`${data.length} eleves custom charges`);
    }
  } catch (err) {
    console.error('Erreur chargement eleves custom:', err.message);
  }
}

const sessions = {};
const sessionsFiches = {};
const sessionsAnnuler = {};
const sessionsModifier = {};
const sessionsAjoutEleve = {};
const sessionsRevenu = {};
const sessionsEpargne = {};
const sessionsModifConfig = {};
const sessionsModifPrel = {};
const sessionsInvest = {};
const sessionsVtc = {};
const sessionsVtcDep = {};

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
      if (row.cle.startsWith('vtc_charge_')) {
        const nom = row.cle.replace('vtc_charge_', '');
        VTC_CHARGES_FIXES[nom] = row.valeur;
      }
      if (row.cle === 'vtc_rattachement_mensuel') VTC_RATTACHEMENT_MENSUEL = row.valeur;
      if (row.cle === 'vtc_rattachement_actif') VTC_RATTACHEMENT_ACTIF = row.valeur === 1;
      if (row.cle === 'vtc_objectif_hebdo') VTC_OBJECTIF_HEBDO = row.valeur;
      if (row.cle === 'vtc_essence_base_hebdo') VTC_ESSENCE_BASE_HEBDO = row.valeur;
    });
    console.log('Config chargee depuis Supabase');
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

const TICKER_MAP = {
  'ISWD': 'ISWD.L',           // MSCI World Islamic (iShares, London)
  'HIEU': 'DE000SL0HH65.SG',  // MSCI Europe Islamic (HSBC, Stuttgart)
  'HIEM': 'HIEM.L',           // MSCI Emerging Markets Islamic (HSBC, London)
};

const MARKET_WATCHLIST = ['ISWD', 'HIEU', 'HIEM'];

async function getPrixActuelETF(ticker) {
  try {
    const symbol = TICKER_MAP[ticker] || ticker;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const prix = meta.regularMarketPrice;
    const ouverture = meta.chartPreviousClose || meta.previousClose;
    const variation = ouverture ? ((prix - ouverture) / ouverture * 100) : null;
    const currency = meta.currency || '';
    return prix ? {
      prix: parseFloat(prix.toFixed(4)),
      variation: variation ? parseFloat(variation.toFixed(2)) : null,
      currency,
      previousClose: ouverture ? parseFloat(ouverture.toFixed(4)) : null,
      marketState: meta.marketState || 'CLOSED',
    } : null;
  } catch (err) {
    console.error('getPrixActuelETF error:', err.message);
    return null;
  }
}

async function afficherPortefeuille(chatId) {
  const investissements = await getInvestissements();
  let msg = `Marche — Watchlist\n\n`;
  for (const ticker of MARKET_WATCHLIST) {
    const data = await getPrixActuelETF(ticker);
    if (data) {
      const varEmoji = data.variation === null ? '-' : data.variation >= 0 ? `+${data.variation}%` : `${data.variation}%`;
      const labels = { ISWD: 'MSCI World Islamic', HIEU: 'MSCI Europe Islamic', HIEM: 'MSCI EM Islamic' };
      msg += `*${ticker}* — ${labels[ticker] || ticker}\n`;
      msg += `Prix: *${data.prix} ${data.currency}* | ${varEmoji}\n\n`;
    }
  }
  if (investissements.length === 0) {
    msg += `_Portefeuille vide — /investir pour enregistrer un achat_`;
    await send(chatId, msg);
    return;
  }
  msg += `━━━━━━━━━━━━━━\nMon portefeuille\n\n`;
  const parTicker = {};
  investissements.forEach(inv => {
    if (!parTicker[inv.ticker]) parTicker[inv.ticker] = { montant_investi: 0, nb_parts: 0 };
    parTicker[inv.ticker].montant_investi += inv.montant;
    parTicker[inv.ticker].nb_parts += inv.nb_parts;
  });
  let totalInvesti = 0, totalActuel = 0;
  for (const [ticker, data] of Object.entries(parTicker)) {
    const marche = await getPrixActuelETF(ticker);
    const prixMoyen = data.montant_investi / data.nb_parts;
    totalInvesti += data.montant_investi;
    if (marche) {
      const valeur = marche.prix * data.nb_parts;
      const pv = valeur - data.montant_investi;
      const pvPct = (pv / data.montant_investi * 100);
      totalActuel += valeur;
      msg += `*${ticker}*\n`;
      msg += `Valeur: *${valeur.toFixed(0)}€* (${pv >= 0 ? '+' : ''}${pv.toFixed(0)}€ / ${pvPct >= 0 ? '+' : ''}${pvPct.toFixed(1)}%)\n`;
      msg += `Parts: ${data.nb_parts.toFixed(4)} | P. moyen: ${prixMoyen.toFixed(2)} | Actuel: ${marche.prix}\n\n`;
    } else {
      totalActuel += data.montant_investi;
      msg += `*${ticker}*: ${data.montant_investi.toFixed(0)}€ investi — cours indisponible\n\n`;
    }
  }
  if (Object.keys(parTicker).length > 1) {
    const pv = totalActuel - totalInvesti;
    msg += `━━━━━━━━━━━━━━\nTotal investi: *${totalInvesti.toFixed(0)}€*\n`;
    msg += `Valeur actuelle: *${totalActuel.toFixed(0)}€*\n`;
    msg += `+/-value: *${pv >= 0 ? '+' : ''}${pv.toFixed(0)}€*`;
  }
  await send(chatId, msg);
}

// ============================================================
// VTC
// ============================================================
function getTotalChargesFixesVtc() {
  return Object.values(VTC_CHARGES_FIXES).reduce((a, b) => a + b, 0);
}

function dureeHeuresVtc(heureDebut, heureFin) {
  const [h1, m1] = heureDebut.split(':').map(Number);
  const [h2, m2] = heureFin.split(':').map(Number);
  let minutes = (h2 * 60 + (m2 || 0)) - (h1 * 60 + (m1 || 0));
  if (minutes < 0) minutes += 24 * 60; // session passant minuit
  return minutes / 60;
}

async function saveVtcSession(chatId, s) {
  const { error } = await supabase.from('vtc_sessions').insert({
    chat_id: String(chatId),
    date: s.date,
    heure_debut: s.heureDebut,
    heure_fin: s.heureFin,
    plateforme: s.plateforme || 'autre',
    ca_net: s.caNet,
    nb_courses: s.nbCourses || 0,
  });
  if (error) { console.error('saveVtcSession error:', error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

async function saveVtcDepenseDiverse(chatId, montant, categorie, libelle) {
  const { error } = await supabase.from('vtc_depenses_diverses').insert({
    chat_id: String(chatId), montant, categorie, libelle,
  });
  if (error) { console.error('saveVtcDepenseDiverse error:', error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

async function saveMouvementEpargne(chatId, source, montant, type, note) {
  const { error } = await supabase.from('epargne_mouvements').insert({
    chat_id: String(chatId), source, montant, type, note: note || null,
  });
  if (error) { console.error('saveMouvementEpargne error:', error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// Calcule le solde ledger (somme des mouvements), la repartition par source,
// et une courbe quotidienne cumulee pour le mois selectionne.
function calculerEpargneLedger(mouvements, debutMoisISO, finMoisISO) {
  const bySource = {};
  Object.keys(EPARGNE_SOURCES).forEach(k => bySource[k] = 0);

  let soldeAvantMois = 0;
  let total = 0;
  mouvements.forEach(m => {
    const val = m.type === 'out' ? -m.montant : m.montant;
    total += val;
    if (bySource[m.source] !== undefined) bySource[m.source] += val;
    if (new Date(m.created_at) < new Date(debutMoisISO)) soldeAvantMois += val;
  });

  const mouvementsDuMois = mouvements.filter(m =>
    new Date(m.created_at) >= new Date(debutMoisISO) && new Date(m.created_at) < new Date(finMoisISO)
  );

  // Courbe jour par jour depuis le debut du mois jusqu'a aujourd'hui (ou fin du mois si mois passe)
  const debut = new Date(debutMoisISO);
  const finReelle = new Date(finMoisISO) < new Date() ? new Date(finMoisISO) : new Date();
  const nbJours = Math.max(1, Math.ceil((finReelle - debut) / 86400000));

  const courbe = [];
  let solde = soldeAvantMois;
  for (let j = 0; j <= nbJours; j++) {
    const jourDate = new Date(debut.getTime() + j * 86400000);
    mouvementsDuMois.forEach(m => {
      const mDate = new Date(m.created_at);
      if (mDate.getUTCFullYear() === jourDate.getUTCFullYear() &&
          mDate.getUTCMonth() === jourDate.getUTCMonth() &&
          mDate.getUTCDate() === jourDate.getUTCDate()) {
        solde += (m.type === 'out' ? -m.montant : m.montant);
      }
    });
    courbe.push({ jour: jourDate.getUTCDate(), solde: Math.round(solde) });
  }

  return { total: Math.round(total), bySource, mouvementsDuMois, courbe, soldeDebutMois: Math.round(soldeAvantMois) };
}

async function getDataVtc(chatId, moisOffset = 0) {
  const debut = getDebutMois(moisOffset);
  const fin = getFinMois(moisOffset);
  const { data, error } = await supabase.from('vtc_sessions').select('*')
    .eq('chat_id', chatId)
    .gte('created_at', debut).lt('created_at', fin);
  if (error) { console.error('getDataVtc error:', error.message); return null; }

  const { data: depData, error: depErr } = await supabase.from('vtc_depenses_diverses').select('*')
    .eq('chat_id', String(chatId))
    .gte('created_at', debut).lt('created_at', fin);
  if (depErr) console.error('getDataVtc depenses error:', depErr.message);

  const sessions = data || [];
  const depensesDiverses = depData || [];

  const caNet = sessions.reduce((s, x) => s + (Number(x.ca_net) || 0), 0);
  const heures = sessions.reduce((s, x) => s + dureeHeuresVtc(x.heure_debut, x.heure_fin), 0);
  const totalDepensesDiverses = depensesDiverses.reduce((s, x) => s + (Number(x.montant) || 0), 0);
  const chargesFixesHebdo = getTotalChargesFixesVtc() * SEMAINES_PAR_MOIS;

  // Rattachement (charge fixe mensuelle) OU URSSAF (% du CA net) — jamais les deux, pilote par un
  // toggle global en Config, independant des sessions individuelles (plus proche de la realite).
  const rattachement = VTC_RATTACHEMENT_ACTIF ? VTC_RATTACHEMENT_MENSUEL : 0;
  const urssaf = VTC_RATTACHEMENT_ACTIF ? 0 : caNet * VTC_URSSAF_TAUX;

  const net = caNet - totalDepensesDiverses - chargesFixesHebdo - urssaf - rattachement;

  return {
    sessions, depensesDiverses, caNet, totalDepensesDiverses, chargesFixesHebdo,
    urssaf, rattachement, net, heures,
    tauxHoraire: heures > 0 ? net / heures : 0,
  };
}

// Suivi hebdomadaire VTC : cumul du "CA" (= net percu, saisi par session) vs objectif de la
// semaine, avec les seuils de charges (location, rattachement, essence) qui determinent a partir
// de quel montant saisi on passe en net reel dans la poche.
async function getDataVtcSemaine(chatId, semaineOffset = 0) {
  const debut = getDebutSemaine(semaineOffset);
  const fin = getFinSemaine(semaineOffset);

  const { data, error } = await supabase.from('vtc_sessions').select('*')
    .eq('chat_id', String(chatId))
    .gte('created_at', debut).lt('created_at', fin);
  if (error) { console.error('getDataVtcSemaine error:', error.message); return null; }

  const { data: depData, error: depErr } = await supabase.from('vtc_depenses_diverses').select('*')
    .eq('chat_id', String(chatId))
    .gte('created_at', debut).lt('created_at', fin);
  if (depErr) console.error('getDataVtcSemaine depenses error:', depErr.message);

  const sessions = data || [];
  const depenses = depData || [];

  const caNet = sessions.reduce((s, x) => s + (Number(x.ca_net) || 0), 0);
  const heures = sessions.reduce((s, x) => s + dureeHeuresVtc(x.heure_debut, x.heure_fin), 0);
  const essenceDepensee = depenses.filter(x => x.categorie === 'essence').reduce((s, x) => s + (Number(x.montant) || 0), 0);
  const autresDepenses = depenses.filter(x => x.categorie !== 'essence').reduce((s, x) => s + (Number(x.montant) || 0), 0);

  const locationHebdo = getTotalChargesFixesVtc();
  const rattachementHebdo = VTC_RATTACHEMENT_ACTIF ? VTC_RATTACHEMENT_MENSUEL : 0;
  const essenceRetenue = Math.max(VTC_ESSENCE_BASE_HEBDO, essenceDepensee);
  const chargesTotales = locationHebdo + rattachementHebdo + essenceRetenue + autresDepenses;

  const net = caNet - chargesTotales;
  const projectionMensuelle = net * SEMAINES_PAR_MOIS;

  // Seuils cumulatifs (en € de CA saisi) a partir desquels chaque charge est couverte
  const seuils = [
    { label: 'Location',      montant: locationHebdo,    cumul: locationHebdo },
    { label: 'Rattachement',  montant: rattachementHebdo, cumul: locationHebdo + rattachementHebdo },
    { label: 'Essence',       montant: essenceRetenue,    cumul: locationHebdo + rattachementHebdo + essenceRetenue },
  ];

  return {
    sessions, depenses, caNet, heures,
    tauxHoraire: heures > 0 ? caNet / heures : 0,
    essenceDepensee, essenceRetenue, autresDepenses,
    locationHebdo, rattachementHebdo, chargesTotales,
    net, projectionMensuelle, seuils,
    objectif: VTC_OBJECTIF_HEBDO,
    debut, fin,
  };
}

async function resumeVtc(chatId) {
  const d = await getDataVtc(chatId, 0);
  if (!d || d.sessions.length === 0) { await send(chatId, 'Aucune session VTC ce mois.'); return; }
  const pct = Math.min(100, Math.round((d.net / OBJECTIF_VTC_MENSUEL) * 100));
  await send(chatId,
    `VTC — ${new Date().toLocaleString('fr-FR', { month: 'long' })}\n\n` +
    `CA net: *${d.caNet.toFixed(0)}€*\n` +
    `Depenses diverses: *${d.totalDepensesDiverses.toFixed(0)}€*\n` +
    `Charges fixes: *${d.chargesFixesHebdo.toFixed(0)}€*\n` +
    `URSSAF: *${d.urssaf.toFixed(0)}€* — Rattachement: *${d.rattachement.toFixed(0)}€*\n` +
    `— — —\n` +
    `Net reel: ${d.net.toFixed(0)}€\n` +
    `Heures: ${d.heures.toFixed(1)}h${d.heures > 0 ? ` — *${d.tauxHoraire.toFixed(1)}€/h*` : ''}\n` +
    `Objectif: ${OBJECTIF_VTC_MENSUEL}€ (${pct}%)`
  );
}

async function resumeVtcSemaine(chatId) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const jour = now.getDay();
  const diff = now.getDate() - jour + (jour === 0 ? -6 : 1);
  const lundi = new Date(now.getFullYear(), now.getMonth(), diff);
  const lundiISO = lundi.toISOString().slice(0, 10);

  const { data: sessions, error } = await supabase.from('vtc_sessions').select('*')
    .eq('chat_id', chatId).gte('date', lundiISO);
  if (error) { await send(chatId, 'Erreur de lecture des sessions VTC.'); return; }
  if (!sessions || sessions.length === 0) { await send(chatId, 'Aucune session VTC cette semaine.'); return; }

  const caNet = sessions.reduce((s, x) => s + Number(x.ca_net), 0);
  const heures = sessions.reduce((s, x) => s + dureeHeuresVtc(x.heure_debut, x.heure_fin), 0);
  const chargesFixes = getTotalChargesFixesVtc();
  const net = caNet - chargesFixes;
  const tauxHoraire = heures > 0 ? net / heures : 0;

  await send(chatId,
    `VTC — Semaine en cours\n\n` +
    `CA net: *${caNet.toFixed(0)}€*\n` +
    `Charges fixes (Clicar etc.): *${chargesFixes.toFixed(0)}€*\n` +
    `— — —\n` +
    `Net reel: ${net.toFixed(0)}€\n` +
    `Heures: ${heures.toFixed(1)}h${heures > 0 ? ` — *${tauxHoraire.toFixed(1)}€/h*` : ''}`
  );
}

const JOURS_VTC = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

async function resumeVtcTop(chatId) {
  const { data: sessions, error } = await supabase.from('vtc_sessions').select('*').eq('chat_id', chatId);
  if (error || !sessions || sessions.length === 0) {
    await send(chatId, 'Pas encore assez de donnees pour etablir un classement.');
    return;
  }

  const groupes = {};
  for (const s of sessions) {
    const jourSemaine = new Date(s.date).getDay();
    const heureDebut = parseInt(s.heure_debut.split(':')[0], 10);
    const tranche = Math.floor(heureDebut / 3) * 3;
    const cle = `${jourSemaine}_${tranche}`;
    if (!groupes[cle]) groupes[cle] = { jourSemaine, tranche, caTotal: 0, heuresTotal: 0, count: 0 };
    groupes[cle].caTotal += Number(s.ca_net);
    groupes[cle].heuresTotal += dureeHeuresVtc(s.heure_debut, s.heure_fin);
    groupes[cle].count += 1;
  }

  const classement = Object.values(groupes)
    .filter(g => g.heuresTotal > 0)
    .map(g => ({ ...g, tauxHoraire: g.caTotal / g.heuresTotal }))
    .sort((a, b) => b.tauxHoraire - a.tauxHoraire)
    .slice(0, 5);

  if (classement.length === 0) { await send(chatId, 'Pas encore assez de donnees pour etablir un classement.'); return; }

  const lignes = classement.map((g, i) =>
    `${i + 1}. ${JOURS_VTC[g.jourSemaine]} ${g.tranche}h-${g.tranche + 3}h — *${g.tauxHoraire.toFixed(1)}€/h* (${g.count} session${g.count > 1 ? 's' : ''})`
  );

  await send(chatId, `Top creneaux VTC\n\n${lignes.join('\n')}`);
}

async function ajouterChargeVtc(chatId, libelle, montant) {
  VTC_CHARGES_FIXES[libelle] = montant;
  await sauvegarderConfig(`vtc_charge_${libelle}`, montant);
}

// ============================================================
// TURO
// ============================================================
async function saveTuroDepense(chatId, montant, categorie, libelle, recurrent) {
  const { error } = await supabase.from('turo_depenses').insert({
    chat_id: String(chatId), montant, categorie, libelle, recurrent,
  });
  if (error) console.error('saveTuroDepense error:', error.message);
}

async function saveTuroLocation(chatId, s) {
  const revenuNet = s.revenuBrut - s.fraisTuro;
  const partCousin = revenuNet * TURO_SPLIT_COUSIN;
  const partMoi = revenuNet * (1 - TURO_SPLIT_COUSIN);
  const { error } = await supabase.from('turo_locations').insert({
    chat_id: String(chatId),
    locataire: s.locataire,
    date_debut: s.dateDebut,
    date_fin: s.dateFin,
    revenu_brut: s.revenuBrut,
    frais_turo: s.fraisTuro,
    revenu_net: revenuNet,
    part_cousin: partCousin,
    part_moi: partMoi,
  });
  if (error) console.error('saveTuroLocation error:', error.message);
  return { revenuNet, partCousin, partMoi };
}

// Version simplifiee utilisee par le flow Telegram /turo_location :
// seules 2 infos comptent — le revenu net percu et la part reversee au cousin.
// locataire et dates ne sont pas demandes (mis a defaut) car ils n'ont pas
// d'impact sur les calculs de rentabilite / dashboard.
async function saveTuroLocationSimple(chatId, revenuNet, partCousin) {
  const partMoi = revenuNet - partCousin;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from('turo_locations').insert({
    chat_id: String(chatId),
    locataire: 'N/A',
    date_debut: today,
    date_fin: today,
    revenu_brut: revenuNet,
    frais_turo: 0,
    revenu_net: revenuNet,
    part_cousin: partCousin,
    part_moi: partMoi,
  });
  if (error) console.error('saveTuroLocationSimple error:', error.message);
  return { revenuNet, partCousin, partMoi };
}

async function getDataTuro(chatId, moisOffset = 0) {
  const debut = getDebutMois(moisOffset);
  const fin = getFinMois(moisOffset);

  const { data: locations, error: e1 } = await supabase
    .from('turo_locations').select('*')
    .eq('chat_id', String(chatId))
    .gte('date_debut', debut.slice(0, 10)).lt('date_debut', fin.slice(0, 10));
  if (e1) console.error('getDataTuro locations error:', e1.message);

  const { data: depPonctuelles, error: e2 } = await supabase
    .from('turo_depenses').select('*')
    .eq('chat_id', String(chatId)).eq('recurrent', false)
    .gte('created_at', debut).lt('created_at', fin);
  if (e2) console.error('getDataTuro dep ponctuelles error:', e2.message);

  const { data: depRecurrentes, error: e3 } = await supabase
    .from('turo_depenses').select('*')
    .eq('chat_id', String(chatId)).eq('recurrent', true);
  if (e3) console.error('getDataTuro dep recurrentes error:', e3.message);

  const locs = locations || [];
  const depsPonct = depPonctuelles || [];
  const depsRecur = depRecurrentes || [];

  const revenuBrutTotal = locs.reduce((s, l) => s + (Number(l.revenu_brut) || 0), 0);
  const revenuNetTotal = locs.reduce((s, l) => s + (Number(l.revenu_net) || 0), 0);
  const partMoiTotal = locs.reduce((s, l) => s + (Number(l.part_moi) || 0), 0);
  const partCousinTotal = locs.reduce((s, l) => s + (Number(l.part_cousin) || 0), 0);

  const totalDepPonctuelles = depsPonct.reduce((s, d) => s + (Number(d.montant) || 0), 0);
  const totalDepRecurrentes = depsRecur.reduce((s, d) => s + (Number(d.montant) || 0), 0);
  const totalDepenses = totalDepPonctuelles + totalDepRecurrentes;

  // Rentabilite nette = ma part des locations - toutes mes depenses (je porte 100% des depenses)
  const rentabiliteNette = partMoiTotal - totalDepenses;

  const depParCategorie = {};
  Object.keys(TURO_CATEGORIES).forEach(k => depParCategorie[k] = 0);
  [...depsPonct, ...depsRecur].forEach(d => {
    if (depParCategorie[d.categorie] !== undefined) depParCategorie[d.categorie] += (Number(d.montant) || 0);
  });

  return {
    locations: locs, depensesPonctuelles: depsPonct, depensesRecurrentes: depsRecur,
    revenuBrutTotal, revenuNetTotal, partMoiTotal, partCousinTotal,
    totalDepPonctuelles, totalDepRecurrentes, totalDepenses,
    rentabiliteNette, depParCategorie,
  };
}

async function resumeTuro(chatId) {
  const d = await getDataTuro(chatId, 0);
  if (d.locations.length === 0 && d.totalDepenses === 0) {
    await send(chatId, 'Aucune activite Turo ce mois.');
    return;
  }
  let msg = `Turo — ${new Date().toLocaleString('fr-FR', { month: 'long' })}\n\n`;
  msg += `Locations: *${d.locations.length}*\n`;
  msg += `Revenu brut: *${d.revenuBrutTotal.toFixed(0)}€*\n`;
  msg += `Revenu net (apres frais Turo): *${d.revenuNetTotal.toFixed(0)}€*\n`;
  msg += `Ma part (50%): *${d.partMoiTotal.toFixed(0)}€*\n`;
  msg += `Part cousin (50%): *${d.partCousinTotal.toFixed(0)}€*\n`;
  msg += `— — —\n`;
  msg += `Depenses ponctuelles: *${d.totalDepPonctuelles.toFixed(0)}€*\n`;
  msg += `Depenses recurrentes (mensuel): *${d.totalDepRecurrentes.toFixed(0)}€*\n`;
  msg += `— — —\n`;
  msg += `Rentabilite nette (ma part - mes depenses): *${d.rentabiliteNette >= 0 ? '+' : ''}${d.rentabiliteNette.toFixed(0)}€*`;
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
function _minuitParisEnUTCJour(annee, mois, jour) {
  const dateParis = new Date(`${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}T00:00:00`);
  const utcMs = new Date(dateParis.toLocaleString('en-US', { timeZone: 'UTC' }));
  const parisMs = new Date(dateParis.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return new Date(dateParis.getTime() + (utcMs - parisMs)).toISOString();
}

function _minuitParisEnUTC(annee, mois) {
  return _minuitParisEnUTCJour(annee, mois, 1);
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

// Semaine ISO (lundi -> lundi suivant), fuseau Paris. semaineOffset=0 => semaine en cours.
function _lundiDeSemaine(now, semaineOffset) {
  const jour = now.getDay(); // 0 = dimanche ... 6 = samedi
  const diffLundi = (jour === 0 ? -6 : 1 - jour) + semaineOffset * 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffLundi);
}

function getDebutSemaine(semaineOffset = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const lundi = _lundiDeSemaine(now, semaineOffset);
  return _minuitParisEnUTCJour(lundi.getFullYear(), lundi.getMonth() + 1, lundi.getDate());
}

function getFinSemaine(semaineOffset = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const lundiSuivant = _lundiDeSemaine(now, semaineOffset + 1);
  return _minuitParisEnUTCJour(lundiSuivant.getFullYear(), lundiSuivant.getMonth() + 1, lundiSuivant.getDate());
}

async function getData(moisOffset = 0) {
  const debut = getDebutMois(moisOffset);
  const fin = getFinMois(moisOffset);

  const [d1, d2, d3, d4, d5, d6, d7] = await Promise.all([
    supabase.from('depenses').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('cours').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('cours_manques').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('revenus').select('*').gte('created_at', debut).lt('created_at', fin),
    supabase.from('salaires').select('*').gte('created_at', debut).lt('created_at', fin).order('created_at', { ascending: false }).limit(1),
    supabase.from('epargne').select('*').lt('created_at', fin).order('created_at', { ascending: false }).limit(1),
    supabase.from('epargne_mouvements').select('*').lt('created_at', fin).order('created_at', { ascending: true }),
  ]);

  const depenses = d1.data || [];
  const cours = d2.data || [];
  const coursManques = d3.data || [];
  const revenus = d4.data || [];
  const salaire = d5.data?.length > 0 ? d5.data[0].montant : SALAIRE_LGM_DEFAULT;
  const epargneBase = d6.data?.length > 0 ? d6.data[0].montant : EPARGNE_DEPART;
  const epargneLedger = calculerEpargneLedger(d7.data || [], debut, fin);

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

  // Turo et VTC — impactent le total revenus / solde global via leur net final
  const turo = await getDataTuro(CHAT_ID, moisOffset);
  const vtc = await getDataVtc(CHAT_ID, moisOffset);
  const turoNet = Number.isFinite(turo?.rentabiliteNette) ? turo.rentabiliteNette : 0;
  const vtcNet = Number.isFinite(vtc?.net) ? vtc.net : 0;

  const totalRevenus = salaire + BEAU_FRERE + completude + revenusSupp + turoNet + vtcNet;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const epargneEstimee = epargneBase + solde;

  return {
    depenses, cours, coursManques, revenus, totaux, detail, totalDep,
    completude, totalManque, revenusSupp, totalRevenus, solde,
    epargneEstimee, salaire, epargneBase, moisOffset, epargneLedger,
    chargesFixes: TOTAL_CHARGES_FIXES, turo, vtc, turoNet, vtcNet
  };
}

// ============================================================
// ALERTES DEPASSEMENT
// ============================================================
async function verifierAlertesBudget(chatId, totalDep) {
  const TOTAL_CHARGES_FIXES = getTotalChargesFixes();
  const totalGlobal = TOTAL_CHARGES_FIXES + totalDep;
  if (totalGlobal > SEUIL_ALERTE_TOTAL) {
    await send(chatId,
      `ALERTE — Seuil global depasse !\n\n` +
      `Fixes: *${TOTAL_CHARGES_FIXES.toFixed(0)}€* + Variables: *${totalDep.toFixed(0)}€* = *${totalGlobal.toFixed(0)}€*\n` +
      `Seuil: *${SEUIL_ALERTE_TOTAL}€* — Depassement: *+${(totalGlobal - SEUIL_ALERTE_TOTAL).toFixed(0)}€*`
    );
  } else if (totalDep > SEUIL_ALERTE_VARIABLE) {
    await send(chatId,
      `ALERTE — Depenses variables depassees !\n\n` +
      `Variables ce mois: *${totalDep.toFixed(0)}€* > seuil *${SEUIL_ALERTE_VARIABLE}€*\n` +
      `Depassement: *+${(totalDep - SEUIL_ALERTE_VARIABLE).toFixed(0)}€*`
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
  const gain_manque = ELEVES[eleve].taux * ELEVES[eleve].duree;
  const { error } = await supabase.from('cours_manques').insert({ eleve, gain_manque, chat_id: String(chatId), libelle: 'deplace' });
  if (error) console.error('saveCoursDeplace error:', error);
  return gain_manque;
}

async function saveDepense(chatId, montant, categorie, libelle) {
  const { error } = await supabase.from('depenses').insert({ montant, categorie, libelle, chat_id: String(chatId) });
  if (error) console.error('saveDepense error:', error);
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

async function sauvegarderSnapshotMensuel() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const mois = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data: existing } = await supabase.from('snapshots_mensuels').select('id').eq('mois', mois).limit(1);
  if (existing && existing.length > 0) { console.log(`Snapshot ${mois} deja existant, skip.`); return; }
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
    console.log(`Snapshot ${mois} sauvegarde`);
    await send(CHAT_ID, `Snapshot de ${mois} sauvegarde !\nSolde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€* — Epargne estimee: *${data.epargneEstimee.toFixed(0)}€*`);
  }
}

async function envoyerBilanMensuel(chatId) {
  const { data: snapshots } = await supabase.from('snapshots_mensuels').select('*').order('mois', { ascending: false }).limit(6);
  if (!snapshots || snapshots.length === 0) {
    await send(chatId, 'Aucun snapshot mensuel trouve.\n_Le premier sera cree automatiquement le dernier jour du mois._');
    return;
  }
  let msg = `Historique mensuel\n\n`;
  snapshots.forEach(s => {
    const d = s.donnees;
    msg += `*${s.mois}*\nSolde: *${d.solde >= 0 ? '+' : ''}${d.solde?.toFixed(0)}€*\n`;
    msg += `Completude: ${d.completude?.toFixed(0)}€ — ${d.nb_cours} cours\n`;
    msg += `Epargne fin de mois: ${d.epargne_estimee?.toFixed(0)}€\n\n`;
  });
  await send(chatId, msg);
}

async function afficherProgressionEpargne(chatId, montant) {
  let msg = `Epargne mise a jour : ${montant.toLocaleString('fr-FR')} €\n\nProgression vers tes objectifs :\n\n`;
  OBJECTIFS.forEach(o => {
    const delta = montant - o.montant;
    const pct = Math.min(100, Math.round((montant / o.montant) * 100));
    const barre = Math.round(pct / 10);
    const barreStr = '#'.repeat(barre) + '-'.repeat(10 - barre);
    msg += `*${o.label}* — ${o.montant.toLocaleString('fr-FR')} €\n`;
    msg += `\`${barreStr}\` ${pct}%\n`;
    msg += delta >= 0 ? `_+${delta.toFixed(0)} € au-dessus_\n\n` : `_Il manque ${Math.abs(delta).toFixed(0)} €_\n\n`;
  });
  await send(chatId, msg);
}

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
    `${n} (${e.niveau}, ${e.taux}€/h, ${e.duree}h, ${JOURS_NOMS[e.jour]} a ${e.heure}h${e.minute > 0 ? e.minute.toString().padStart(2,'0') : '00'})`
  ).join('\n');
  const budgetsInfo = Object.entries(BUDGETS).map(([k, b]) => `${b.label}: ${data.totaux[k]?.toFixed(0) || 0}€ / ${b.max}€`).join('\n');
  const objectifsInfo = OBJECTIFS.map(o => {
    const delta = data.epargneBase - o.montant;
    return `${o.label}: ${o.montant.toLocaleString()}€ (${delta >= 0 ? '+' : ''}${delta.toFixed(0)}€)`;
  }).join('\n');
  const prelevementsInfo = PRELEVEMENTS_DATES.filter(p => p.jour)
    .map(p => `${p.suspendu ? '[SUSPENDU] ' : ''}${p.nom}: ${p.montant}€ (le ${p.jour})`)
    .join('\n');

  const ctx = `Tu es L'Agent, assistant personnel intelligent de Nour-Dine.
Tu es direct, naturel, bienveillant et proactif.
Tu reponds a TOUTES les questions naturellement, pas seulement les commandes.
Tu analyses, tu conseilles, tu calcules si besoin.
Tu parles francais naturellement, jamais de JSON ni de balises techniques.
Max 6 lignes sauf si on te demande un detail complet.

=== SITUATION FINANCIERE ===
Salaire LGM: ${data.salaire}€
Beau-frere: ${BEAU_FRERE}€
Completude cours: ${data.completude.toFixed(0)}€ / ${OBJECTIF_COMPLETUDE}€
Revenus supplementaires: ${data.revenusSupp.toFixed(0)}€
Turo — ma part nette ce mois: ${data.turo.partMoiTotal.toFixed(0)}€ (depenses vehicule: ${data.turo.totalDepenses.toFixed(0)}€)
Total revenus: ${data.totalRevenus.toFixed(0)}€
Charges fixes totales: ${TOTAL_CHARGES_FIXES.toFixed(0)}€
Total depenses: ${data.totalDep.toFixed(0)}€
Solde du mois: ${data.solde.toFixed(0)}€
Epargne actuelle: ${data.epargneBase.toLocaleString()}€
Epargne estimee fin de mois: ${data.epargneEstimee.toFixed(0)}€

=== BUDGETS CE MOIS ===
${budgetsInfo}

=== ELEVES ACTIFS ===
${elevesInfo || 'Aucun eleve actif'}
Cours effectues ce mois: ${data.cours.length}
Cours manques ce mois: ${data.coursManques.length}
Manque a gagner: ${data.totalManque.toFixed(0)}€

=== PRELEVEMENTS ===
${prelevementsInfo}
Total charges fixes actives: ${TOTAL_CHARGES_FIXES.toFixed(0)}€/mois

=== OBJECTIFS EPARGNE ===
${objectifsInfo}

=== COMMANDES DISPONIBLES ===
/bilan /completude /objectifs /prelevements /config /ajouteleve /suspendre /reactiver /annuler /modifier /revenu /epargne /fiche /historique /vtc /vtc_bilan /turo_depense /turo_location /turo_bilan`;

  const result = await model.generateContent(ctx + '\n\nMessage de Nour-Dine: ' + message);
  return result.response.text();
}

// ============================================================
// DETECTION
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
  if (/\bdyneos\b/.test(t)) return 'Dyneos';
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
const NIVEAUX_VALIDES = ['CP', 'CE1', 'CE2', 'CM1', 'CM2', '6e', '5e', '4e', '3e', '2nde', '1ere', 'Terminale'];

async function resumeCompletude(chatId) {
  const data = await getData();
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - data.completude);
  const pct = Math.min(100, Math.round((data.completude / OBJECTIF_COMPLETUDE) * 100));
  await send(chatId,
    `Completude: *${data.completude.toFixed(0)}€* / ${OBJECTIF_COMPLETUDE}€ (${pct}%)\n` +
    `${manque > 0 ? `Il manque: *${manque.toFixed(0)}€*` : 'Objectif atteint !'}`
  );
}

// ============================================================
// AJOUT ELEVE — FLOW
// ============================================================
async function demarrerAjoutEleve(chatId) {
  sessionsAjoutEleve[chatId] = { etape: 'nom' };
  await send(chatId, `Ajouter un nouvel eleve\n\nEtape 1/7 — Quel est son prenom ?\n_Ex: Thomas, Marie..._`);
}

async function traiterAjoutEleve(chatId, texte) {
  const sess = sessionsAjoutEleve[chatId];
  if (!sess) return false;
  switch (sess.etape) {
    case 'nom': {
      const nom = texte.trim();
      if (nom.length < 2 || nom.length > 30) { await send(chatId, 'Prenom invalide. Reessaie (2-30 caracteres).'); return true; }
      if (ELEVES[nom]) { await send(chatId, `*${nom}* existe deja !`); delete sessionsAjoutEleve[chatId]; return true; }
      sess.nom = nom; sess.etape = 'niveau';
      const rows = [];
      for (let i = 0; i < NIVEAUX_VALIDES.length; i += 4)
        rows.push(NIVEAUX_VALIDES.slice(i, i+4).map(n => ({ t: n, d: `ae_niv_${n}` })));
      rows.push([{ t: 'Annuler', d: 'ae_annuler' }]);
      await sendBtns(chatId, `*${nom}*\n\nEtape 2/7 — Quel niveau ?`, rows);
      return true;
    }
    case 'taux': {
      const taux = parseFloat(texte.replace(',', '.'));
      if (isNaN(taux) || taux < 10 || taux > 100) { await send(chatId, 'Taux invalide (entre 10 et 100). Ex: *24.50*'); return true; }
      sess.taux = taux; sess.etape = 'duree';
      await sendBtns(chatId, `*${sess.nom}* — ${taux}€/h\n\nEtape 4/7 — Duree des seances ?`, [
        [{ t: '1h', d: 'ae_dur_1' }, { t: '1h30', d: 'ae_dur_1.5' }, { t: '2h', d: 'ae_dur_2' }],
        [{ t: 'Annuler', d: 'ae_annuler' }]
      ]);
      return true;
    }
    case 'heure': {
      const m = texte.match(/^(\d{1,2})h(\d{0,2})$/i);
      if (!m) { await send(chatId, 'Format invalide. Ex: *17h00* ou *9h30*'); return true; }
      const h = parseInt(m[1]), min = parseInt(m[2] || '0');
      if (h < 7 || h > 21 || min % 15 !== 0) { await send(chatId, 'Heure invalide (7h-21h, minutes multiples de 15). Ex: *17h00*'); return true; }
      sess.heure = h; sess.minute = min; sess.etape = 'options';
      await sendBtns(chatId,
        `*${sess.nom}* — ${JOURS_NOMS[sess.jour]} a ${h}h${min > 0 ? min.toString().padStart(2,'0') : '00'}\n\nEtape 7/7 — Options speciales ?\n_Coche/decoche, puis valide_`,
        [
          [{ t: 'TDA/TDAH', d: 'ae_opt_tda' }, { t: 'Fiche hebdo', d: 'ae_opt_hebdo' }],
          [{ t: '1 semaine/2', d: 'ae_opt_2sem' }, { t: 'Valider', d: 'ae_opt_valider' }],
          [{ t: 'Annuler', d: 'ae_annuler' }]
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

  if (data === 'ae_annuler') { delete sessionsAjoutEleve[chatId]; await send(chatId, 'Ajout d\'eleve annule.'); return; }

  if (data.startsWith('ae_niv_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.niveau = data.replace('ae_niv_', ''); sess.etape = 'taux';
    await send(chatId, `*${sess.nom}* — ${sess.niveau}\n\nEtape 3/7 — Quel taux horaire ?\n_Ex: 24.50_ (en euros)`);
    return;
  }

  if (data.startsWith('ae_dur_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.duree = parseFloat(data.replace('ae_dur_', '')); sess.etape = 'jour';
    const rows = JOURS_NOMS.map((j, i) => [{ t: j, d: `ae_jour_${i}` }]);
    rows.push([{ t: 'Annuler', d: 'ae_annuler' }]);
    await sendBtns(chatId, `*${sess.nom}* — ${sess.duree}h/seance\n\nEtape 5/7 — Quel jour ?`, rows);
    return;
  }

  if (data.startsWith('ae_jour_')) {
    const sess = sessionsAjoutEleve[chatId];
    if (!sess) return;
    sess.jour = parseInt(data.replace('ae_jour_', '')); sess.etape = 'heure';
    await send(chatId, `*${sess.nom}* — ${JOURS_NOMS[sess.jour]}\n\nEtape 6/7 — A quelle heure ?\n_Ex: 17h00, 9h30_`);
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
          `*${eleveData.nom}* ajoute avec succes !`,
          `${eleveData.niveau} — ${eleveData.taux}€/h — ${eleveData.duree}h/seance`,
          `${JOURS_NOMS[eleveData.jour]} a ${eleveData.heure}h${eleveData.minute > 0 ? eleveData.minute.toString().padStart(2,'0') : '00'}`,
          eleveData.tda ? 'TDA active' : null,
          eleveData.ficheHebdo ? 'Fiche hebdo' : null,
          eleveData.uneSemaineSurDeux ? '1 semaine/2' : null,
        ].filter(Boolean).join('\n');
        await send(chatId, resume);
      } else {
        await send(chatId, 'Erreur Supabase lors de l\'ajout.');
      }
      delete sessionsAjoutEleve[chatId];
      return;
    }
    if (opt === 'tda') sess.options.tda = !sess.options.tda;
    else if (opt === 'hebdo') sess.options.ficheHebdo = !sess.options.ficheHebdo;
    else if (opt === '2sem') sess.options.uneSemaineSurDeux = !sess.options.uneSemaineSurDeux;
    const tdaLabel   = `${sess.options.tda ? '[x]' : '[ ]'} TDA/TDAH`;
    const hebdoLabel = `${sess.options.ficheHebdo ? '[x]' : '[ ]'} Fiche hebdo`;
    const semLabel   = `${sess.options.uneSemaineSurDeux ? '[x]' : '[ ]'} 1 semaine/2`;
    await sendBtns(chatId, `*${sess.nom}* — Options speciales\n_Coche/decoche, puis valide_`, [
      [{ t: tdaLabel, d: 'ae_opt_tda' }, { t: hebdoLabel, d: 'ae_opt_hebdo' }],
      [{ t: semLabel, d: 'ae_opt_2sem' }, { t: 'Valider', d: 'ae_opt_valider' }],
      [{ t: 'Annuler', d: 'ae_annuler' }]
    ]);
    return;
  }

  if (data.startsWith('susp_')) {
    const nom = data.replace('susp_', '');
    const ok = await suspendreEleve(nom);
    await send(chatId, ok
      ? `*${nom}* suspendu.\nPlus de rappels automatiques, plus de cours enregistres.\n_/reactiver pour le remettre quand tu reprends._`
      : `Erreur lors de la suspension de ${nom}.`);
    return;
  }

  if (data.startsWith('react_')) {
    const nom = data.replace('react_', '');
    const ok = await reactiverEleve(nom);
    await send(chatId, ok ? `*${nom}* reactive !` : `Erreur lors de la reactivation de ${nom}.`);
    return;
  }

  if (data === 'cours_deplace') {
    const eleve = session.eleve;
    if (!eleve) return;
    const gain_manque = await saveCoursDeplace(chatId, eleve);
    await send(chatId, `Cours *${eleve}* marque comme *deplace*\n_Le cours sera rattrape ulterieurement. Pense a signaler le rattrapage !_`);
    if (session.fileAttente && session.fileAttente.length > 0) {
      const next = session.fileAttente[0];
      const reste = session.fileAttente.slice(1);
      sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
      await sendBtns(chatId, `Cours suivant — *${next}* — effectue ?`,
        [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
      );
    } else {
      delete sessions[chatId];
    }
    return;
  }

  if (data === 'cours_oui' || data === 'cours_non') {
    const eleve = session.eleve;
    if (!eleve) return;
    if (data === 'cours_non') {
      const gain_manque = await saveCoursManque(chatId, eleve);
      await send(chatId, `Cours ${eleve} non effectue\nManque a gagner: *-${gain_manque.toFixed(2)}€*`);
      if (session.fileAttente && session.fileAttente.length > 0) {
        const next = session.fileAttente[0];
        const reste = session.fileAttente.slice(1);
        sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
        await sendBtns(chatId, `Cours suivant — *${next}* — effectue ?`,
          [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
        );
      } else { delete sessions[chatId]; }
      return;
    }
    if (ELEVES[eleve].question2h) {
      sessions[chatId] = { ...session, etape: 'question2h' };
      await sendBtns(chatId, `Cours avec *${eleve}*\n\nC'etait la seance a 2h ?`, [
        [{ t: '2h (1ere seance)', d: 'h2' }, { t: '1h (seance suivante)', d: 'h1' }],
        [{ t: 'Annuler', d: 'annuler' }]
      ]);
    } else {
      const gain = await saveCours(chatId, eleve, ELEVES[eleve].duree, session.rattrapage || false);
      await send(chatId, `Cours ${eleve} enregistre ! *+${gain.toFixed(2)}€*`);
      await resumeCompletude(chatId);
      if (session.fileAttente && session.fileAttente.length > 0) {
        const next = session.fileAttente[0];
        const reste = session.fileAttente.slice(1);
        sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
        await sendBtns(chatId, `Cours suivant — *${next}* — effectue ?`,
          [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
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
    await send(chatId, `Cours ${eleve} enregistre ! *+${gain.toFixed(2)}€*`);
    await resumeCompletude(chatId);
    if (session.fileAttente && session.fileAttente.length > 0) {
      const next = session.fileAttente[0];
      const reste = session.fileAttente.slice(1);
      sessions[chatId] = { eleve: next, rattrapage: session.rattrapage, etape: 'confirmation', fileAttente: reste };
      await sendBtns(chatId, `Cours suivant — *${next}* — effectue ?`,
        [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
      );
    } else { delete sessions[chatId]; }
    return;
  }

  if (data.startsWith('cat_')) {
    const cat = data.replace('cat_', '');
    const montant = session.montant;
    if (!montant) return;
    await saveDepense(chatId, montant, cat, session.libelle || '');
    const newData = await getData();
    const restant = BUDGETS[cat].max - newData.totaux[cat];
    delete sessions[chatId];
    await send(chatId, `*${montant}€* — ${BUDGETS[cat].label}\nRestant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
    return;
  }

  if (data === 'annuler') {
    delete sessions[chatId]; delete sessionsEpargne[chatId];
    delete sessionsModifConfig[chatId]; delete sessionsModifPrel[chatId];
    await send(chatId, 'Action annulee.');
    return;
  }

  if (data.startsWith('fiche_eleve_')) {
    const eleve = data.replace('fiche_eleve_', '');
    sessionsFiches[chatId] = { eleve, etape: 'attente_chapitre' };
    await send(chatId, `Fiche pour *${eleve}*\n\nQuel chapitre ?\n_Ex: Fractions, Pythagore, Equations..._`);
    return;
  }
  if (data === 'fiche_annuler') { delete sessionsFiches[chatId]; await send(chatId, 'Generation de fiche annulee.'); return; }

  if (data === 'ann_cours_fait') {
    const rows = [];
    const noms = Object.keys(ELEVES);
    for (let i = 0; i < noms.length; i += 3) rows.push(noms.slice(i, i+3).map(n => ({ t: n, d: 'ann_cf_' + n })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    sessionsAnnuler[chatId] = { type: 'cours_fait' };
    await sendBtns(chatId, 'Quel cours effectue annuler ?', rows);
    return;
  }
  if (data === 'ann_cours_manque') {
    const rows = [];
    const noms = Object.keys(ELEVES);
    for (let i = 0; i < noms.length; i += 3) rows.push(noms.slice(i, i+3).map(n => ({ t: n, d: 'ann_cm_' + n })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quel cours manque annuler ?', rows);
    return;
  }
  if (data === 'ann_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: 'ann_dep_' + k })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quelle categorie de depense annuler ?', rows);
    return;
  }
  if (data === 'ann_revenu') {
    const debut = new Date(); debut.setUTCDate(1); debut.setUTCHours(0, 0, 0, 0);
    const { data: revenus } = await supabase.from('revenus').select('id, montant, libelle, created_at').gte('created_at', debut.toISOString()).order('created_at', { ascending: false }).limit(8);
    if (!revenus || revenus.length === 0) { await send(chatId, 'Aucun revenu enregistre ce mois.'); return; }
    const rows = revenus.map(r => {
      const date = new Date(r.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      return [{ t: `${r.montant}€ — ${(r.libelle || '?').slice(0, 20)} (${date})`, d: `ann_rev_id_${r.id}` }];
    });
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quel revenu annuler ?', rows);
    return;
  }
  if (data.startsWith('ann_rev_id_')) {
    const id = data.replace('ann_rev_id_', '');
    const { data: item } = await supabase.from('revenus').select('montant, libelle').eq('id', id).single();
    const { error } = await supabase.from('revenus').delete().eq('id', id);
    await send(chatId, !error && item ? `Revenu annule : *+${item.montant}€* — ${item.libelle || '?'}` : 'Erreur lors de la suppression.');
    return;
  }
  if (data.startsWith('ann_cf_')) {
    const eleve = data.replace('ann_cf_', '');
    const ok = await annulerDernierCours(eleve);
    delete sessionsAnnuler[chatId];
    if (ok) { await send(chatId, `Dernier cours de *${eleve}* annule !`); await resumeCompletude(chatId); }
    else await send(chatId, `Aucun cours trouve pour *${eleve}* ce mois.`);
    return;
  }
  if (data.startsWith('ann_cm_')) {
    const eleve = data.replace('ann_cm_', '');
    const ok = await annulerDernierCoursManque(eleve);
    delete sessionsAnnuler[chatId];
    if (ok) await send(chatId, `Dernier cours manque de *${eleve}* annule !`);
    else await send(chatId, `Aucun cours manque trouve pour *${eleve}* ce mois.`);
    return;
  }
  if (data.startsWith('ann_dep_')) {
    const cat = data.replace('ann_dep_', '');
    const item = await annulerDerniereDepense(cat);
    if (item) await send(chatId, `Depense annulee : *${item.montant} €* — ${BUDGETS[cat].label}\n_${item.libelle || ''}_`);
    else await send(chatId, `Aucune depense trouvee pour ${BUDGETS[cat].label} ce mois.`);
    return;
  }

  if (data === 'mod_budget') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3)
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label + ' (' + b.max + '€)', d: 'mod_bud_' + k })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quel budget modifier ?', rows);
    return;
  }
  if (data === 'mod_depense') {
    const cats = Object.entries(BUDGETS);
    const rows = [];
    for (let i = 0; i < cats.length; i += 3)
      rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: 'mod_dep_' + k })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Rectifier quelle categorie de depense ?', rows);
    return;
  }
  if (data.startsWith('mod_bud_')) {
    const cat = data.replace('mod_bud_', '');
    sessionsModifier[chatId] = { etape: 'attente_montant_budget', categorie: cat };
    await send(chatId, `Budget *${BUDGETS[cat].label}* actuel : *${BUDGETS[cat].max} €*\n\nEnvoie le nouveau plafond mensuel (ex: *400*)`);
    return;
  }
  if (data.startsWith('mod_dep_')) {
    const cat = data.replace('mod_dep_', '');
    sessionsModifier[chatId] = { etape: 'attente_rectif_depense', categorie: cat };
    await send(chatId, `Rectifier la derniere depense *${BUDGETS[cat].label}*\n\nEnvoie le montant correct (ex: *45*)`);
    return;
  }

  if (data === 'cfg_salaire') { sessionsModifConfig[chatId] = { champ: 'salaire' }; await send(chatId, `Salaire LGM actuel : ${SALAIRE_LGM_DEFAULT}€\n\nEnvoie le nouveau montant :`); return; }
  if (data === 'cfg_beaufre') { sessionsModifConfig[chatId] = { champ: 'beaufre' }; await send(chatId, `Beau-frere actuel : ${BEAU_FRERE}€\n\nEnvoie le nouveau montant :`); return; }
  if (data === 'cfg_objectif') { sessionsModifConfig[chatId] = { champ: 'objectif' }; await send(chatId, `Objectif Completude actuel : ${OBJECTIF_COMPLETUDE}€\n\nEnvoie le nouveau montant mensuel cible :`); return; }
  if (data === 'cfg_charges') {
    const items = Object.entries(CHARGES_FIXES);
    const rows = [];
    for (let i = 0; i < items.length; i += 2)
      rows.push(items.slice(i, i+2).map(([k, v]) => ({ t: `${k} (${v}€)`, d: `cfg_chg_${k}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quelle charge fixe modifier ?', rows);
    return;
  }
  if (data.startsWith('cfg_chg_')) {
    const nom = data.replace('cfg_chg_', '');
    sessionsModifConfig[chatId] = { champ: 'charge', nom };
    await send(chatId, `*${nom}* — montant actuel : *${CHARGES_FIXES[nom]}€*\n\nEnvoie le nouveau montant :`);
    return;
  }

  if (data === 'prel_suspendre') {
    const actifs = PRELEVEMENTS_DATES.filter(p => !p.suspendu && p.jour);
    const rows = [];
    for (let i = 0; i < actifs.length; i += 2)
      rows.push(actifs.slice(i, i+2).map(p => ({ t: `${p.nom} (${p.montant}€)`, d: `prel_susp_${p.nom}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quel prelevement suspendre ?', rows);
    return;
  }
  if (data === 'prel_reactiver') {
    const suspendus = PRELEVEMENTS_DATES.filter(p => p.suspendu);
    if (suspendus.length === 0) { await send(chatId, 'Aucun prelevement suspendu.'); return; }
    const rows = [];
    for (let i = 0; i < suspendus.length; i += 2)
      rows.push(suspendus.slice(i, i+2).map(p => ({ t: `${p.nom} (${p.montant}€)`, d: `prel_react_${p.nom}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quel prelevement reactiver ?', rows);
    return;
  }
  if (data === 'prel_modifier') {
    const rows = [];
    for (let i = 0; i < PRELEVEMENTS_DATES.length; i += 2)
      rows.push(PRELEVEMENTS_DATES.slice(i, i+2).map(p => ({ t: `${p.suspendu ? '[susp] ' : ''}${p.nom} (${p.montant}€)`, d: `prel_mod_${p.nom}` })));
    rows.push([{ t: 'Retour', d: 'annuler' }]);
    await sendBtns(chatId, 'Quel prelevement modifier ?', rows);
    return;
  }
  if (data.startsWith('prel_susp_')) {
    const nom = data.replace('prel_susp_', '');
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (p) { p.suspendu = true; CHARGES_FIXES[nom] = 0; }
    await sauvegarderConfig(`prel_suspendu_${nom}`, 1);
    await send(chatId, `*${nom}* suspendu — ${p?.montant.toFixed(2) || '?'}€ retires des charges fixes.\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegarde ✓_`);
    return;
  }
  if (data.startsWith('prel_react_')) {
    const nom = data.replace('prel_react_', '');
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (p) { p.suspendu = false; CHARGES_FIXES[nom] = p.montant; }
    await sauvegarderConfig(`prel_suspendu_${nom}`, 0);
    await send(chatId, `*${nom}* reactive — *${p?.montant.toFixed(2) || '?'}€* de nouveau dans les charges.\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegarde ✓_`);
    return;
  }
  if (data.startsWith('prel_mod_')) {
    const nom = data.replace('prel_mod_', '');
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (!p) return;
    sessionsModifPrel[chatId] = { nom, etape: 'choix_champ' };
    await sendBtns(chatId,
      `*${nom}*\nMontant actuel: *${p.montant}€* | Jour: *le ${p.jour || '?'}*\n\nQue veux-tu modifier ?`,
      [[{ t: 'Montant', d: 'prel_chg_montant' }, { t: 'Jour', d: 'prel_chg_jour' }], [{ t: 'Annuler', d: 'annuler' }]]
    );
    return;
  }
  if (data === 'prel_chg_montant') {
    const sess = sessionsModifPrel[chatId];
    if (!sess) return;
    sess.etape = 'attente_montant';
    await send(chatId, `Nouveau montant pour *${sess.nom}* (actuel: ${PRELEVEMENTS_DATES.find(p=>p.nom===sess.nom)?.montant}€) :`);
    return;
  }
  if (data === 'prel_chg_jour') {
    const sess = sessionsModifPrel[chatId];
    if (!sess) return;
    sess.etape = 'attente_jour';
    await send(chatId, `Nouveau jour de prelevement pour *${sess.nom}* (1-31) :`);
    return;
  }

  if (data.startsWith('vtc_dep_cat_')) {
    const cat = data.replace('vtc_dep_cat_', '');
    sessionsVtcDep[chatId] = { etape: 'montant', categorie: cat };
    await send(chatId, `*${VTC_DEP_CATEGORIES[cat].label}*\n\nMontant ? (ex: *40*)`);
    return;
  }

  if (data.startsWith('turo_dep_cat_')) {
    const cat = data.replace('turo_dep_cat_', '');
    sessionsTuroDep[chatId] = { etape: 'montant', categorie: cat };
    await send(chatId, `*${TURO_CATEGORIES[cat].label}*\n\nMontant ? (ex: *90*)`);
    return;
  }
  if (data === 'turo_recur_oui' || data === 'turo_recur_non') {
    const sess = sessionsTuroDep[chatId];
    if (!sess) return;
    const recurrent = data === 'turo_recur_oui';
    await saveTuroDepense(chatId, sess.montant, sess.categorie, sess.libelle || '', recurrent);
    delete sessionsTuroDep[chatId];
    await send(chatId, `Depense vehicule enregistree : *${sess.montant}€* — ${TURO_CATEGORIES[sess.categorie].label}${recurrent ? ' (mensuelle)' : ''}`);
    return;
  }

  if (data.startsWith('rev_type_')) {
    const type = data.replace('rev_type_', '');
    if (type === '__autre__') {
      sessionsRevenu[chatId] = { type: null, etape: 'libelle_custom' };
      await send(chatId, `Autre revenu\n\nDonne un libelle court pour cette rentree :`);
    } else {
      sessionsRevenu[chatId] = { type, etape: 'montant' };
      await send(chatId, `*${type}*\n\nMontant recu ? (ex: *150*)`);
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
        `Salut Nour-Dine ! Je suis L'Agent.\n\n` +
        `"j'ai fait cours avec Margaux" → signaler un cours\n` +
        `"j'ai fait le plein pour 60€" → depense\n` +
        `/epargne → mettre a jour ton epargne\n` +
        `/investir → enregistrer un achat ETF/or\n` +
        `/portefeuille → voir ton portefeuille\n` +
        `/vtc → enregistrer une session VTC\n` +
        `/vtc_bilan → bilan VTC du mois\n` +
        `/vtc_semaine → bilan VTC de la semaine\n` +
        `/vtc_top → meilleurs creneaux VTC\n` +
        `/vtc_depense → depense diverse (essence, nettoyage...)\n` +
        `/turo_depense → enregistrer une depense vehicule\n` +
        `/turo_location → enregistrer une location Turo\n` +
        `/turo_bilan → bilan Turo du mois\n` +
        `/ajouteleve → nouvel eleve\n` +
        `/suspendre → mettre un eleve en pause\n` +
        `/reactiver → reactiver un eleve suspendu\n` +
        `/revenu → enregistrer une rentree\n` +
        `/prelevements → voir ce qui arrive\n` +
        `/config → modifier salaire, charges, prelevements\n` +
        `/historique → bilan des mois precedents\n` +
        `Dashboard: https://budget-bot-1ohb.onrender.com/dashboard`
      );
      return;
    }

    if (texte === '/reset') { delete sessions[chatId]; await send(chatId, 'Conversation reinitialisee !'); return; }
    if (texte === '/fiche') { await demarrerFiche(chatId); return; }

    if (texte === '/ajouteleve' || texte === '/ajouter' || /ajouter?\s+[ée]l[eè]ve/i.test(texte)) {
      await demarrerAjoutEleve(chatId);
      return;
    }

    if (texte === '/config') {
      await sendBtns(chatId, 'Configuration — Que veux-tu modifier ?', [
        [{ t: 'Salaire LGM', d: 'cfg_salaire' }, { t: 'Beau-frere', d: 'cfg_beaufre' }],
        [{ t: 'Objectif Completude', d: 'cfg_objectif' }, { t: 'Charges fixes', d: 'cfg_charges' }],
        [{ t: 'Prelevements', d: 'mod_prelevements' }],
        [{ t: 'Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/gererprelevements' || texte === '/gerer') {
      await sendBtns(chatId, 'Gerer les prelevements', [
        [{ t: 'Suspendre', d: 'prel_suspendre' }, { t: 'Reactiver', d: 'prel_reactiver' }],
        [{ t: 'Modifier montant/jour', d: 'prel_modifier' }],
        [{ t: 'Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/suspendre' || texte === '/archiveleve') {
      const actifs = Object.keys(ELEVES);
      if (actifs.length === 0) { await send(chatId, 'Aucun eleve actif.'); return; }
      const rows = [];
      for (let i = 0; i < actifs.length; i += 3)
        rows.push(actifs.slice(i, i+3).map(n => ({ t: n, d: `susp_${n}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      await sendBtns(chatId, 'Quel eleve suspendre ?\n_Il pourra etre reactive avec /reactiver._', rows);
      return;
    }

    if (texte === '/reactiver') {
      const { data: suspendus } = await supabase.from('eleves_custom').select('nom').eq('actif', false);
      if (!suspendus || suspendus.length === 0) { await send(chatId, 'Aucun eleve suspendu en ce moment.'); return; }
      const rows = [];
      for (let i = 0; i < suspendus.length; i += 3)
        rows.push(suspendus.slice(i, i+3).map(e => ({ t: e.nom, d: `react_${e.nom}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      await sendBtns(chatId, 'Quel eleve reactiver ?', rows);
      return;
    }

    if (texte === '/historique') { await envoyerBilanMensuel(chatId); return; }
    if (texte === '/snapshot') { await send(chatId, 'Sauvegarde du snapshot en cours...'); await sauvegarderSnapshotMensuel(); return; }

    if (texte === '/portefeuille' || texte === '/invest' || texte === '/portfolio') {
      await afficherPortefeuille(chatId);
      return;
    }

    if (texte === '/investir') {
      sessionsInvest[chatId] = { etape: 'montant_dca' };
      await send(chatId, 'Montant total investi (EUR) ?\nRepartition automatique : 65% ISWD (World) - 25% HIEU (Europe) - 10% HIEM (Emergents)\n_Ex: 100_');
      return;
    }

    if (texte === '/vtc') {
      sessionsVtc[chatId] = { etape: 'date', plateforme: 'autre' };
      await send(chatId, 'Nouvelle session VTC\n\nDate ? (JJ/MM ou "ajd")');
      return;
    }

    if (texte === '/vtc_bilan' || texte === '/vtc_mois') { await resumeVtc(chatId); return; }
    if (texte === '/vtc_semaine') { await resumeVtcSemaine(chatId); return; }
    if (texte === '/vtc_top') { await resumeVtcTop(chatId); return; }

    if (texte === '/vtc_depense' || texte === '/vtcdep') {
      const cats = Object.entries(VTC_DEP_CATEGORIES);
      const rows = [];
      for (let i = 0; i < cats.length; i += 2)
        rows.push(cats.slice(i, i + 2).map(([k, c]) => ({ t: c.label, d: `vtc_dep_cat_${k}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      await sendBtns(chatId, 'Nouvelle depense diverse (essence, nettoyage...)\n\nCategorie ?', rows);
      return;
    }

    if (texte.startsWith('/vtc_charge')) {
      const args = texte.split(' ').slice(1);
      if (args.length < 2) {
        await send(chatId, 'Usage : /vtc_charge [libelle] [montant hebdo]\nEx: /vtc_charge Clicar 167');
        return;
      }
      const montant = parseFloat(args[args.length - 1].replace(',', '.'));
      const libelle = args.slice(0, -1).join(' ');
      if (isNaN(montant) || montant <= 0) { await send(chatId, 'Montant invalide.'); return; }
      await ajouterChargeVtc(chatId, libelle, montant);
      await send(chatId, `Charge VTC ajoutee : *${libelle}* — ${montant}€/semaine\n_Total charges fixes: *${getTotalChargesFixesVtc().toFixed(0)}€/semaine*_`);
      return;
    }

    if (texte === '/turo_depense' || texte === '/turodep') {
      const cats = Object.entries(TURO_CATEGORIES);
      const rows = [];
      for (let i = 0; i < cats.length; i += 2)
        rows.push(cats.slice(i, i + 2).map(([k, c]) => ({ t: c.label, d: `turo_dep_cat_${k}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      sessionsTuroDep[chatId] = { etape: 'categorie' };
      await sendBtns(chatId, 'Nouvelle depense vehicule\n\nCategorie ?', rows);
      return;
    }

    if (texte === '/turo_location' || texte === '/turoloc') {
      sessionsTuroLoc[chatId] = { etape: 'revenu_net' };
      await send(chatId, 'Nouvelle location Turo\n\nRevenu net percu ? (ex: 130)');
      return;
    }

    if (texte === '/turo_bilan' || texte === '/turo') { await resumeTuro(chatId); return; }

    if (texte === '/epargne') {
      const data = await getData();
      sessionsEpargne[chatId] = { etape: 'saisie' };
      await send(chatId, `Mise a jour epargne\n\nActuelle en base : *${data.epargneBase.toLocaleString('fr-FR')} €*\n\nEnvoie le nouveau montant total de ton epargne :\n_Ex: 9500_`);
      return;
    }

    if (texte === '/revenu' || texte === '/revenus') {
      await sendBtns(chatId, 'Quel type de rentree d\'argent ?', [
        [{ t: 'Vinted / vente', d: 'rev_type_Vente Vinted' }, { t: 'Remboursement', d: 'rev_type_Remboursement' }],
        [{ t: 'Cadeau / don',   d: 'rev_type_Cadeau' },       { t: 'Autre',         d: 'rev_type___autre__' }],
        [{ t: 'Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (texte === '/prelevements' || texte === '/prélèvements') {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
      const aujourd = now.getDate();
      const aVenir7j = getPrelEvementsAVenir(7);
      const totalRestant = getTotalPrelevementsRestants();
      const suspendus = PRELEVEMENTS_DATES.filter(p => p.suspendu);
      let msg = `Prelevements — Suivi du mois\n\nNous sommes le *${aujourd}*\n`;
      msg += `Total charges actives: *${getTotalChargesFixes().toFixed(2)}€/mois*\n`;
      msg += `Restant ce mois: *${totalRestant.toFixed(2)}€*\n`;
      if (suspendus.length > 0) { msg += `\nSuspendus (${suspendus.length}): ${suspendus.map(p => p.nom).join(', ')}\n`; }
      if (aVenir7j.length > 0) {
        msg += `\nDans les 7 prochains jours:\n`;
        aVenir7j.forEach(p => {
          const quand = p.dansJours === 0 ? 'Aujourd\'hui' : p.dansJours === 1 ? 'Demain' : `Dans ${p.dansJours}j`;
          msg += `• ${quand} (${p.jourEffectif}) — ${p.nom}: *${p.montant.toFixed(2)}€*\n`;
        });
        msg += `\nTotal cette semaine: *${aVenir7j.reduce((s, p) => s + p.montant, 0).toFixed(2)}€*\n`;
      } else { msg += `\nAucun prelevement dans les 7 prochains jours\n`; }
      msg += `\n_Gerer: /gererprelevements_`;
      await send(chatId, msg);
      return;
    }

    if (texte === '/modifier' || texte === 'mod_prelevements') {
      await sendBtns(chatId, 'Que veux-tu modifier ?', [
        [{ t: 'Un budget categorie', d: 'mod_budget' }],
        [{ t: 'Rectifier une depense', d: 'mod_depense' }],
        [{ t: 'Prelevements', d: 'mod_prelevements' }],
        [{ t: 'Annuler', d: 'annuler' }]
      ]);
      return;
    }

    if (sessionsModifPrel[chatId]?.etape === 'attente_montant') {
      const sess = sessionsModifPrel[chatId];
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, 'Montant invalide.'); return; }
      const p = PRELEVEMENTS_DATES.find(p => p.nom === sess.nom);
      if (p) { p.montant = montant; CHARGES_FIXES[p.nom] = montant; await sauvegarderConfig(`prel_montant_${p.nom}`, montant); }
      delete sessionsModifPrel[chatId];
      await send(chatId, `*${sess.nom}* mis a jour : *${montant}€*\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegarde ✓_`);
      return;
    }

    if (sessionsModifPrel[chatId]?.etape === 'attente_jour') {
      const sess = sessionsModifPrel[chatId];
      const jour = parseInt(texte);
      if (isNaN(jour) || jour < 1 || jour > 31) { await send(chatId, 'Jour invalide (1-31).'); return; }
      const p = PRELEVEMENTS_DATES.find(p => p.nom === sess.nom);
      if (p) { p.jour = jour; await sauvegarderConfig(`prel_jour_${p.nom}`, jour); }
      delete sessionsModifPrel[chatId];
      await send(chatId, `*${sess.nom}* — nouveau jour : *le ${jour}* — Sauvegarde ✓`);
      return;
    }

    if (sessionsModifConfig[chatId]) {
      const sess = sessionsModifConfig[chatId];
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, 'Montant invalide. Ex: *2500*'); return; }
      let msg = '';
      if (sess.champ === 'salaire') { SALAIRE_LGM_DEFAULT = montant; await sauvegarderConfig('salaire_lgm', montant); msg = `Salaire LGM mis a jour : *${montant}€/mois*\n_Sauvegarde en base ✓_`; }
      else if (sess.champ === 'beaufre') { BEAU_FRERE = montant; await sauvegarderConfig('beau_frere', montant); msg = `Revenu beau-frere mis a jour : *${montant}€/mois*\n_Sauvegarde en base ✓_`; }
      else if (sess.champ === 'objectif') { OBJECTIF_COMPLETUDE = montant; await sauvegarderConfig('objectif_completude', montant); msg = `Objectif Completude mis a jour : *${montant}€/mois*\n_Sauvegarde en base ✓_`; }
      else if (sess.champ === 'charge') {
        const nom = sess.nom; const ancien = CHARGES_FIXES[nom];
        CHARGES_FIXES[nom] = montant;
        const prel = PRELEVEMENTS_DATES.find(p => p.nom === nom);
        if (prel) prel.montant = montant;
        await sauvegarderConfig(`prel_montant_${nom}`, montant);
        msg = `*${nom}* : ${ancien}€ → *${montant}€*\n_Total charges: *${getTotalChargesFixes().toFixed(2)}€* — Sauvegarde ✓_`;
      }
      delete sessionsModifConfig[chatId];
      await send(chatId, msg);
      return;
    }

    if (sessionsInvest[chatId]?.etape === 'montant_dca') {
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, 'Montant invalide. Ex: *100*'); return; }
      delete sessionsInvest[chatId];
      await send(chatId, 'Repartition en cours...');
      const parts = [
        { ticker: 'ISWD', pct: 0.65 },
        { ticker: 'HIEU', pct: 0.25 },
        { ticker: 'HIEM', pct: 0.10 },
      ];
      let recap = '';
      for (const p of parts) {
        const m = montant * p.pct;
        const marche = await getPrixActuelETF(p.ticker);
        if (marche && marche.prix) {
          await saveInvestissement(chatId, p.ticker, m, marche.prix);
          recap += `${p.ticker}: *${m.toFixed(2)}EUR* @ ${marche.prix}${marche.currency}\n`;
        } else {
          recap += `${p.ticker}: echec recuperation du prix, reessaie\n`;
        }
      }
      await send(chatId, `DCA enregistre — *${montant}EUR* repartis :\n${recap}\n_/portefeuille pour voir ta situation complete_`);
      return;
    }

    if (sessionsVtc[chatId]) {
      const sess = sessionsVtc[chatId];
      if (sess.etape === 'date') {
        sess.date = texte.toLowerCase() === 'ajd'
          ? new Date().toISOString().slice(0, 10)
          : (() => { const [j, m] = texte.split('/').map(Number); return `${new Date().getFullYear()}-${String(m).padStart(2,'0')}-${String(j).padStart(2,'0')}`; })();
        sess.etape = 'heure_debut';
        await send(chatId, 'Heure de debut ? (ex: 18:00)');
        return;
      }
      if (sess.etape === 'heure_debut') {
        if (!/^\d{1,2}:\d{2}$/.test(texte)) { await send(chatId, 'Format invalide. Ex: *18:00*'); return; }
        sess.heureDebut = texte; sess.etape = 'heure_fin';
        await send(chatId, 'Heure de fin ?');
        return;
      }
      if (sess.etape === 'heure_fin') {
        if (!/^\d{1,2}:\d{2}$/.test(texte)) { await send(chatId, 'Format invalide. Ex: *01:00*'); return; }
        sess.heureFin = texte; sess.etape = 'ca_net';
        await send(chatId, 'CA net (celui affiche sur Uber/Bolt) (€) ?');
        return;
      }
      if (sess.etape === 'ca_net') {
        const ca = parseFloat(texte.replace(',', '.'));
        if (isNaN(ca) || ca <= 0) { await send(chatId, 'Montant invalide.'); return; }
        sess.caNet = ca; sess.etape = 'nb_courses';
        await send(chatId, 'Nombre de courses ? ("skip" pour passer)');
        return;
      }
      if (sess.etape === 'nb_courses') {
        sess.nbCourses = texte === 'skip' ? null : parseInt(texte, 10);
        const result = await saveVtcSession(chatId, sess);
        delete sessionsVtc[chatId];
        if (!result.ok) {
          await send(chatId, `Erreur lors de l'enregistrement : ${result.error}\nVerifie que la table vtc_sessions a bien les colonnes ca_net et plateforme (pas ca_brut obligatoire).`);
          return;
        }
        const heures = dureeHeuresVtc(sess.heureDebut, sess.heureFin);
        await send(chatId,
          `Session VTC enregistree\n\n` +
          `CA net: *${sess.caNet}€*\n` +
          `Duree: *${heures.toFixed(1)}h*${heures > 0 ? ` — Taux: *${(sess.caNet/heures).toFixed(1)}€/h*` : ''}`
        );
        return;
      }
    }

    if (sessionsVtcDep[chatId]?.etape === 'montant') {
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, 'Montant invalide.'); return; }
      const sess = sessionsVtcDep[chatId];
      const result = await saveVtcDepenseDiverse(chatId, montant, sess.categorie, VTC_DEP_CATEGORIES[sess.categorie].label);
      delete sessionsVtcDep[chatId];
      if (!result.ok) {
        await send(chatId, `Erreur lors de l'enregistrement : ${result.error}`);
        return;
      }
      await send(chatId, `Depense diverse enregistree : *${montant}€* — ${VTC_DEP_CATEGORIES[sess.categorie].label}`);
      return;
    }

    if (sessionsTuroDep[chatId]?.etape === 'montant') {
      const montant = parseFloat(texte.replace(',', '.'));
      if (isNaN(montant) || montant <= 0) { await send(chatId, 'Montant invalide.'); return; }
      const sess = sessionsTuroDep[chatId];
      sess.montant = montant; sess.libelle = texte; sess.etape = 'recurrent';
      await sendBtns(chatId, `*${montant}€* — ${TURO_CATEGORIES[sess.categorie].label}\n\nDepense recurrente (mensuelle) ou ponctuelle ?\n_Ex: assurance = recurrente, CT/reparation = ponctuelle_`, [
        [{ t: 'Recurrente', d: 'turo_recur_oui' }, { t: 'Ponctuelle', d: 'turo_recur_non' }],
      ]);
      return;
    }

    if (sessionsTuroLoc[chatId]) {
      const sess = sessionsTuroLoc[chatId];
      if (sess.etape === 'revenu_net') {
        const v = parseFloat(texte.replace(',', '.'));
        if (isNaN(v) || v <= 0) { await send(chatId, 'Montant invalide.'); return; }
        sess.revenuNet = v; sess.etape = 'part_cousin';
        await send(chatId, `Revenu net: *${v}€*\n\nCombien verse a ton cousin ? (ex: 65)`);
        return;
      }
      if (sess.etape === 'part_cousin') {
        const v = parseFloat(texte.replace(',', '.'));
        if (isNaN(v) || v < 0) { await send(chatId, 'Montant invalide.'); return; }
        const { revenuNet, partCousin, partMoi } = await saveTuroLocationSimple(chatId, sess.revenuNet, v);
        delete sessionsTuroLoc[chatId];
        await send(chatId,
          `Location Turo enregistree\n\n` +
          `Revenu net: *${revenuNet}€*\n` +
          `Verse au cousin: *${partCousin}€*\n` +
          `Ma part: *${partMoi.toFixed(2)}€*`
        );
        return;
      }
    }

    if (sessionsAjoutEleve[chatId]) {
      const handled = await traiterAjoutEleve(chatId, texte);
      if (handled) return;
    }

    if (sessionsRevenu[chatId]?.etape === 'libelle_custom') {
      const libelle = texte.trim();
      if (!libelle || libelle.length < 2) { await send(chatId, 'Libelle trop court. Reessaie.'); return; }
      sessionsRevenu[chatId] = { type: libelle, etape: 'montant' };
      await send(chatId, `*${libelle}*\n\nMontant recu ? (ex: *150*)`);
      return;
    }

    if (sessionsRevenu[chatId]?.etape === 'montant') {
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        const type = sessionsRevenu[chatId].type;
        await saveRevenu(chatId, montant, type);
        delete sessionsRevenu[chatId];
        await send(chatId, `Rentree *+${montant}€* enregistree ! (${type})`);
      } else { await send(chatId, 'Envoie un montant valide, ex: *150*'); }
      return;
    }

    if (sessionsModifier[chatId]?.etape === 'attente_montant_budget') {
      const cat = sessionsModifier[chatId].categorie;
      const montant = trouverMontant(texte);
      if (montant && montant > 0) { BUDGETS[cat].max = montant; delete sessionsModifier[chatId]; await send(chatId, `Budget *${BUDGETS[cat].label}* mis a jour : *${montant} €/mois*`); }
      else { await send(chatId, 'Envoie un montant valide, ex: *400*'); }
      return;
    }

    if (sessionsModifier[chatId]?.etape === 'attente_rectif_depense') {
      const cat = sessionsModifier[chatId].categorie;
      const montant = trouverMontant(texte);
      if (montant && montant > 0) {
        const item = await annulerDerniereDepense(cat);
        if (item) { await saveDepense(chatId, montant, cat, item.libelle || texte); delete sessionsModifier[chatId]; await send(chatId, `Depense rectifiee : *${montant} €* — ${BUDGETS[cat].label}\nAncien montant : ${item.montant} €`); }
        else { await send(chatId, `Aucune depense trouvee pour ${BUDGETS[cat].label} ce mois.`); delete sessionsModifier[chatId]; }
      } else { await send(chatId, 'Envoie le nouveau montant, ex: *45*'); }
      return;
    }

    if (sessionsFiches[chatId]?.etape === 'attente_chapitre') {
      const eleve = sessionsFiches[chatId].eleve;
      delete sessionsFiches[chatId];
      await send(chatId, `Generation de la fiche pour *${eleve}*...`);
      try {
        const contenu = await genererContenuFiche(eleve, texte);
        const pdfPath = await creerPDF(eleve, texte, contenu);
        await sendDocument(chatId, pdfPath, `fiche_${eleve}_${texte.replace(/ /g,'_')}.pdf`);
        fs.unlinkSync(pdfPath);
      } catch (err) { console.error('Erreur fiche PDF:', err.message); await send(chatId, 'Erreur generation fiche. Reessaie.'); }
      return;
    }

    if (texte === '/bilan') {
      const data = await getData();
      const TOTAL_CF = getTotalChargesFixes();
      let m = `Bilan ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
      Object.entries(data.totaux).forEach(([k, v]) => {
        m += `${BUDGETS[k].label}: ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      const totalGlobal = TOTAL_CF + data.totalDep;
      m += `\nTotal (fixes+variables): *${totalGlobal.toFixed(0)}€* / seuil ${SEUIL_ALERTE_TOTAL}€`;
      m += `\nSolde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*`;
      if (data.turo.locations.length > 0 || data.turo.totalDepenses > 0) {
        m += `\n\nTuro — ma part nette: *${data.turo.partMoiTotal.toFixed(0)}€* — depenses vehicule: *${data.turo.totalDepenses.toFixed(0)}€*`;
      }
      await send(chatId, m);
      return;
    }

    if (texte === '/completude') {
      const data = await getData();
      let m = `Completude ${new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}\n\n`;
      m += `*${data.completude.toFixed(2)}€* / ${OBJECTIF_COMPLETUDE}€\nCours: ${data.cours.length}\n`;
      if (data.cours.length > 0) { m += `\nDetail:\n`; data.cours.forEach(c => { m += `• ${c.eleve}${c.rattrapage ? ' (rattrapage)' : ''}: +${c.gain.toFixed(2)}€\n`; }); }
      if (data.coursManques.length > 0) { m += `\nManques:\n`; data.coursManques.forEach(c => { m += `• ${c.eleve}${c.libelle === 'deplace' ? ' (deplace)' : ''}: -${c.gain_manque.toFixed(2)}€\n`; }); }
      await send(chatId, m);
      return;
    }

    if (texte === '/objectifs') {
      const data = await getData();
      let m = `Objectifs epargne\n\nActuelle: *${data.epargneBase.toLocaleString()}€*\nProjection: *${data.epargneEstimee.toFixed(0)}€*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = data.epargneEstimee - o.montant;
        const pct = Math.min(100, Math.round((data.epargneEstimee / o.montant) * 100));
        m += `*${o.label}*: ${o.montant.toLocaleString()}€ — ${pct}%\n`;
      });
      await send(chatId, m);
      return;
    }

    const tousEleves = trouverTousLesEleves(texte);
    const eleve = tousEleves[0] || null;
    const isCours = /cours|rattrapage|seance/i.test(texte);
    const isPasFait = /pas fait|absent|annule|pas pu|rate/i.test(texte);

    if (eleve && isCours) {
      const rattrapage = /rattrapage/i.test(texte);
      const fileAttente = tousEleves.slice(1);
      if (isPasFait) {
        for (const el of tousEleves) { const gain_manque = await saveCoursManque(chatId, el); await send(chatId, `Cours ${el} non effectue\nManque: *-${gain_manque.toFixed(2)}€*`); }
        return;
      }
      sessions[chatId] = { eleve, rattrapage, etape: 'confirmation', fileAttente };
      await sendBtns(chatId, `Cours avec *${eleve}*${rattrapage ? ' (rattrapage)' : ''} — effectue ?`,
        [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
      );
      return;
    }

    const montant = trouverMontant(texte);
    const cat = trouverCategorie(texte);
    if (montant && montant > 0 && montant < 5000 && !isCours) {
      if (cat) {
        await saveDepense(chatId, montant, cat, texte);
        const newData = await getData();
        const restant = BUDGETS[cat].max - newData.totaux[cat];
        await send(chatId, `*${montant}€* — ${BUDGETS[cat].label}\nRestant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
        return;
      }
    }

    if (/salaire|lgm|paie/i.test(texte) && montant && montant > 1000) { await saveSalaire(chatId, montant); await send(chatId, `Salaire LGM enregistre: *${montant}€*`); return; }
    if (/epargne|économies|economies|capital|livret|compte epargne/i.test(texte) && montant && montant > 100) { await saveEpargne(chatId, montant); await afficherProgressionEpargne(chatId, montant); return; }
    if (/recu|vinted|remboursement|rentree|participation/i.test(texte) && montant) { await saveRevenu(chatId, montant, texte); await send(chatId, `Rentree *+${montant}€* enregistree !`); return; }

    const data = await getData();
    const elevesNLP = trouverTousLesEleves(texte);
    const eleveNLP = elevesNLP[0] || null;

    if (eleveNLP) {
      const signesAbsence = /absent|pas (l[aà]|venu|v[eè]nu|pu|fait|venir)|annul|pr[eé]venu|cancel|s.est d[eé]sist|pa(s)? (eu|pu)|a pas|na pas/i.test(texte);
      const signesCours = /\bcours\b|\bseance\b|\brattrapage\b|\bfait cours\b|\bvu\b|\btermin|\bfini\b|j.ai fait|on a fait|effectu/i.test(texte);
      const signesDeplace = /deplace|reporté|reporte|autre.*jour|change.*jour|pas.*ce.*soir/i.test(texte);
      if (signesDeplace && eleveNLP) { const gain_manque = await saveCoursDeplace(chatId, eleveNLP); await send(chatId, `Cours *${eleveNLP}* marque comme deplace.`); return; }
      if (signesAbsence) { for (const el of elevesNLP) { const gain_manque = await saveCoursManque(chatId, el); await send(chatId, `Cours ${el} non effectue\nManque: *-${gain_manque.toFixed(2)}€*`); } return; }
      if (signesCours) {
        const rattrapage = /rattrapage/i.test(texte);
        const fileAttente = elevesNLP.slice(1);
        sessions[chatId] = { eleve: eleveNLP, rattrapage, etape: 'confirmation', fileAttente };
        await sendBtns(chatId, `Cours avec *${eleveNLP}*${rattrapage ? ' (rattrapage)' : ''} — effectue ?`,
          [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
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
        else if (/\bdyneos\b/i.test(texte)) catNLP = 'Dyneos';
      }
      if (catNLP) {
        await saveDepense(chatId, montantNLP, catNLP, texte);
        const newData = await getData();
        const restant = BUDGETS[catNLP].max - newData.totaux[catNLP];
        await send(chatId, `*${montantNLP}€* — ${BUDGETS[catNLP].label}\nRestant: *${restant.toFixed(0)}€* / ${BUDGETS[catNLP].max}€`);
        return;
      }
      sessions[chatId] = { montant: montantNLP, libelle: texte, etape: 'choix_cat' };
      const cats = Object.entries(BUDGETS);
      const rows = [];
      for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i+3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      await sendBtns(chatId, `*${montantNLP}€* — Quelle categorie ?`, rows);
      return;
    }

    if (/salaire|lgm|paie|virement.*lgm|lgm.*virement/i.test(texte) && montantNLP && montantNLP > 1000) { await saveSalaire(chatId, montantNLP); await send(chatId, `Salaire LGM enregistre: *${montantNLP}€*`); return; }
    if (/epargne|économie|economies|économies|livret|capital|j.ai mis|j.ai économisé|mis de c[oô]t[eé]/i.test(texte) && montantNLP && montantNLP > 100) { await saveEpargne(chatId, montantNLP); await afficherProgressionEpargne(chatId, montantNLP); return; }
    if (/reçu|vinted|remboursement|rentrée|rentr[eé]e|participation|prime|bonus|cash|gagné|vendu/i.test(texte) && montantNLP && montantNLP > 0) { await saveRevenu(chatId, montantNLP, texte); await send(chatId, `Rentree *+${montantNLP}€* enregistree !`); return; }

    try {
      const reponse = await geminiParle(chatId, texte, data);
      await send(chatId, reponse);
    } catch (err) {
      console.error('geminiParle error:', err.message);
      await send(chatId, `Je n'ai pas compris. Essaie:\n• "cours avec [prenom]"\n• "[montant]€ [lieu/type]"\n• /bilan /completude /prelevements`);
    }

  } catch (err) {
    console.error('Erreur webhook:', err.message);
    await send(chatId, 'Erreur technique, reessaie.');
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
    if (!montant || montant <= 0) { await send(chatId, 'Montant invalide recu depuis le raccourci.'); return; }
    if (cat) {
      await saveDepense(chatId, montant, cat, text);
      const newData = await getData();
      const restant = BUDGETS[cat].max - newData.totaux[cat];
      await send(chatId, `Apple Pay — ${montant}€\n${BUDGETS[cat].label}\nRestant: *${restant.toFixed(0)}€* / ${BUDGETS[cat].max}€`);
    } else {
      sessions[chatId] = { montant, libelle: text, etape: 'choix_cat' };
      const cats = Object.entries(BUDGETS);
      const rows = [];
      for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i + 3).map(([k, b]) => ({ t: b.label, d: `cat_${k}` })));
      rows.push([{ t: 'Annuler', d: 'annuler' }]);
      await sendBtns(chatId, `Apple Pay — ${montant}€\n\nQuelle categorie ?`, rows);
    }
  } catch (err) { console.error('/depense error:', err.message); }
});

// ============================================================
// API DASHBOARD — CRUD
// ============================================================
app.delete('/api/depense/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('depenses').select('id, montant, libelle, categorie').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Depense introuvable' });
    const { error } = await supabase.from('depenses').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/depense/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { montant } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    const { error } = await supabase.from('depenses').update({ montant: v }).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ============================================================
// API COURS — preparee pour usage futur (pas encore appelee par le dashboard,
// les cours restent geres via Telegram /annuler pour le moment)
// ============================================================
app.patch('/api/cours/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { gain, duree, rattrapage } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const update = {};
    if (gain !== undefined) {
      const v = parseFloat(gain);
      if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Gain invalide' });
      update.gain = v;
    }
    if (duree !== undefined) update.duree = parseFloat(duree);
    if (rattrapage !== undefined) update.rattrapage = !!rattrapage;
    const { error } = await supabase.from('cours').update(update).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/cours/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('cours').select('id, eleve, gain').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Cours introuvable' });
    const { error } = await supabase.from('cours').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/revenu/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('revenus').select('id, montant, libelle').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Revenu introuvable' });
    const { error } = await supabase.from('revenus').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/revenu/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { montant } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    const { error } = await supabase.from('revenus').update({ montant: v }).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/investissement/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('investissements').select('id, ticker, montant').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Investissement introuvable' });
    const { error } = await supabase.from('investissements').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/investissement/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { montant } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    const { data: item } = await supabase.from('investissements').select('prix_unitaire').eq('id', id).single();
    const nb_parts = item ? v / item.prix_unitaire : null;
    const update = nb_parts ? { montant: v, nb_parts } : { montant: v };
    const { error } = await supabase.from('investissements').update(update).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ============================================================
// API VTC — CRUD SESSIONS
// ============================================================
app.post('/api/vtc/session', async (req, res) => {
  try {
    const { date, heure_debut, heure_fin, plateforme, ca_net, nb_courses } = req.body;
    if (!date || !heure_debut || !heure_fin || !plateforme || !ca_net) {
      return res.json({ ok: false, error: 'Champs manquants' });
    }
    const caNet = parseFloat(ca_net);
    if (isNaN(caNet) || caNet <= 0) return res.json({ ok: false, error: 'CA net invalide' });
    const { error } = await supabase.from('vtc_sessions').insert({
      chat_id: CHAT_ID,
      date,
      heure_debut,
      heure_fin,
      plateforme: String(plateforme).toLowerCase(),
      ca_net: caNet,
      nb_courses: nb_courses ? parseInt(nb_courses, 10) : 0,
    });
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/vtc/session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, heure_debut, heure_fin, plateforme, ca_net, nb_courses } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const update = {};
    if (date !== undefined) update.date = date;
    if (heure_debut !== undefined) update.heure_debut = heure_debut;
    if (heure_fin !== undefined) update.heure_fin = heure_fin;
    if (plateforme !== undefined) update.plateforme = String(plateforme).toLowerCase();
    if (ca_net !== undefined) {
      const v = parseFloat(ca_net);
      if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'CA net invalide' });
      update.ca_net = v;
    }
    if (nb_courses !== undefined) update.nb_courses = nb_courses ? parseInt(nb_courses, 10) : 0;
    const { error } = await supabase.from('vtc_sessions').update(update).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/vtc/rattachement', async (req, res) => {
  try {
    const { actif, montant } = req.body;
    if (actif !== undefined) {
      VTC_RATTACHEMENT_ACTIF = !!actif;
      await sauvegarderConfig('vtc_rattachement_actif', VTC_RATTACHEMENT_ACTIF ? 1 : 0);
    }
    if (montant !== undefined) {
      const v = parseFloat(montant);
      if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
      VTC_RATTACHEMENT_MENSUEL = v;
      await sauvegarderConfig('vtc_rattachement_mensuel', v);
    }
    res.json({ ok: true, actif: VTC_RATTACHEMENT_ACTIF, montant: VTC_RATTACHEMENT_MENSUEL });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/vtc/session/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('vtc_sessions').select('id, ca_net, plateforme').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Session introuvable' });
    const { error } = await supabase.from('vtc_sessions').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ============================================================
// API VTC — CRUD DEPENSES DIVERSES
// ============================================================
app.post('/api/vtc/depense', async (req, res) => {
  try {
    const { montant, categorie, libelle } = req.body;
    if (!montant || !categorie) return res.json({ ok: false, error: 'Champs manquants' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    if (!VTC_DEP_CATEGORIES[categorie]) return res.json({ ok: false, error: 'Categorie inconnue' });
    await saveVtcDepenseDiverse(CHAT_ID, v, categorie, libelle || VTC_DEP_CATEGORIES[categorie].label);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/vtc/depense/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { montant, categorie, libelle } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const update = {};
    if (montant !== undefined) {
      const v = parseFloat(montant);
      if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
      update.montant = v;
    }
    if (categorie !== undefined) update.categorie = categorie;
    if (libelle !== undefined) update.libelle = libelle;
    const { error } = await supabase.from('vtc_depenses_diverses').update(update).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/vtc/depense/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('vtc_depenses_diverses').select('id, montant, categorie').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Depense introuvable' });
    const { error } = await supabase.from('vtc_depenses_diverses').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ============================================================
// API VTC — CRUD CHARGES FIXES
// ============================================================
app.post('/api/vtc/charge', async (req, res) => {
  try {
    const { nom, montant } = req.body;
    if (!nom || montant === undefined) return res.json({ ok: false, error: 'Champs manquants' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    await ajouterChargeVtc(CHAT_ID, nom, v);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/vtc/charge/:nom', async (req, res) => {
  try {
    const nom = decodeURIComponent(req.params.nom);
    const { montant } = req.body;
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    if (!(nom in VTC_CHARGES_FIXES)) return res.json({ ok: false, error: 'Charge introuvable' });
    await ajouterChargeVtc(CHAT_ID, nom, v);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/vtc/charge/:nom', async (req, res) => {
  try {
    const nom = decodeURIComponent(req.params.nom);
    if (!(nom in VTC_CHARGES_FIXES)) return res.json({ ok: false, error: 'Charge introuvable' });
    delete VTC_CHARGES_FIXES[nom];
    const { error } = await supabase.from('config').delete().eq('cle', `vtc_charge_${nom}`);
    if (error) console.error('delete vtc charge config error:', error.message);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ============================================================
// API TURO — CRUD DEPENSES + LOCATIONS
// ============================================================
app.get('/api/turo', async (req, res) => {
  try {
    const moisOffset = parseInt(req.query.mois || '0');
    const data = await getDataTuro(CHAT_ID, moisOffset);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/turo/depense', async (req, res) => {
  try {
    const { montant, categorie, libelle, recurrent } = req.body;
    if (!montant || !categorie) return res.json({ ok: false, error: 'Champs manquants' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    if (!TURO_CATEGORIES[categorie]) return res.json({ ok: false, error: 'Categorie inconnue' });
    await saveTuroDepense(CHAT_ID, v, categorie, libelle || '', !!recurrent);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/turo/depense/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { montant, categorie, libelle, recurrent } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const update = {};
    if (montant !== undefined) {
      const v = parseFloat(montant);
      if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
      update.montant = v;
    }
    if (categorie !== undefined) update.categorie = categorie;
    if (libelle !== undefined) update.libelle = libelle;
    if (recurrent !== undefined) update.recurrent = !!recurrent;
    const { error } = await supabase.from('turo_depenses').update(update).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/turo/depense/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('turo_depenses').select('id, montant, categorie').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Depense introuvable' });
    const { error } = await supabase.from('turo_depenses').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/turo/location', async (req, res) => {
  try {
    const { locataire, date_debut, date_fin, revenu_brut, frais_turo } = req.body;
    if (!locataire || !date_debut || !date_fin || revenu_brut === undefined) {
      return res.json({ ok: false, error: 'Champs manquants' });
    }
    const revenuBrut = parseFloat(revenu_brut);
    const fraisTuro = parseFloat(frais_turo || 0);
    if (isNaN(revenuBrut) || revenuBrut <= 0) return res.json({ ok: false, error: 'Revenu brut invalide' });
    const result = await saveTuroLocation(CHAT_ID, {
      locataire, dateDebut: date_debut, dateFin: date_fin, revenuBrut, fraisTuro,
    });
    res.json({ ok: true, ...result });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.patch('/api/turo/location/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { locataire, date_debut, date_fin, revenu_brut, frais_turo } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const update = {};
    if (locataire !== undefined) update.locataire = locataire;
    if (date_debut !== undefined) update.date_debut = date_debut;
    if (date_fin !== undefined) update.date_fin = date_fin;
    if (revenu_brut !== undefined || frais_turo !== undefined) {
      const { data: existing } = await supabase.from('turo_locations').select('revenu_brut, frais_turo').eq('id', id).single();
      const revenuBrut = revenu_brut !== undefined ? parseFloat(revenu_brut) : existing.revenu_brut;
      const fraisTuro = frais_turo !== undefined ? parseFloat(frais_turo) : existing.frais_turo;
      const revenuNet = revenuBrut - fraisTuro;
      update.revenu_brut = revenuBrut;
      update.frais_turo = fraisTuro;
      update.revenu_net = revenuNet;
      update.part_cousin = revenuNet * TURO_SPLIT_COUSIN;
      update.part_moi = revenuNet * (1 - TURO_SPLIT_COUSIN);
    }
    const { error } = await supabase.from('turo_locations').update(update).eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/turo/location/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { data: item, error: fetchErr } = await supabase.from('turo_locations').select('id, locataire, revenu_net').eq('id', id).single();
    if (fetchErr || !item) return res.json({ ok: false, error: 'Location introuvable' });
    const { error } = await supabase.from('turo_locations').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true, deleted: item });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const moisOffset = parseInt(req.query.mois || '0');
    const data = await getData(moisOffset);
    // L'épargne réelle (onglet Épargne, alimenté par les mouvements) devient la référence
    // pour tous les indicateurs Aperçu — patrimoine, objectif, projection — à la place
    // du snapshot manuel legacy (qui reste utilisé tel quel par les commandes Telegram).
    data.epargneBase = data.epargneLedger.total;
    data.epargneEstimee = data.epargneBase + data.solde;
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

    const investissements = await getInvestissements();
    const prixActuels = {};
    const watchlistTickers = [...new Set([...MARKET_WATCHLIST, ...investissements.map(i => i.ticker)])];
    await Promise.all(watchlistTickers.map(async t => {
      const p = await getPrixActuelETF(t);
      if (p) prixActuels[t] = p;
    }));

    const vtcData = data.vtc;
    const vtcSemaine = await getDataVtcSemaine(CHAT_ID, 0);

    const totalInvesti = investissements.reduce((s, i) => s + Number(i.montant), 0);
    const totalInvestiActuel = investissements.reduce((s, i) => {
      const p = prixActuels[i.ticker];
      return s + (p ? p.prix * Number(i.nb_parts) : Number(i.montant));
    }, 0);
    const patrimoineTotal = data.epargneEstimee + totalInvestiActuel;
    const plusValueLatente = totalInvestiActuel - totalInvesti;
    const patrimoineEvolutionMois = data.solde + plusValueLatente;

    res.json({
      salaire: data.salaire, beau_frere: BEAU_FRERE, completude: data.completude,
      objectif_completude: OBJECTIF_COMPLETUDE, total_revenus: data.totalRevenus,
      charges_fixes: TOTAL_CF, total_dep: data.totalDep, solde: data.solde,
      epargne_base: data.epargneBase, epargne_estimee: data.epargneEstimee,
      total_investi: totalInvesti, total_investi_actuel: totalInvestiActuel,
      patrimoine_total: patrimoineTotal, patrimoine_evolution_mois: patrimoineEvolutionMois,
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
      investissements,
      prix_actuels: prixActuels,
      market_watchlist: MARKET_WATCHLIST,
      vtc_sessions: vtcData ? vtcData.sessions : [],
      vtc_depenses_diverses: vtcData ? vtcData.depensesDiverses : [],
      vtc_ca_net: vtcData ? vtcData.caNet : 0,
      vtc_dep_diverses_total: vtcData ? vtcData.totalDepensesDiverses : 0,
      vtc_charges_fixes_mois: vtcData ? vtcData.chargesFixesHebdo : 0,
      vtc_urssaf: vtcData ? vtcData.urssaf : 0,
      vtc_rattachement: vtcData ? vtcData.rattachement : 0,
      vtc_net: vtcData ? vtcData.net : 0,
      vtc_heures: vtcData ? vtcData.heures : 0,
      vtc_taux_horaire: vtcData ? vtcData.tauxHoraire : 0,
      vtc_objectif_mensuel: OBJECTIF_VTC_MENSUEL,
      vtc_charges: Object.entries(VTC_CHARGES_FIXES).map(([nom, montant]) => ({ nom, montant })),
      vtc_urssaf_pct: VTC_URSSAF_TAUX,
      vtc_rattachement_mensuel: VTC_RATTACHEMENT_MENSUEL,
      vtc_rattachement_actif: VTC_RATTACHEMENT_ACTIF,
      vtc_dep_categories: VTC_DEP_CATEGORIES,
      vtc_semaine_ca_net: vtcSemaine ? vtcSemaine.caNet : 0,
      vtc_semaine_heures: vtcSemaine ? vtcSemaine.heures : 0,
      vtc_semaine_taux_horaire: vtcSemaine ? vtcSemaine.tauxHoraire : 0,
      vtc_semaine_objectif: vtcSemaine ? vtcSemaine.objectif : VTC_OBJECTIF_HEBDO,
      vtc_semaine_net: vtcSemaine ? vtcSemaine.net : 0,
      vtc_semaine_charges_totales: vtcSemaine ? vtcSemaine.chargesTotales : 0,
      vtc_semaine_projection_mensuelle: vtcSemaine ? vtcSemaine.projectionMensuelle : 0,
      vtc_semaine_seuils: vtcSemaine ? vtcSemaine.seuils : [],
      vtc_semaine_essence_retenue: vtcSemaine ? vtcSemaine.essenceRetenue : 0,
      vtc_semaine_essence_depensee: vtcSemaine ? vtcSemaine.essenceDepensee : 0,
      vtc_essence_base_hebdo: VTC_ESSENCE_BASE_HEBDO,
      turo_locations: data.turo.locations,
      turo_depenses_ponctuelles: data.turo.depensesPonctuelles,
      turo_depenses_recurrentes: data.turo.depensesRecurrentes,
      turo_revenu_brut: data.turo.revenuBrutTotal,
      turo_revenu_net: data.turo.revenuNetTotal,
      turo_part_moi: data.turo.partMoiTotal,
      turo_part_cousin: data.turo.partCousinTotal,
      turo_dep_ponctuelles: data.turo.totalDepPonctuelles,
      turo_dep_recurrentes: data.turo.totalDepRecurrentes,
      turo_dep_total: data.turo.totalDepenses,
      turo_dep_par_categorie: data.turo.depParCategorie,
      turo_rentabilite_nette: data.turo.rentabiliteNette,
      turo_categories: TURO_CATEGORIES,
      turo_split_cousin: TURO_SPLIT_COUSIN,
      epargne_ledger_total: data.epargneLedger.total,
      epargne_par_source: data.epargneLedger.bySource,
      epargne_mouvements_mois: data.epargneLedger.mouvementsDuMois,
      epargne_courbe: data.epargneLedger.courbe,
      epargne_solde_debut_mois: data.epargneLedger.soldeDebutMois,
      epargne_sources: EPARGNE_SOURCES,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/epargne/mouvement', async (req, res) => {
  try {
    const { source, montant, type, note } = req.body;
    if (!source || !montant || !type) return res.json({ ok: false, error: 'Champs manquants' });
    if (!EPARGNE_SOURCES[source]) return res.json({ ok: false, error: 'Source inconnue' });
    if (type !== 'in' && type !== 'out') return res.json({ ok: false, error: 'Type invalide' });
    const v = parseFloat(montant);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
    const r = await saveMouvementEpargne(CHAT_ID, source, v, type, note);
    if (!r.ok) return res.json(r);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.delete('/api/epargne/mouvement/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.json({ ok: false, error: 'ID manquant' });
    const { error } = await supabase.from('epargne_mouvements').delete().eq('id', id);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/config', async (req, res) => {
  try {
    const { cle, valeur } = req.body;
    if (!cle || valeur === undefined) return res.json({ ok: false, error: 'Parametres manquants' });
    const v = parseFloat(valeur);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Valeur invalide' });
    if (cle === 'salaire_lgm')        SALAIRE_LGM_DEFAULT = v;
    else if (cle === 'beau_frere')     BEAU_FRERE = v;
    else if (cle === 'objectif_completude') OBJECTIF_COMPLETUDE = v;
    else if (cle === 'vtc_rattachement_mensuel') VTC_RATTACHEMENT_MENSUEL = v;
    else if (cle === 'vtc_objectif_hebdo') VTC_OBJECTIF_HEBDO = v;
    else if (cle === 'vtc_essence_base_hebdo') VTC_ESSENCE_BASE_HEBDO = v;
    await sauvegarderConfig(cle, v);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/budget', async (req, res) => {
  try {
    const { categorie, max } = req.body;
    if (!categorie || !max) return res.json({ ok: false, error: 'Parametres manquants' });
    const v = parseFloat(max);
    if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Valeur invalide' });
    if (!BUDGETS[categorie]) return res.json({ ok: false, error: 'Categorie inconnue' });
    BUDGETS[categorie].max = v;
    await sauvegarderConfig(`budget_${categorie}`, v);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post('/api/prel', async (req, res) => {
  try {
    const { nom, champ, valeur } = req.body;
    if (!nom || !champ) return res.json({ ok: false, error: 'Parametres manquants' });
    const p = PRELEVEMENTS_DATES.find(p => p.nom === nom);
    if (!p) return res.json({ ok: false, error: 'Prelevement introuvable' });
    if (champ === 'montant') {
      const v = parseFloat(valeur);
      if (isNaN(v) || v <= 0) return res.json({ ok: false, error: 'Montant invalide' });
      p.montant = v; CHARGES_FIXES[nom] = v;
      await sauvegarderConfig(`prel_montant_${nom}`, v);
    } else if (champ === 'jour') {
      const v = parseInt(valeur);
      if (isNaN(v) || v < 1 || v > 31) return res.json({ ok: false, error: 'Jour invalide' });
      p.jour = v;
      await sauvegarderConfig(`prel_jour_${nom}`, v);
    } else if (champ === 'suspendu') {
      const v = parseInt(valeur);
      p.suspendu = v === 1;
      if (p.suspendu) CHARGES_FIXES[nom] = 0;
      else CHARGES_FIXES[nom] = p.montant;
      await sauvegarderConfig(`prel_suspendu_${nom}`, v);
    } else { return res.json({ ok: false, error: 'Champ inconnu' }); }
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

// ============================================================
// ROUTE API SIMULATEUR
// ============================================================
app.get('/api/simulateur', async (req, res) => {
  try {
    const data = await getData(0);
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const aujourdhui = now.getDate();
    const dernierJour = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const prelevementsRestants = PRELEVEMENTS_DATES
      .filter(p => p.jour && !p.suspendu && p.jour >= aujourdhui)
      .map(p => ({ nom: p.nom, montant: p.montant, jour: p.jour }))
      .sort((a, b) => a.jour - b.jour);

    const totalPrelevementsRestants = prelevementsRestants.reduce((s, p) => s + p.montant, 0);
    const potentiel = calculerPotentielRestant(0, data.cours, data.coursManques);

    const depVariablesActuelles = {
      courses: data.totaux['courses'] || 0,
      essence: data.totaux['essence'] || 0,
      restos:  data.totaux['restos']  || 0,
    };

    res.json({
      epargne_actuelle:             data.epargneBase,
      solde_actuel:                 data.solde,
      epargne_estimee_actuelle:     data.epargneEstimee,
      completude_actuelle:          data.completude,
      potentiel_cours_restants:     potentiel.montantRestant,
      salaire:                      data.salaire,
      beau_frere:                   BEAU_FRERE,
      revenus_supp:                 data.revenusSupp,
      total_revenus:                data.totalRevenus,
      charges_fixes_total:          getTotalChargesFixes(),
      prelevements_restants:        prelevementsRestants,
      total_prelevements_restants:  totalPrelevementsRestants,
      depenses_variables_actuelles: data.totalDep,
      dep_variables_detail:         depVariablesActuelles,
      budgets_max: {
        courses: BUDGETS['courses']?.max || 500,
        essence: BUDGETS['essence']?.max || 300,
        restos:  BUDGETS['restos']?.max  || 80,
      },
      objectifs:             OBJECTIFS,
      objectif_completude:   OBJECTIF_COMPLETUDE,
      eleves_restants:       potentiel.elevesRestants,
      jours_restants_count:  potentiel.joursRestantsCount,
      jour_actuel:           aujourdhui,
      dernier_jour:          dernierJour,
      jours_restants_mois:   dernierJour - aujourdhui,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  let msg = `Point bi-hebdo\n\nCompletude: *${data.completude.toFixed(0)}€* / ${OBJECTIF_COMPLETUDE}€ (${pct}%)\n`;
  if (manque > 0) msg += `Il manque: *${manque.toFixed(0)}€*\n`;
  msg += `Solde estime: *${data.solde.toFixed(0)}€*\n`;
  msg += `Epargne projetee: *${data.epargneEstimee.toFixed(0)}€*`;
  await send(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const data = await getData();
  let msg = `Synthese de fin de mois\n\n`;
  msg += `Revenus totaux: *${data.totalRevenus.toFixed(0)}€*\n`;
  msg += `Completude: *${data.completude.toFixed(0)}€* / ${OBJECTIF_COMPLETUDE}€\n`;
  msg += `Depenses: *${data.totalDep.toFixed(0)}€*\n`;
  msg += `Solde: *${data.solde >= 0 ? '+' : ''}${data.solde.toFixed(0)}€*\n`;
  msg += `Epargne estimee: *${data.epargneEstimee.toFixed(0)}€*\n\n`;
  msg += `_Bilan sauvegarde. Nouveau mois qui commence !_`;
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
      if (now.getDate() === dernierJourDuMois) { await sauvegarderSnapshotMensuel(); await envoyerSyntheseMensuelle(); }
    }

    const demain = now.getDate() + 1;
    if (heure === 9 && minute === 0) {
      const alertes = PRELEVEMENTS_DATES.filter(p => p.jour === demain && !p.suspendu);
      if (alertes.length > 0) {
        const total = alertes.reduce((s, p) => s + p.montant, 0);
        let msg = `Prelevements demain (${demain})\n\n`;
        alertes.forEach(p => msg += `• ${p.nom}: *${p.montant.toFixed(2)}€*\n`);
        msg += `\nTotal: *${total.toFixed(2)}€*\n_Verifie que ton compte est alimente !_`;
        await send(CHAT_ID, msg);
      }
    }

    if (now.getDate() === 1 && heure === 10 && minute === 0) {
      const investissements = await getInvestissements();
      const parTicker = {};
      investissements.forEach(inv => { if (!parTicker[inv.ticker]) parTicker[inv.ticker] = 0; parTicker[inv.ticker] += inv.montant; });
      const totalInvesti = Object.values(parTicker).reduce((a, b) => a + b, 0);
      let msg = `Rappel DCA mensuel\n\nC'est le 1er du mois — as-tu pense a ton versement ISWD ?\n\n`;
      if (totalInvesti > 0) { msg += `Total investi a ce jour: *${totalInvesti.toFixed(0)}€*\n`; Object.entries(parTicker).forEach(([t, m]) => { msg += `• ${t}: ${m.toFixed(0)}€\n`; }); msg += `\n`; }
      msg += `_/investir pour enregistrer ton achat du mois_`;
      await send(CHAT_ID, msg);
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
          `Fin de cours !\n\nAs-tu fait cours avec *${nomEleve}* ?`,
          [[{ t: 'Oui', d: 'cours_oui' }, { t: 'Non', d: 'cours_non' }, { t: 'Deplace', d: 'cours_deplace' }], [{ t: 'Annuler', d: 'annuler' }]]
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
// GENERATION FICHE PDF
// ============================================================
const PROFILS_FICHES = {
  'Amel':        { niveau: '5e',  format: 'standard' },
  'Benjamin':    { niveau: '5e',  format: 'standard', note: 'Impatient, erreurs attention — inclure exercices de verification' },
  'Guillaume':   { niveau: '5e',  format: 'tda',      note: 'TDA — consignes ultra courtes, max 4 exos, beaucoup espace' },
  'Margaux':     { niveau: '3e',  format: 'standard' },
  'Nelia':       { niveau: '3e',  format: 'standard' },
  'Helene':      { niveau: '5e',  format: 'standard' },
  'Matheo':      { niveau: '3e',  format: 'hebdo',    note: 'Fiche lundi-vendredi, 2 exos courts par jour' },
  'Anne-Gaelle': { niveau: '3e',  format: 'standard' },
  'Saida':       { niveau: '5e',  format: 'standard' },
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
        doc.fillColor('#F26419').fontSize(13).font('Helvetica-Bold').text('CORRIGE', 40, doc.y);
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
    doc.fillColor('white').fontSize(8).font('Helvetica').text("Genere par L'Agent — Completude", 40, pageBottom, { align: 'center', width: doc.page.width - 80 });
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
// FICHE
// ============================================================
async function demarrerFiche(chatId) {
  const elevesDispo = Object.keys(ELEVES);
  const rows = [];
  for (let i = 0; i < elevesDispo.length; i += 3)
    rows.push(elevesDispo.slice(i, i + 3).map(n => ({ t: n, d: `fiche_eleve_${n}` })));
  rows.push([{ t: 'Annuler', d: 'fiche_annuler' }]);
  await sendBtns(chatId, 'Generation de fiche\n\nPour quel eleve ?', rows);
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
// DEMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`L'Agent ecoute sur le port ${PORT}`);
  await chargerConfig();
  await chargerElevesCustom();
  demarrerScheduler();
});

module.exports = app;
