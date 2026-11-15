-- Suivi des formations dispensées (maintenance, incendie, autre...) — facturation par session réalisée
-- À exécuter dans le SQL Editor Supabase (projet "budget")

create table if not exists public.sessions_formation (
  id            bigint generated always as identity primary key,
  created_at    timestamptz default now(),
  chat_id       text,
  entite        text not null default 'perso' check (entite in ('perso','dyneos')),
  date_session  date not null default current_date,
  intitule      text not null,                 -- ex: "Maintenance niveau 1", "Incendie EPI"
  theme         text,                          -- maintenance | incendie | autre (libre)
  client        text,                          -- centre de formation / entreprise
  nb_heures     numeric,
  nb_stagiaires integer,
  montant       numeric not null check (montant >= 0),
  num_facture   text,
  date_echeance date,
  statut        text not null default 'a_facturer'
                check (statut in ('a_facturer','facturee','payee')),
  date_paiement date,                          -- c'est elle qui compte pour l'URSSAF (encaissement)
  revenu_id     bigint,                        -- ligne créée dans `revenus` à l'encaissement
  notes         text
);

create index if not exists sessions_formation_paiement_idx on public.sessions_formation (date_paiement);
create index if not exists sessions_formation_statut_idx   on public.sessions_formation (statut);

alter table public.sessions_formation enable row level security;
-- Même logique que les autres tables : accès via la clé service du bot (pas de policy publique).

-- Taux de cotisations en config (À VÉRIFIER sur urssaf.fr, il change d'une année à l'autre)
insert into public.config (cle, valeur) values
  ('taux_cotisations_formation', 0.256),   -- BNC micro : à vérifier
  ('taux_cfp_formation',        0.002),    -- contribution formation professionnelle : à vérifier
  ('plafond_micro_bnc',         83600)     -- plafond CA micro-BNC : à vérifier
on conflict (cle) do nothing;

-- Vue : CA encaissé et cotisations à provisionner par mois d'encaissement
create or replace view public.v_formations_mensuel as
select
  date_trunc('month', date_paiement)::date                       as mois,
  entite,
  coalesce(theme, 'autre')                                       as theme,
  count(*)                                                       as nb_sessions,
  sum(montant)                                                   as ca_encaisse,
  round(sum(montant) * (
    (select valeur from public.config where cle = 'taux_cotisations_formation') +
    (select valeur from public.config where cle = 'taux_cfp_formation')
  ), 2)                                                          as cotisations_a_provisionner
from public.sessions_formation
where statut = 'payee' and date_paiement is not null
group by 1, 2, 3
order by 1 desc;
