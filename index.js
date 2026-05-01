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
// REVENUS FIXES
// ============================================================
const SALAIRE_LGM = 2500;
const BEAU_FRERE = 320;
const OBJECTIF_COMPLETUDE = 1500;

// ============================================================
// CHARGES FIXES MENSUELLES
// ============================================================
const CHARGES_FIXES = {
  'Loyer': 832.46,
  'Tontine 1': 500,
  'Tontine 2': 500,
  'Virement mère': 150,
  'Place parking': 50,
  'Malakoff mutuelle': 57.03,
  'ENI énergie': 39.40,
  'Bouygues': 17.99,
  'Basic Fit': 22.99,
  'Assurance habitation': 8.46,
  'Assurance auto': 64.24,
  'Salle sport femme': 44,
  'Canal+ frère': 13,
  'Cours arabe': 31,
  'Claude.ai': 21.60,
  'Helloasso': 12.55,
  'Stripe asso': 10,
  'Disney+': 6.99,
  'Crunchyroll': 8.99,
  'Cotisation bancaire': 18.30,
};
const TOTAL_CHARGES_FIXES = Object.values(CHARGES_FIXES).reduce((a, b) => a + b, 0);

// ============================================================
// BUDGETS VARIABLES
// ============================================================
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

// ============================================================
// OBJECTIFS ÉPARGNE
// ============================================================
const EPARGNE_DEPART = 9000;
const OBJECTIFS = [
  { label: 'Fin juin 2026',  montant: 12500, date: '2026-06-30' },
  { label: 'Fin août 2026',  montant: 15000, date: '2026-08-31' },
  { label: 'Janvier 2027',   montant: 20000, date: '2027-01-01' },
];

// ============================================================
// PLANNING COMPLÉTUDE
// ============================================================
const PLANNING = [
  { nom: 'Amel',        jour: 1, heure: 17, minute: 0,  duree: 1.5, taux: 21.04 },
  { nom: 'Benjamin',    jour: 2, heure: 18, minute: 0,  duree: 1.5, taux: 24.30 },
  { nom: 'Guillaume',   jour: 3, heure: 17, minute: 30, duree: 1.5, taux: 23.88 },
  { nom: 'Margaux',     jour: 4, heure: 16, minute: 0,  duree: 1.5, taux: 26.60 },
  { nom: 'Nélia',       jour: 4, heure: 17, minute: 30, duree: 1.5, taux: 26.60 },
  { nom: 'Hélène',      jour: 6, heure: 8,  minute: 0,  duree: 1.5, taux: 24.30 },
  { nom: 'Noélie',      jour: 6, heure: 10, minute: 0,  duree: 1.0, taux: 25.78 },
  { nom: 'Mathéo',      jour: 6, heure: 11, minute: 30, duree: 1.5, taux: 23.66 },
  { nom: 'Anne-Gaëlle', jour: 6, heure: 13, minute: 0,  duree: 1.5, taux: 24.08 },
  { nom: 'Saïda',       jour: 6, heure: 15, minute: 0,  duree: 1.5, taux: 25.56 },
  { nom: 'Serena',      jour: 0, heure: 13, minute: 0,  duree: 1.5, taux: 23.04, uneSemaineSurDeux: true },
];

// État pour confirmation cours en attente
let confirmationEnAttente = null;

// ============================================================
// HELPERS
// ============================================================
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

function heureParis() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}

function estSemaineSerena() {
  const debut = new Date('2026-05-10');
  const diff = Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000));
  return diff % 2 === 0;
}

function detectCategorie(texte) {
  const t = texte.toLowerCase();
  if (t.includes('essence') || t.includes('esso') || t.includes('total') || t.includes('station') || t.includes('dlg') || t.includes('arcycom') || t.includes('certas') || t.includes('relais') || t.includes('carburant')) return 'essence';
  if (t.includes('leclerc') || t.includes('courses') || t.includes('carrefour') || t.includes('lidl') || t.includes('aldi') || t.includes('cora') || t.includes('supermarché')) return 'courses';
  if (t.includes('resto') || t.includes('restaurant') || t.includes('mcdonald') || t.includes('burger') || t.includes('pizza') || t.includes('panda') || t.includes('quick') || t.includes('kebab')) return 'restos';
  if (t.includes('médecin') || t.includes('pharmacie') || t.includes('doctolib') || t.includes('santé') || t.includes('docteur') || t.includes('clinique')) return 'sante';
  if (t.includes('ikea') || t.includes('maison') || t.includes('bricolage') || t.includes('castorama') || t.includes('leroy')) return 'maison';
  if (t.includes('garage') || t.includes('voiture') || t.includes('réparation') || t.includes('contrôle technique') || t.includes('pneu')) return 'voiture';
  if (t.includes('vêtement') || t.includes('zara') || t.includes('shopping') || t.includes('coiffeur') || t.includes('h&m')) return 'shopping';
  if (t.includes('cinéma') || t.includes('loisir') || t.includes('sport') || t.includes('concert') || t.includes('spectacle')) return 'loisirs';
  return 'divers';
}

