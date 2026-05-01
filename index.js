const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const TOKEN = process.env.TELEGRAM_TOKEN;

const BUDGETS = {
  essence: 300, courses: 650, restos: 80, sante: 60,
  maison: 50, voiture: 50, shopping: 50, loisirs: 50, divers: 50
};

const FIXES = 2409;
const REVENUS_FIXES = 2945.94;

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

function detectCategorie(texte) {
  const t = texte.toLowerCase();
  if (t.includes('essence') || t.includes('esso') || t.includes('total') || t.includes('station') || t.includes('dlg') || t.includes('arcycom') || t.includes('certas')) return 'essence';
  if (t.includes('leclerc') || t.includes('courses') || t.includes('carrefour') || t.includes('lidl') || t.includes('cora')) return 'courses';
  if (t.includes('resto') || t.includes('restaurant') || t.includes('mcdonald') || t.includes('burger') || t.includes('pizza') || t.includes('panda') || t.includes('quick')) return 'restos';
  if (t.includes('médecin') || t.includes('pharmacie') || t.includes('doctolib') || t.includes('santé')) return 'sante';
  if (t.includes('ikea') || t.includes('maison') || t.includes('bricolage') || t.includes('castorama')) return 'maison';
  if (t.includes('garage') || t.includes('voiture') || t.includes('réparation')) return 'voiture';
  if (t.includes('vêtement') || t.includes('zara') || t.includes('shopping') || t.includes('coiffeur')) return 'shopping';
  if (t.includes('cinéma') || t.includes('loisir') || t.includes('sport') || t.includes('concert')) return 'loisirs';
  return 'divers';
}

function parseDepense(texte) {
  const montantMatch = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  if (!montantMatch) return null;
  const montant = parseFloat(montantMatch[1].replace(',', '.'));
  if (montant <= 0 || montant >= 5000) return null;
  return { montant, cat: detectCategorie(texte) };
}

async function getDepensesMois() {
  const debut = new Date();
  debut.setDate(1);
  debut.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('depenses').select('*').gte('created_at', debut.toISOString());
  return data || [];
}

async function getTotauxParCat(depenses) {
  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });
  return totaux;
}

async function analyseIA(question, totaux) {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const solde = REVENUS_FIXES - FIXES - totalDep;
  const context = `Tu es L'Agent, assistant comptable personnel. Réponds en français, 3-4 lignes max, direct et bienveillant.
Situation ce mois : Revenus fixes ${REVENUS_FIXES}€, Charges fixes ${FIXES}€, Dépenses variables ${totalDep.toFixed(0)}€, Solde estimé ${solde.toFixed(0)}€.
Dépenses : ${Object.entries(totaux).map(([k,v]) => `${k}: ${v.toFixed(0)}€/${BUDGETS[k]}€`).join(', ')}.
Objectifs épargne : juin 12500€, sept 14000€, jan2027 20000€.`;
  const result = await model.generateContent(context + '\n\nQuestion : ' + question);
  return result.response.text();
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const texte = msg.text.trim();

  try {
    if (texte === '/start') {
      await sendMessage(chatId,
        `👋 Salut ! Je suis *L'Agent*, ton assistant comptable.\n\n` +
        `💸 Dépense : _"Leclerc 45€"_\n` +
        `❓ Question : _"Est-ce que je peux acheter X ?"_\n` +
        `📊 /bilan — dépenses du mois\n` +
        `⛽ /essence — budget essence\n` +
        `🎯 /objectifs — progression épargne`
      );
      return;
    }

    if (texte === '/bilan') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
      const solde = REVENUS_FIXES - FIXES - totalDep;
      let message = `📊 *Bilan du mois*\n\n`;
      Object.entries(totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k] ? '🔴' : v > BUDGETS[k] * 0.8 ? '🟡' : '🟢';
        message += `${emoji} ${k}: ${v.toFixed(0)}€ / ${BUDGETS[k]}€\n`;
      });
      message += `\n💰 *Solde estimé : ${solde.toFixed(0)} €*`;
      await sendMessage(chatId, message);
      return;
    }

    if (texte === '/essence') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const dep = totaux['essence'];
      const restant = BUDGETS['essence'] - dep;
      const emoji = restant < 0 ? '🔴' : restant < 50 ? '🟡' : '🟢';
      await sendMessage(chatId, `⛽ *Budget Essence*\nDépensé : ${dep.toFixed(0)}€\nBudget : ${BUDGETS['essence']}€\n${emoji} Restant : ${restant.toFixed(0)}€`);
      return;
    }

    if (texte === '/objectifs') {
      await sendMessage(chatId,
        `🎯 *Objectifs épargne*\n\n` +
        `📅 Fin juin 2026 : *12 500 €*\n` +
        `📅 Septembre 2026 : *14 000 €*\n` +
        `📅 Janvier 2027 : *20 000 €*\n\n` +
        `_Hors tontine, RC et ARE — c'est du bonus !_ 🎁`
      );
      return;
    }

    const depense = parseDepense(texte);
    if (depense) {
      await supabase.from('depenses').insert({ montant: depense.montant, categorie: depense.cat, libelle: texte, chat_id: chatId });
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const restant = BUDGETS[depense.cat] - totaux[depense.cat];
      const emoji = restant < 0 ? '🔴' : restant < BUDGETS[depense.cat] * 0.2 ? '🟡' : '🟢';
      await sendMessage(chatId, `✅ *${depense.montant}€* enregistré en _${depense.cat}_\n${emoji} Restant : *${restant.toFixed(0)}€* / ${BUDGETS[depense.cat]}€`);
      return;
    }

    const depenses = await getDepensesMois();
    const totaux = await getTotauxParCat(depenses);
    await sendMessage(chatId, '🤔 Analyse en cours...');
    const reponse = await analyseIA(texte, totaux);
    await sendMessage(chatId, reponse);

  } catch (err) {
    console.error('Erreur:', err);
    await sendMessage(chatId, "❌ Erreur, réessaie dans quelques secondes.");
  }
});

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

module.exports = app;
