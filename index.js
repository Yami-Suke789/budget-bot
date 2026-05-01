const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { webHook: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);

const BUDGETS = {
  essence: 300, courses: 650, restos: 80, sante: 60,
  maison: 50, voiture: 50, shopping: 50, loisirs: 50, divers: 50
};

const FIXES = 2409;
const REVENUS_FIXES = 2945.94;

function detectCategorie(texte) {
  const t = texte.toLowerCase();
  if (t.includes('essence') || t.includes('esso') || t.includes('total') || t.includes('station') || t.includes('leclerc') && t.includes('carbu') || t.includes('dlg') || t.includes('arcycom') || t.includes('certas') || t.includes('cora') && t.includes('carbu')) return 'essence';
  if (t.includes('leclerc') || t.includes('courses') || t.includes('carrefour') || t.includes('lidl') || t.includes('aldi') || t.includes('cora')) return 'courses';
  if (t.includes('resto') || t.includes('restaurant') || t.includes('mcdonald') || t.includes('burger') || t.includes('pizza') || t.includes('sushi') || t.includes('panda') || t.includes('berliner') || t.includes('quick')) return 'restos';
  if (t.includes('médecin') || t.includes('docteur') || t.includes('pharmacie') || t.includes('doctolib') || t.includes('santé') || t.includes('doctor')) return 'sante';
  if (t.includes('ikea') || t.includes('maison') || t.includes('bricolage') || t.includes('castorama')) return 'maison';
  if (t.includes('garage') || t.includes('voiture') || t.includes('réparation') || t.includes('contrôle technique')) return 'voiture';
  if (t.includes('vêtement') || t.includes('zara') || t.includes('h&m') || t.includes('shopping') || t.includes('coiffeur')) return 'shopping';
  if (t.includes('cinéma') || t.includes('loisir') || t.includes('sport') || t.includes('sortie') || t.includes('concert')) return 'loisirs';
  return 'divers';
}

function parseDepense(texte) {
  const montantMatch = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  if (!montantMatch) return null;
  const montant = parseFloat(montantMatch[1].replace(',', '.'));
  if (montant <= 0 || montant >= 5000) return null;
  const cat = detectCategorie(texte);
  return { montant, cat };
}

async function getDepensesMois() {
  const debut = new Date();
  debut.setDate(1);
  debut.setHours(0, 0, 0, 0);
  const { data } = await supabase
    .from('depenses')
    .select('*')
    .gte('created_at', debut.toISOString());
  return data || [];
}

async function getTotauxParCat(depenses) {
  const totaux = {};
  Object.keys(BUDGETS).forEach(k => totaux[k] = 0);
  depenses.forEach(d => {
    if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant;
  });
  return totaux;
}

async function analyseIA(question, totaux) {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
  const solde = REVENUS_FIXES - FIXES - totalDep;

  const context = `
Tu es L'Agent, un assistant comptable personnel intelligent, direct et bienveillant.
Tu parles en français, de manière concise (3-4 lignes max).

Situation financière ce mois :
- Revenus fixes : ${REVENUS_FIXES} €
- Charges fixes : ${FIXES} €
- Total dépenses variables : ${totalDep.toFixed(0)} €
- Solde estimé : ${solde.toFixed(0)} €

Dépenses par catégorie ce mois :
${Object.entries(totaux).map(([k, v]) => `- ${k}: ${v.toFixed(0)}€ / ${BUDGETS[k]}€ budget`).join('\n')}

Objectifs épargne :
- Fin juin 2026 : 12 500 €
- Septembre 2026 : 14 000 €
- Janvier 2027 : 20 000 €

Réponds directement à la question. Si c'est un achat, dis clairement si c'est une bonne idée ou pas.
`;

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
      await bot.sendMessage(chatId,
        `👋 Salut ! Je suis *L'Agent*, ton assistant comptable personnel.\n\n` +
        `Envoie-moi :\n` +
        `💸 Une dépense : *"Leclerc 45€"*\n` +
        `❓ Une question : *"Est-ce que je peux acheter X ?"*\n` +
        `📊 */bilan* pour voir tes dépenses du mois\n` +
        `⛽ */essence* pour ton budget essence\n` +
        `🎯 */objectifs* pour voir ta progression épargne`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (texte === '/bilan') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
      const solde = REVENUS_FIXES - FIXES - totalDep;

      let message = `📊 *Bilan ${new Date().toLocaleString('fr-FR', { month: 'long' })}*\n\n`;
      Object.entries(totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k] ? '🔴' : v > BUDGETS[k] * 0.8 ? '🟡' : '🟢';
        message += `${emoji} ${k}: ${v.toFixed(0)}€ / ${BUDGETS[k]}€\n`;
      });
      message += `\n💰 *Solde estimé : ${solde.toFixed(0)} €*`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      return;
    }

    if (texte === '/essence') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const depEssence = totaux['essence'];
      const restant = BUDGETS['essence'] - depEssence;
      const emoji = restant < 0 ? '🔴' : restant < 50 ? '🟡' : '🟢';
      
      await bot.sendMessage(chatId,
        `⛽ *Budget Essence*\n\n` +
        `Dépensé : ${depEssence.toFixed(0)} €\n` +
        `Budget : ${BUDGETS['essence']} €\n` +
        `${emoji} Restant : ${restant.toFixed(0)} €`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (texte === '/objectifs') {
      await bot.sendMessage(chatId,
        `🎯 *Objectifs épargne*\n\n` +
        `📅 Fin juin 2026 : *12 500 €*\n` +
        `📅 Septembre 2026 : *14 000 €*\n` +
        `📅 Janvier 2027 : *20 000 €*\n\n` +
        `_Hors tontine, indemnité RC et ARE — tout ça c'est du bonus !_ 🎁`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Détecter dépense
    const depense = parseDepense(texte);
    if (depense) {
      await supabase.from('depenses').insert({
        montant: depense.montant,
        categorie: depense.cat,
        libelle: texte,
        chat_id: chatId
      });

      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const budgetRestant = BUDGETS[depense.cat] - totaux[depense.cat];
      const emoji = budgetRestant < 0 ? '🔴' : budgetRestant < BUDGETS[depense.cat] * 0.2 ? '🟡' : '🟢';

      await bot.sendMessage(chatId,
        `✅ *${depense.montant} €* enregistré en _${depense.cat}_\n` +
        `${emoji} Budget restant : *${budgetRestant.toFixed(0)} €* / ${BUDGETS[depense.cat]} €`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Question IA
    const depenses = await getDepensesMois();
    const totaux = await getTotauxParCat(depenses);
    await bot.sendMessage(chatId, '🤔 Analyse en cours...');
    const reponse = await analyseIA(texte, totaux);
    await bot.sendMessage(chatId, reponse);

  } catch (err) {
    console.error('Erreur:', err);
    await bot.sendMessage(chatId, "❌ Une erreur s'est produite, réessaie dans quelques secondes.");
  }
});

app.get('/', (req, res) => res.send("L'Agent est en ligne ! 🤖"));

module.exports = app;
