const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);
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
  if (t.includes('essence') || t.includes('esso') || t.includes('total') || t.includes('station') || t.includes('leclerc') && t.includes('carbu')) return 'essence';
  if (t.includes('leclerc') || t.includes('courses') || t.includes('cora') || t.includes('carrefour') || t.includes('lidl') || t.includes('aldi')) return 'courses';
  if (t.includes('resto') || t.includes('restaurant') || t.includes('mcdonald') || t.includes('burger') || t.includes('pizza') || t.includes('sushi')) return 'restos';
  if (t.includes('médecin') || t.includes('docteur') || t.includes('pharmacie') || t.includes('doctolib') || t.includes('santé')) return 'sante';
  if (t.includes('ikea') || t.includes('maison') || t.includes('bricolage') || t.includes('castorama')) return 'maison';
  if (t.includes('garage') || t.includes('voiture') || t.includes('réparation') || t.includes('contrôle')) return 'voiture';
  if (t.includes('vêtement') || t.includes('zara') || t.includes('h&m') || t.includes('shopping')) return 'shopping';
  if (t.includes('cinéma') || t.includes('loisir') || t.includes('sport') || t.includes('sortie')) return 'loisirs';
  return 'divers';
}

function parseDepense(texte) {
  const montantMatch = texte.match(/(\d+([.,]\d{1,2})?)\s*€?/);
  if (!montantMatch) return null;
  const montant = parseFloat(montantMatch[1].replace(',', '.'));
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
  depenses.forEach(d => { if (totaux[d.categorie] !== undefined) totaux[d.categorie] += d.montant; });
  return totaux;
}

async function analyseIA(question, depenses, totaux) {
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  const context = `
Tu es L'Agent, un assistant comptable personnel intelligent et direct.
Voici la situation financière de l'utilisateur ce mois-ci :

REVENUS FIXES : ${REVENUS_FIXES} €/mois (salaire LGM + beau-frère)
CHARGES FIXES : ${FIXES} €/mois
SOLDE ESTIMÉ CE MOIS : ${REVENUS_FIXES - FIXES - Object.values(totaux).reduce((a,b) => a+b, 0)} €

DÉPENSES PAR CATÉGORIE CE MOIS :
${Object.entries(totaux).map(([k, v]) => `- ${k}: ${v.toFixed(2)}€ / ${BUDGETS[k]}€ budget`).join('\n')}

OBJECTIFS D'ÉPARGNE :
- Fin juin 2026 : 12 500 €
- Septembre 2026 : 14 000 €
- Janvier 2027 : 20 000 €

Réponds en français, de manière directe et concise. Maximum 3-4 lignes.
Si l'utilisateur veut faire un achat, dis-lui clairement si c'est une bonne idée ou pas.
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
    // Commandes
    if (texte === '/start') {
      return bot.sendMessage(chatId, `👋 Salut ! Je suis L'Agent, ton assistant comptable personnel.\n\nEnvoie-moi :\n💸 Une dépense : "Leclerc 45€"\n❓ Une question : "Est-ce que je peux acheter X ?"\n📊 /bilan pour voir tes dépenses du mois\n⛽ /essence pour voir ton budget essence`);
    }

    if (texte === '/bilan') {
      const depenses = await getDepensesMois();
      const totaux = await getTotauxParCat(depenses);
      const totalDep = Object.values(totaux).reduce((a, b) => a + b, 0);
      const solde = REVENUS_FIXES - FIXES - totalDep;

      let msg = `📊 *Bilan du mois*\n\n`;
      Object.entries(totaux).forEach(([k, v]) => {
        const emoji = v > BUDGETS[k] ? '🔴' : v > BUDGETS[k] * 0.8 ? '🟡' : '🟢';
        msg += `${emoji} ${k}: ${v.toFixed(0)}€ / ${BUDGETS[k]}€\n`;
      });
      msg += `\n💰 Solde estimé : ${solde.toFixed(0)}€`;
      return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }

    // Détecter si c'est une dépense
    const depense = parseDepense(texte);
    if (depense && depense.montant > 0 && depense.montant < 5000) {
      // Enregistrer dans Supabase
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

      return bot.sendMessage(chatId,
        `✅ ${depense.montant}€ enregistré en *${depense.cat}*\n${emoji} Budget restant : ${budgetRestant.toFixed(0)}€ / ${BUDGETS[depense.cat]}€`,
        { parse_mode: 'Markdown' }
      );
    }

    // Sinon c'est une question → IA
    const depenses = await getDepensesMois();
    const totaux = await getTotauxParCat(depenses);
    const reponse = await analyseIA(texte, depenses, totaux);
    bot.sendMessage(chatId, reponse);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "Une erreur s'est produite, réessaie.");
  }
});

app.get('/', (req, res) => res.send("L'Agent est en ligne !"));

module.exports = app;
