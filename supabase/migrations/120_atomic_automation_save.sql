-- Keep an automation definition coherent when its header and step tree are
-- saved together. A failed insert rolls back the header and prior steps.
CREATE OR REPLACE FUNCTION public.replace_automation_definition(
  p_account_id uuid,
  p_automation_id uuid,
  p_patch jsonb,
  p_steps jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'steps must be an array';
  END IF;

  UPDATE public.automations
  SET
    name = COALESCE(p_patch->>'name', name),
    description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
    trigger_type = COALESCE(p_patch->>'trigger_type', trigger_type),
    trigger_config = CASE WHEN p_patch ? 'trigger_config' THEN p_patch->'trigger_config' ELSE trigger_config END,
    channel_types = CASE
      WHEN p_patch ? 'channel_types' AND p_patch->'channel_types' = 'null'::jsonb THEN NULL
      WHEN p_patch ? 'channel_types' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'channel_types'))
      ELSE channel_types
    END,
    is_active = CASE WHEN p_patch ? 'is_active' THEN (p_patch->>'is_active')::boolean ELSE is_active END,
    updated_at = now()
  WHERE id = p_automation_id AND account_id = p_account_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'automation not found'; END IF;

  DELETE FROM public.automation_steps WHERE automation_id = p_automation_id;
  INSERT INTO public.automation_steps (
    id, automation_id, parent_step_id, branch, step_type, step_config, position
  )
  SELECT
    (step.value->>'id')::uuid,
    p_automation_id,
    NULLIF(step.value->>'parent_step_id', '')::uuid,
    NULLIF(step.value->>'branch', ''),
    step.value->>'step_type',
    COALESCE(step.value->'step_config', '{}'::jsonb),
    COALESCE((step.value->>'position')::integer, 0)
  FROM jsonb_array_elements(p_steps) AS step(value);
END;
$$;

ALTER FUNCTION public.replace_automation_definition(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replace_automation_definition(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_automation_definition(uuid, uuid, jsonb, jsonb) TO service_role;