-- Localiza únicamente los pipelines iniciales vacíos creados por versiones
-- anteriores. No se modifican pipelines con tratos ni configuraciones distintas.

DO $$
DECLARE
  pipeline_record RECORD;
  stage_names TEXT[];
BEGIN
  FOR pipeline_record IN
    SELECT p.id
    FROM public.pipelines AS p
    WHERE p.name = 'Sales Pipeline'
      AND NOT EXISTS (
        SELECT 1
        FROM public.deals AS d
        WHERE d.pipeline_id = p.id
      )
  LOOP
    SELECT array_agg(ps.name ORDER BY ps.position, ps.created_at)
      INTO stage_names
    FROM public.pipeline_stages AS ps
    WHERE ps.pipeline_id = pipeline_record.id;

    IF stage_names = ARRAY[
      'New Lead',
      'Qualified',
      'Proposal Sent',
      'Negotiation',
      'Won'
    ] THEN
      UPDATE public.pipelines
      SET name = 'Pipeline comercial'
      WHERE id = pipeline_record.id;

      UPDATE public.pipeline_stages
      SET name = CASE position
        WHEN 0 THEN 'Nuevo prospecto'
        WHEN 1 THEN 'Calificado'
        WHEN 2 THEN 'Propuesta enviada'
        WHEN 3 THEN 'Negociación'
        WHEN 4 THEN 'Ganado'
        ELSE name
      END
      WHERE pipeline_id = pipeline_record.id;
    END IF;
  END LOOP;
END $$;
