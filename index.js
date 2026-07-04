-- Dépenses véhicule (assurance, CT, réparations, équipement...)
create table turo_depenses (
  id bigint generated always as identity primary key,
  montant numeric not null,
  categorie text not null, -- 'assurance','ct','reparation','entretien','equipement','autre'
  libelle text,
  recurrent boolean default false, -- true = mensuel (ex: assurance), false = ponctuel (ex: CT)
  chat_id text,
  created_at timestamptz default now()
);

-- Locations Turo (une ligne par réservation/voyage)
create table turo_locations (
  id bigint generated always as identity primary key,
  locataire text,
  date_debut date,
  date_fin date,
  revenu_brut numeric,        -- prix du voyage (ex: 148.00€)
  frais_turo numeric,         -- frais Turo (ex: 17.98€)
  revenu_net numeric,         -- revenu_brut - frais_turo (ex: 101.90€)
  part_cousin numeric,        -- revenu_net * 50%
  part_moi numeric,           -- revenu_net * 50%
  chat_id text,
  created_at timestamptz default now()
);