function parseDepense(texte) {
  const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  if (!match) return null;
  const montant = parseFloat(match[1].replace(',', '.'));
  if (montant <= 0 || montant >= 5000) return null;
  return { montant, cat: detectCategorie(texte) };
}

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

async function getRevenusSupplementaires() {
  const debut = new Date(); debut.setDate(1); debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('revenus').select('*').gte('created_at', debut.toISOString());
  return data || [];
}

async function getTotauxParCat(depenses) {
  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });
  return totaux;
}

function nomMois(date) {
  return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
}

// ============================================================
// MESSAGES RÉCURRENTS
// ============================================================
async function envoyerRappelBiHebdo() {
  const depenses = await getDepensesMois();
  const totaux = await getTotauxParCat(depenses);
  const cours = await getCoursMois();
  const revenus = await getRevenusSupplementaires();
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = SALAIRE_LGM + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;

  let msg = `📋 *Rappel bi-hebdo — ${nomMois(new Date())}*\n\n`;
  msg += `💰 *Revenus ce mois :*\n`;
  msg += `• Salaire LGM : ${SALAIRE_LGM} €\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} €\n`;
  if (revenusSupp > 0) msg += `• Autres : ${revenusSupp.toFixed(0)} €\n`;
  msg += `\n💸 *Dépenses variables :*\n`;
  Object.entries(totaux).forEach(([k, v]) => {
    if (v > 0) {
      const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
      msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
    }
  });
  msg += `\n📊 *Solde estimé : ${solde >= 0 ? '+' : ''}${solde.toFixed(0)} €*\n\n`;
  msg += `_As-tu des dépenses ou rentrées à enregistrer ?_`;

  await sendMessage(CHAT_ID, msg);
}

