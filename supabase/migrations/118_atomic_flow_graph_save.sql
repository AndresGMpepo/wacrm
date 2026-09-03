-- A flow header and its graph must change together. This function runs as
-- one transaction, so a failed node insert never leaves a flow empty.
CREATE OR REPLACE FUNCTION public.replace_flow_graph(
  p_account_id uuid,
  p_flow_id uuid,
  p_patch jsonb,
  p_nodes jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'nodes must be an array';
  END IF;

  UPDATE public.flows
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
    entry_node_id = CASE WHEN p_patch ? 'entry_node_id' THEN NULLIF(p_patch->>'entry_node_id', '') ELSE entry_node_id END,
    fallback_policy = CASE WHEN p_patch ? 'fallback_policy' THEN p_patch->'fallback_policy' ELSE fallback_policy END,
    updated_at = now()
  WHERE id = p_flow_id AND account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'flow not found';
  END IF;

  DELETE FROM public.flow_nodes WHERE flow_id = p_flow_id;

  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  SELECT
    p_flow_id,
    node.value->>'node_key',
    node.value->>'node_type',
    COALESCE(node.value->'config', '{}'::jsonb),
    COALESCE((node.value->>'position_x')::numeric, 0),
    COALESCE((node.value->>'position_y')::numeric, 0)
  FROM jsonb_array_elements(p_nodes) AS node(value);
END;
$$;

ALTER FUNCTION public.replace_flow_graph(uuid, uuid, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.replace_flow_graph(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_flow_graph(uuid, uuid, jsonb, jsonb) TO service_role;