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

// ============================================================
// ÉLÈVES
// ============================================================
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
  return Math.floor((new Date() - debut) / (7 * 24 * 60 * 60 * 1000)) % 2 === 0;
}

function nomMois(date) {
  return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
}

function detectCategorie(texte) {
  const t = texte.toLowerCase();
  if (t.includes('essence') || t.includes('esso') || t.includes('station') || t.includes('carburant') || t.includes('dlg') || t.includes('arcycom') || t.includes('certas') || t.includes('relais')) return 'essence';
  if (t.includes('leclerc') || t.includes('courses') || t.includes('carrefour') || t.includes('lidl') || t.includes('cora') || t.includes('supermarché')) return 'courses';
  if (t.includes('resto') || t.includes('restaurant') || t.includes('mcdonald') || t.includes('burger') || t.includes('pizza') || t.includes('panda') || t.includes('quick')) return 'restos';
  if (t.includes('médecin') || t.includes('pharmacie') || t.includes('doctolib') || t.includes('santé') || t.includes('docteur')) return 'sante';
  if (t.includes('ikea') || t.includes('maison') || t.includes('bricolage') || t.includes('castorama')) return 'maison';
  if (t.includes('garage') || t.includes('voiture') || t.includes('réparation') || t.includes('contrôle')) return 'voiture';
  if (t.includes('vêtement') || t.includes('zara') || t.includes('shopping') || t.includes('coiffeur')) return 'shopping';
  if (t.includes('cinéma') || t.includes('loisir') || t.includes('sport') || t.includes('concert')) return 'loisirs';
  return 'divers';
}

function parseDepense(texte) {
  const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  if (!match) return null;
  const montant = parseFloat(match[1].replace(',', '.'));
  if (montant <= 0 || montant >= 5000) return null;
  return { montant, cat: detectCategorie(texte) };
}

function trouverEleve(texte) {
  const t = texte.toLowerCase();
  return Object.keys(ELEVES).find(nom => t.includes(nom.toLowerCase()));
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
  const cours = await getCoursMois();
  const totalCompletude = cours.reduce((s, c) => s + c.gain, 0);
  const manque = Math.max(0, OBJECTIF_COMPLETUDE - totalCompletude);
  const emoji = totalCompletude >= OBJECTIF_COMPLETUDE ? '🟢' : totalCompletude >= 1000 ? '🟡' : '🔴';
  const tag = rattrapages ? ' _(rattrapage)_' : '';
  await sendMessage(chatId,
    `✅ Cours avec *${nomEleve}* enregistré${tag} !\n` +
    `💰 Gain : *+${gain.toFixed(2)} €*\n\n` +
    `${emoji} Complétude ce mois : *${totalCompletude.toFixed(0)} €* / ${OBJECTIF_COMPLETUDE} €\n` +
    `${manque > 0 ? `⚠️ Il manque : *${manque.toFixed(0)} €*` : '🎉 Objectif atteint !'}`
  );
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
  await sendMessage(chatId,
    `❌ Cours avec *${nomEleve}* non effectué\n` +
    `💸 Argent manqué : *-${gainManque.toFixed(2)} €*\n\n` +
    `_Tapez /manques pour voir le bilan des cours ratés_`
  );
}

