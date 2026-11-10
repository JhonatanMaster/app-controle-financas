-- A nota fiscal tambem pode ser informada pela pessoa, alem de lida pelo QR Code.
--
-- A consulta publica da SEFAZ SP recusa conexoes de IPs de datacenter, inclusive da AWS em Sao
-- Paulo. A leitura automatica passa a depender do servico comunica sefaz, que roda numa internet
-- residencial, e quando ele esta desligado a nota precisa entrar de outro jeito. Ela vira entao um
-- dado da compra, a chave de acesso ou so o numero, digitado ao registrar a compra avulsa, ao
-- finalizar ou depois, ao editar.

-- Quem so tem o numero impresso no cupom, sem a chave, tambem pode registrar
alter type fiscal_note_status add value if not exists 'so_numero';

alter table fiscal_notes
  alter column access_key drop not null,
  alter column model drop not null,
  alter column uf_code drop not null,
  add constraint fiscal_notes_chave_ou_numero check (access_key is not null or number is not null);

-- A nota informada pode ser corrigida, ao contrario da importada, que era o retrato do que a SEFAZ
-- devolveu e continua imutavel
create policy "members can update informed fiscal notes" on fiscal_notes
  for update
  using (private.is_family_member(family_id) and status <> 'importada')
  with check (private.is_family_member(family_id) and status <> 'importada');