async function envoyerSyntheseMensuelle() {
  const depenses = await getDepensesMois();
  const totaux = await getTotauxParCat(depenses);
  const cours = await getCoursMois();
  const revenus = await getRevenusSupplementaires();
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const completude = cours.reduce((s, c) => s + c.gain, 0);
  const revenusSupp = revenus.reduce((s, r) => s + r.montant, 0);
  const totalRevenus = SALAIRE_LGM + BEAU_FRERE + completude + revenusSupp;
  const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
  const economiesPossibles = TOTAL_BUDGETS_MAX - totalDep;

  let msg = `🗓️ *SYNTHÈSE ${nomMois(new Date()).toUpperCase()}*\n\n`;

  msg += `✅ *REVENUS TOTAUX : ${totalRevenus.toFixed(0)} €*\n`;
  msg += `• Salaire LGM : ${SALAIRE_LGM} €\n`;
  msg += `• Beau-frère : ${BEAU_FRERE} €\n`;
  msg += `• Complétude : ${completude.toFixed(0)} € (${cours.length} cours)\n`;
  if (revenusSupp > 0) msg += `• Autres : ${revenusSupp.toFixed(0)} €\n`;

  msg += `\n🔒 *CHARGES FIXES : -${TOTAL_CHARGES_FIXES.toFixed(0)} €*\n`;

  msg += `\n💸 *DÉPENSES VARIABLES : -${totalDep.toFixed(0)} €*\n`;
  Object.entries(totaux).forEach(([k, v]) => {
    const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
    msg += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
  });

  msg += `\n💰 *SOLDE NET : ${solde >= 0 ? '+' : ''}${solde.toFixed(0)} €*\n`;

  if (economiesPossibles > 0) {
    msg += `\n💡 *Tu aurais pu économiser ${economiesPossibles.toFixed(0)} € supplémentaires* en respectant tous tes budgets.\n`;
  }

  msg += `\n🎯 *OBJECTIFS ÉPARGNE :*\n`;
  OBJECTIFS.forEach(o => {
    const epargneEstimee = EPARGNE_DEPART + solde;
    const delta = epargneEstimee - o.montant;
    const emoji = delta >= 0 ? '✅' : '⚠️';
    msg += `${emoji} ${o.label} : ${o.montant.toLocaleString()} € (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n`;
  });

  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER
// ============================================================
function demarrerScheduler() {
  setInterval(async () => {
    const now = heureParis();
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    // Rappel bi-hebdo : mercredi (3) et dimanche (0) à 20h00
    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) {
      await envoyerRappelBiHebdo();
    }

    // Synthèse fin de mois : le 30 à 20h00
    if (now.getDate() === 30 && heure === 20 && minute === 0) {
      await envoyerSyntheseMensuelle();
    }

    // Vérifier fin de cours
    for (const cours of PLANNING) {
      if (cours.jour !== jour) continue;
      if (cours.uneSemaineSurDeux && !estSemaineSerena()) continue;

      const totalMin = cours.minute + Math.floor(cours.duree * 60);
      const heureFin = cours.heure + Math.floor(totalMin / 60);
      const minuteFin = totalMin % 60;

      if (heure === heureFin && minute === minuteFin) {
        confirmationEnAttente = cours;
        await sendMessage(CHAT_ID,
          `📚 *Fin de cours !*\n\nAs-tu fait cours avec *${cours.nom}* ?\n\nRéponds *oui* ou *non*`
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

    // ── Confirmation cours ──────────────────────────────────
    if (confirmationEnAttente) {
      if (texteLower === 'oui') {
        const c = confirmationEnAttente;
        const gain = c.taux * c.duree;
        await supabase.from('cours').insert({ eleve: c.nom, duree: c.duree, taux: c.taux, gain, chat_id: chatId });
        const cours = await getCoursMois();
        const totalCompletude = cours.reduce((s, x) => s + x.gain, 0);
        const manque = Math.max(0, OBJECTIF_COMPLETUDE - totalCompletude);
        const emoji = totalCompletude >= OBJECTIF_COMPLETUDE ? '🟢' : totalCompletude >= 1000 ? '🟡' : '🔴';
        confirmationEnAttente = null;
        await sendMessage(chatId,
          `✅ Cours avec *${c.nom}* enregistré !\n` +
          `💰 Gain : *+${gain.toFixed(2)} €*\n\n` +
          `${emoji} Complétude ce mois : *${totalCompletude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n` +
          `${manque > 0 ? `Il manque : *${manque.toFixed(0)} €*` : '🎉 Objectif atteint !'}`
        );
        return;
      }
      if (texteLower === 'non') {
        const nom = confirmationEnAttente.nom;
        confirmationEnAttente = null;
        await sendMessage(chatId, `❌ Cours avec *${nom}* non effectué — rien enregistré.`);
        return;
      }
    }

    // ── Commandes ───────────────────────────────────────────
    if (texte === '/start') {
      await sendMessage(chatId,
        `👋 Salut ! Je suis *L'Agent*, ton assistant comptable personnel.\n\n` +
        `*Commandes disponibles :*\n` +
        `📊 /bilan — dépenses du mois\n` +
        `📚 /completude — revenus Complétude\n` +
        `💰 /revenus — ajouter une rentrée d'argent\n` +
        `⛽ /essence — budget essence\n` +
        `🎯 /objectifs — progression épargne\n` +
        `🗓️ /synthese — synthèse complète\n` +
        `📋 /charges — voir les charges fixes\n\n` +
        `*Saisie rapide :*\n` +
        `💸 Dépense : _"Leclerc 45€"_\n` +
        `❓ Conseil : _"Est-ce que je peux acheter X ?"_`
      );
      return;
    }

    if (texte === '/bilan') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
      const cours = await getCoursMois();
      const completude = cours.reduce((s, c) => s + c.gain, 0);
      const totalRevenus = SALAIRE_LGM + BEAU_FRERE + completude;
      const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;

      let message = `📊 *Bilan ${nomMois(new Date())}*\n\n`;
      Object.entries(totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        message += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      message += `\n💰 *Solde estimé : ${solde >= 0 ? '+' : ''}${solde.toFixed(0)} €*`;
      await sendMessage(chatId, message);
      return;
    }

    if (texte === '/completude') {
      const cours = await getCoursMois();
      const total = cours.reduce((s, c) => s + c.gain, 0);
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - total);
      const emoji = total >= OBJECTIF_COMPLETUDE ? '🟢' : total >= 1000 ? '🟡' : '🔴';
      let msg = `📚 *Complétude ${nomMois(new Date())}*\n\n`;
      msg += `Cours effectués : *${cours.length}*\n`;
      msg += `${emoji} Total : *${total.toFixed(2)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
      msg += manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : `🎉 Objectif atteint !`;
      if (cours.length > 0) {
        msg += `\n\n*Détail :*\n`;
        cours.forEach(c => { msg += `• ${c.eleve} : +${c.gain.toFixed(2)} €\n`; });
      }
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/revenus') {
      await sendMessage(chatId,
        `💰 *Ajouter une rentrée d'argent*\n\nEnvoie-moi le montant et la source :\n_Ex: "Vinted 50€" ou "Remboursement 30€"_`
      );
      return;
    }

    if (texte === '/essence') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const dep = totaux['essence'];
      const restant = BUDGETS['essence'].max - dep;
      const emoji = restant < 0 ? '🔴' : restant < 50 ? '🟡' : '🟢';
      await sendMessage(chatId,
        `⛽ *Budget Essence*\n\nDépensé : ${dep.toFixed(0)} €\nBudget : ${BUDGETS['essence'].max} €\n${emoji} Restant : *${restant.toFixed(0)} €*`
      );
      return;
    }

    if (texte === '/objectifs') {
      const cours = await getCoursMois();
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
      const completude = cours.reduce((s, c) => s + c.gain, 0);
      const totalRevenus = SALAIRE_LGM + BEAU_FRERE + completude;
      const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;
      const epargneEstimee = EPARGNE_DEPART + solde;

      let msg = `🎯 *Objectifs épargne*\n\n`;
      msg += `💼 Épargne de départ : *${EPARGNE_DEPART.toLocaleString()} €*\n`;
      msg += `📈 Projection fin de mois : *${epargneEstimee.toFixed(0)} €*\n\n`;
      OBJECTIFS.forEach(o => {
        const delta = epargneEstimee - o.montant;
        const emoji = delta >= 0 ? '✅' : '⚠️';
        const pct = Math.min(100, Math.round((epargneEstimee / o.montant) * 100));
        msg += `${emoji} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
        msg += `   → ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} € (${pct}%)\n\n`;
      });
      msg += `_Hors tontine 13 000 €, indemnité RC et ARE — c'est du bonus !_ 🎁`;
      await sendMessage(chatId, msg);
      return;
    }

    if (texte === '/synthese') {
      await envoyerSyntheseMensuelle();
      return;
    }

    if (texte === '/charges') {
      let msg = `🔒 *Charges fixes mensuelles*\n\n`;
      Object.entries(CHARGES_FIXES).forEach(([k, v]) => {
        msg += `• ${k} : ${v.toFixed(0)} €\n`;
      });
      msg += `\n💸 *Total : ${TOTAL_CHARGES_FIXES.toFixed(0)} €/mois*`;
      await sendMessage(chatId, msg);
      return;
    }

    // ── Détection revenu supplémentaire ─────────────────────
    if (texteLower.includes('reçu') || texteLower.includes('virement') || texteLower.includes('vinted') || texteLower.includes('remboursement') || texteLower.includes('rentrée')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        await supabase.from('revenus').insert({ montant, libelle: texte, chat_id: chatId });
        await sendMessage(chatId, `✅ Rentrée de *+${montant} €* enregistrée !\n_${texte}_`);
        return;
      }
    }

    // ── Détection dépense ───────────────────────────────────
    const depense = parseDepense(texte);
    if (depense) {
      await supabase.from('depenses').insert({ montant: depense.montant, categorie: depense.cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[depense.cat].max - totaux[depense.cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[depense.cat].max * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId,
        `✅ *${depense.montant} €* enregistré — _${BUDGETS[depense.cat].label}_\n` +
        `${emoji} Budget restant : *${restant.toFixed(0)} €* / ${BUDGETS[depense.cat].max} €`
      );
      return;
    }

    // ── Question IA ─────────────────────────────────────────
    const depenses = await getDepensesMois();
    const totaux = await getTotauxParCat(depenses);
    const cours = await getCoursMois();
    const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
    const completude = cours.reduce((s, c) => s + c.gain, 0);
    const totalRevenus = SALAIRE_LGM + BEAU_FRERE + completude;
    const solde = totalRevenus - TOTAL_CHARGES_FIXES - totalDep;

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const context = `Tu es L'Agent, assistant comptable personnel de Nour-Dine. Réponds en français, direct, bienveillant, 3-4 lignes max.
Situation ce mois :
- Revenus : ${totalRevenus.toFixed(0)}€ (LGM ${SALAIRE_LGM}€ + beau-frère ${BEAU_FRERE}€ + Complétude ${completude.toFixed(0)}€)
- Charges fixes : ${TOTAL_CHARGES_FIXES.toFixed(0)}€
- Dépenses variables : ${totalDep.toFixed(0)}€
- Solde estimé : ${solde.toFixed(0)}€
- Épargne actuelle : ~${(EPARGNE_DEPART + solde).toFixed(0)}€
Budgets : ${Object.entries(totaux).map(([k,v]) => `${k}: ${v.toFixed(0)}€/${BUDGETS[k].max}€`).join(', ')}.
Objectifs : juin 12500€, août 15000€, jan2027 20000€.
Taux horaires élèves : Amel 21€, Benjamin 24.3€, Guillaume 23.88€, Margaux/Nélia 26.6€, Hélène 24.3€, Noélie 25.78€, Mathéo 23.66€, Anne-Gaëlle 24.08€, Saïda 25.56€, Serena 23.04€.
Si on te demande si une dépense est possible, analyse le solde restant et les objectifs épargne pour donner un conseil clair.`;

    await sendMessage(chatId, '🤔 *Analyse en cours...*');
    const result = await model.generateContent(context + '\n\nQuestion : ' + texte);
    await sendMessage(chatId, result.response.text());

  } catch (err) {
    console.error('Erreur:', err);
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