// ============================================================
// GÉNÉRATION FICHE
// ============================================================
async function genererFiche(nomEleve, chapitre) {
  const profil = ELEVES[nomEleve];
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  let prompt = '';

  if (profil.ficheHebdo) {
    prompt = `Tu es un professeur de maths expert. Génère une fiche d'exercices hebdomadaire pour ${nomEleve}, élève de ${profil.niveau}.
Chapitre : ${chapitre}
FORMAT : 5 jours (Lundi→Vendredi), 2 exercices/jour, difficulté croissante, corrigé complet à la fin.
Commence par : "📚 FICHE HEBDOMADAIRE — ${nomEleve} — ${chapitre}"`;
  } else if (profil.tda) {
    prompt = `Tu es un professeur de maths expert spécialisé TDA. Génère une fiche pour ${nomEleve}, élève de ${profil.niveau}.
Chapitre : ${chapitre}
CONSIGNES TDA : exercices courts, consignes simples (1-2 phrases max), max 4 exercices, bien espacés, corrigé à la fin.
Commence par : "📚 FICHE D'EXERCICES — ${nomEleve} — ${chapitre}"`;
  } else {
    prompt = `Tu es un professeur de maths expert. Génère une fiche d'exercices pour ${nomEleve}, élève de ${profil.niveau}.
Chapitre : ${chapitre}
FORMAT : 4-5 exercices progressifs, adaptés au niveau ${profil.niveau}, corrigé complet à la fin.
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
    msg += `${delta >= 0 ? '✅' : '⚠️'} ${o.label} : ${o.montant.toLocaleString()} € (${delta >= 0 ? '+' : ''}${delta.toFixed(0)} €)\n`;
  });
  await sendMessage(CHAT_ID, msg);
}

// ============================================================
// SCHEDULER
// ============================================================
function demarrerScheduler() {
  // Ping pour garder le serveur éveillé
  setInterval(() => {
    fetch(`https://budget-bot-production-eaaf.up.railway.app/`).catch(() => {});
  }, 4 * 60 * 1000);

  setInterval(async () => {
    const now = heureParis();
    const jour = now.getDay();
    const heure = now.getHours();
    const minute = now.getMinutes();

    // Rappels bi-hebdo
    if ((jour === 3 || jour === 0) && heure === 20 && minute === 0) {
      await envoyerRappelBiHebdo();
    }

    // Synthèse fin de mois
    if (now.getDate() === 30 && heure === 20 && minute === 0) {
      await envoyerSyntheseMensuelle();
    }

    // Notifications fin de cours
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

      // CONFIRMATION COURS (auto ou manuel)
      if (etape === 'confirmation') {
        if (texteLower === 'oui') {
          if (profil.question2h) {
            etatConversation = { etape: 'question2h', nomEleve, source };
            await sendMessage(chatId, `✅ Super !\n\n*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
          } else {
            // Noélie : 1h fixe, pas de fiche
            const gain = profil.taux * profil.duree;
            await enregistrerCoursFait(chatId, nomEleve, gain, source === 'manuel');
            etatConversation = null;
          }
          return;
        }
        if (texteLower === 'non') {
          // Cours manqué — on calcule le gain manqué avec 1h par défaut
          const gainManque = profil.taux * 1;
          await enregistrerCoursManque(chatId, nomEleve, gainManque);
          etatConversation = null;
          return;
        }
      }

      // QUESTION 2H
      if (etape === 'question2h') {
        if (texteLower === 'oui' || texteLower === 'non') {
          const heuresPay = texteLower === 'oui' ? 2 : 1;
          const gain = profil.taux * heuresPay;
          await enregistrerCoursFait(chatId, nomEleve, gain, source === 'manuel');

          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve, gain, source };
            await sendMessage(chatId,
              `📝 *Qu'avez-vous vu aujourd'hui avec ${nomEleve} ?*\n\n_Ex: Fractions, Théorème de Pythagore..._`
            );
          } else {
            etatConversation = null;
          }
          return;
        }
      }

      // CHAPITRE POUR FICHE
      if (etape === 'chapitre') {
        await sendMessage(chatId, `🤔 *Génération de la fiche...*`);
        const fiche = await genererFiche(nomEleve, texte);
        await sendMessage(chatId, fiche);
        etatConversation = null;
        return;
      }

      // COURS MANUEL — NOM ÉLÈVE
      if (etape === 'cours_manuel_nom') {
        const eleve = trouverEleve(texte);
        if (eleve) {
          etatConversation = { etape: 'cours_manuel_type', nomEleve: eleve, source: 'manuel' };
          await sendMessage(chatId,
            `📚 Cours avec *${eleve}*\n\nC'est un *rattrapage* ou un cours *normal* supplémentaire ?\n\nRéponds *rattrapage* ou *normal*`
          );
        } else {
          await sendMessage(chatId, `❓ Je n'ai pas reconnu le prénom. Élèves : ${Object.keys(ELEVES).join(', ')}`);
        }
        return;
      }

      // COURS MANUEL — TYPE (rattrapage ou normal)
      if (etape === 'cours_manuel_type') {
        const estRattrapage = texteLower.includes('rattrapage');
        const profil = ELEVES[nomEleve];
        if (profil.question2h) {
          etatConversation = { etape: 'question2h', nomEleve, source: estRattrapage ? 'rattrapage' : 'manuel' };
          await sendMessage(chatId, `*C'est la séance à 2h ?*\n\nRéponds *oui* ou *non*`);
        } else {
          const gain = profil.taux * profil.duree;
          await enregistrerCoursFait(chatId, nomEleve, gain, true);
          if (profil.fiche) {
            etatConversation = { etape: 'chapitre', nomEleve, gain, source: 'manuel' };
            await sendMessage(chatId, `📝 *Qu'avez-vous vu ?*`);
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
        `👋 Salut ! Je suis *L'Agent*, ton assistant personnel.\n\n` +
        `*📚 Complétude :*\n` +
        `• /cours — signaler un cours fait\n` +
        `• /completude — revenus du mois\n` +
        `• /manques — cours ratés et argent perdu\n\n` +
        `*💰 Finances :*\n` +
        `• /bilan — dépenses du mois\n` +
        `• /objectifs — progression épargne\n` +
        `• /synthese — bilan complet\n` +
        `• /charges — charges fixes\n\n` +
        `*Saisie rapide :*\n` +
        `💸 _"Leclerc 45€"_ — dépense\n` +
        `💰 _"Salaire 2625€"_ — salaire\n` +
        `💎 _"Épargne 9500€"_ — épargne\n` +
        `❓ _Pose n'importe quelle question !_`
      );
      return;
    }

    // Signaler un cours manuellement
    if (texte === '/cours') {
      etatConversation = { etape: 'cours_manuel_nom' };
      const liste = Object.keys(ELEVES).join(', ');
      await sendMessage(chatId, `📚 *Quel élève ?*\n\n${liste}`);
      return;
    }

    if (texte === '/bilan') {
      const ctx = await getContextFinancier();
      let message = `📊 *Bilan ${nomMois(new Date())}*\n\n`;
      Object.entries(ctx.totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k].max ? '🔴' : v > BUDGETS[k].max * 0.8 ? '🟡' : '🟢';
        message += `${emoji} ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€\n`;
      });
      message += `\n💰 *Solde estimé : ${ctx.solde >= 0 ? '+' : ''}${ctx.solde.toFixed(0)} €*`;
      await sendMessage(chatId, message);
      return;
    }

    if (texte === '/completude') {
      const ctx = await getContextFinancier();
      const manque = Math.max(0, OBJECTIF_COMPLETUDE - ctx.completude);
      const emoji = ctx.completude >= OBJECTIF_COMPLETUDE ? '🟢' : ctx.completude >= 1000 ? '🟡' : '🔴';
      let msg = `📚 *Complétude ${nomMois(new Date())}*\n\n`;
      msg += `Cours effectués : *${ctx.cours.length}*\n`;
      msg += `${emoji} Total : *${ctx.completude.toFixed(2)} €* / ${OBJECTIF_COMPLETUDE} €\n`;
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
        const pct = Math.min(100, Math.round((ctx.epargneEstimee / o.montant) * 100));
        msg += `${delta >= 0 ? '✅' : '⚠️'} *${o.label}* : ${o.montant.toLocaleString()} €\n`;
        msg += `   → ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} € (${pct}%)\n\n`;
      });
      msg += `_Hors tontine 13 000 €, RC et ARE — c'est du bonus !_ 🎁`;
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

    // Signalement cours manuel via texte libre
    // Ex: "J'ai fait cours avec Hélène" / "Rattrapage avec Margaux"
    if (texteLower.includes('fait cours') || texteLower.includes('rattrapage') || texteLower.includes('cours avec') || texteLower.includes('j\'ai eu cours')) {
      const eleve = trouverEleve(texte);
      if (eleve) {
        const estRattrapage = texteLower.includes('rattrapage');
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

    // Annulation cours via texte libre
    // Ex: "Pas de cours avec Benjamin" / "Benjamin absent"
    if (texteLower.includes('pas de cours') || texteLower.includes('absent') || texteLower.includes('annulé') || texteLower.includes('pas fait cours')) {
      const eleve = trouverEleve(texte);
      if (eleve) {
        const gainManque = ELEVES[eleve].taux * 1;
        await enregistrerCoursManque(chatId, eleve, gainManque);
        return;
      }
    }

    // Mise à jour épargne
    if (texteLower.includes('épargne') || texteLower.includes('epargne') || texteLower.includes('économies')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        if (montant > 1000) {
          await supabase.from('epargne').insert({ montant, libelle: texte, chat_id: chatId });
          await sendMessage(chatId, `✅ Épargne mise à jour : *${montant.toLocaleString()} €* 💎`);
          return;
        }
      }
    }

    // Saisie salaire
    if (texteLower.includes('salaire') || texteLower.includes('lgm') || texteLower.includes('paie')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        if (montant > 1000 && montant < 10000) {
          await supabase.from('salaires').insert({ montant, libelle: texte, chat_id: chatId });
          await sendMessage(chatId, `✅ Salaire LGM enregistré : *${montant} €* 📊`);
          return;
        }
      }
    }

    // Rentrée d'argent
    if (texteLower.includes('reçu') || texteLower.includes('vinted') || texteLower.includes('remboursement') || texteLower.includes('rentrée') || texteLower.includes('participation')) {
      const match = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
      if (match) {
        const montant = parseFloat(match[1].replace(',', '.'));
        await supabase.from('revenus').insert({ montant, libelle: texte, chat_id: chatId });
        await sendMessage(chatId, `✅ Rentrée de *+${montant} €* enregistrée !`);
        return;
      }
    }

    // Dépense
    const depense = parseDepense(texte);
    if (depense && !texteLower.includes('cours') && !texteLower.includes('élève')) {
      await supabase.from('depenses').insert({ montant: depense.montant, categorie: depense.cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[depense.cat].max - totaux[depense.cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[depense.cat].max * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId,
        `✅ *${depense.montant} €* — _${BUDGETS[depense.cat].label}_\n` +
        `${emoji} Restant : *${restant.toFixed(0)} €* / ${BUDGETS[depense.cat].max} €`
      );
      return;
    }

    // ── QUESTION IA ─────────────────────────────────────────
    const ctx = await getContextFinancier();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const coursParEleve = {};
    ctx.cours.forEach(c => {
      if (!coursParEleve[c.eleve]) coursParEleve[c.eleve] = { nb: 0, gain: 0 };
      coursParEleve[c.eleve].nb++;
      coursParEleve[c.eleve].gain += c.gain;
    });

    const context = `Tu es L'Agent, assistant comptable et conseiller personnel de Nour-Dine. Tu es direct, bienveillant, intelligent et interactif.
Tu réponds en français, de manière conversationnelle et naturelle.
Tu peux répondre à TOUTES les questions — finances, achats, conseils de vie, formations, etc.
Si on te demande un prix, donne une estimation réaliste du marché français actuel.
Sois conversationnel — parle comme un ami conseiller intelligent.

=== PROFIL DE NOUR-DINE ===
- Ingénieur cadre chez LGM (mission Thales), départ prévu août 2026 via rupture conventionnelle
- Co-fondateur de Dyneos SAS (CFA, formations professionnelles)
- Tuteur chez Complétude (11 élèves actifs)
- Certification formateur incendie en cours (Fo.EPI juin 2026, SSIAP 1 juillet 2026)
- Vit en Île-de-France (Carrières-sous-Poissy), en PACS
- Objectif : indépendance via formation incendie + Complétude + Dyneos

=== SITUATION FINANCIÈRE CE MOIS ===
- Salaire LGM : ${ctx.salaire} €
- Beau-frère : ${BEAU_FRERE} € (jusqu'en novembre 2026)
- Complétude : ${ctx.completude.toFixed(0)} € / ${OBJECTIF_COMPLETUDE} € objectif
- Total revenus : ${ctx.totalRevenus.toFixed(0)} €
- Charges fixes : ${TOTAL_CHARGES_FIXES.toFixed(0)} €/mois
- Dépenses variables : ${ctx.totalDep.toFixed(0)} €
- Solde estimé : ${ctx.solde.toFixed(0)} €
- Épargne actuelle : ${ctx.epargneBase.toLocaleString()} €
- Épargne projetée fin de mois : ${ctx.epargneEstimee.toFixed(0)} €

=== BUDGETS ===
${Object.entries(ctx.totaux).map(([k,v]) => `- ${BUDGETS[k].label} : ${v.toFixed(0)}€ / ${BUDGETS[k].max}€`).join('\n')}

=== OBJECTIFS ÉPARGNE ===
- Fin juin 2026 : 12 500 € (projection : ${ctx.epargneEstimee.toFixed(0)} €)
- Fin août 2026 : 15 000 €
- Janvier 2027 : 20 000 € (hors tontine 13 000 € = bonus)

=== ÉLÈVES COMPLÉTUDE ===
11 élèves actifs : Amel 21,04€/h (5e), Benjamin 24,30€/h (5e), Guillaume 23,88€/h (5e TDA), Margaux 26,60€/h (3e), Nélia 26,60€/h (3e), Hélène 24,30€/h (5e), Noélie 25,78€/h (CE2), Mathéo 23,66€/h (3e), Anne-Gaëlle 24,08€/h (3e), Saïda 25,56€/h (5e), Serena 23,04€/h (5e)
Ce mois : ${Object.entries(coursParEleve).map(([e,d]) => `${e} ${d.nb} cours +${d.gain.toFixed(0)}€`).join(', ') || 'aucun cours enregistré'}
Cours manqués : ${ctx.coursManques.length} cours — -${ctx.totalManque.toFixed(0)} €

=== RÈGLES ===
1. Question achat → prix marché français + analyse budget
2. Question financière → données réelles ci-dessus
3. Question élève → infos des élèves ci-dessus
4. Question générale → réponds naturellement
5. 4-6 lignes max sauf question complexe`;

    await sendMessage(chatId, '🤔 *Analyse en cours...*');
    const result = await model.generateContent(context + '\n\nQuestion de Nour-Dine : ' + texte);
    await sendMessage(chatId, result.response.text());

  } catch (err) {
    console.error('Erreur:', err.message);
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
