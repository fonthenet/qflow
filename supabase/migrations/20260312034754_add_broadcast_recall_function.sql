
CREATE OR REPLACE FUNCTION public.broadcast_recall(
  p_office_id uuid,
  p_ticket_id uuid,
  p_ticket_number text,
  p_desk_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'ticket_number', p_ticket_number,
      'desk_id', p_desk_id
    ),
    'ticket_recall',
    'recall-' || p_office_id::text,
    false
  );
END;
$$;
;
