-- Versao 1.4.0: associacao segura entre termo e titular cadastrado.
BEGIN;
ALTER TABLE public.termos_equipamentos
  ADD COLUMN IF NOT EXISTS retirante_usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Apenas correspondencia de CPF unico permite preencher a titularidade antiga.
UPDATE public.termos_equipamentos AS t
SET retirante_usuario_id = d.usuario_id
FROM (SELECT cpf, min(usuario_id::text)::uuid AS usuario_id
      FROM public.dados_retirantes GROUP BY cpf HAVING count(*) = 1) AS d
WHERE t.retirante_usuario_id IS NULL
  AND (t.dados #>> '{retirante,cpf}')=d.cpf;
CREATE INDEX IF NOT EXISTS termos_equipamentos_titular_idx
  ON public.termos_equipamentos(retirante_usuario_id);
COMMIT;
