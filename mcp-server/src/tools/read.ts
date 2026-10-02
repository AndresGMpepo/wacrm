// ============================================================
// Read-only tools — always registered.
//
// whoami + list/read of contacts, conversations, messages, and
// broadcast status. None of these change state, so they're safe to
// expose unconditionally. Each carries readOnlyHint so clients can
// surface them without a confirmation prompt.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NexoOmniClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerReadTools(server: McpServer, client: NexoOmniClient): void {
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Verify the API key and show which NexoOmni account it is bound to and what scopes it carries. Call this first to discover what actions are possible.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Who am I' },
    },
    handle(async () => jsonResult(await client.me())),
  );

  server.registerTool(
    'list_contacts',
    {
      title: 'List contacts',
      description:
        'List contacts in the CRM, newest first. Optionally filter by a free-text search (matches name or phone) or by a tag id. Results are paginated: pass the returned next_cursor to fetch the next page.',
      inputSchema: {
        search: z.string().optional().describe('Free-text search over name or phone number.'),
        tag: z.string().optional().describe('Tag id to filter by.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor from a previous response.'),
      },
      annotations: { ...READ_ONLY, title: 'List contacts' },
    },
    handle(async (args) => jsonResult(await client.listContacts(args))),
  );

  server.registerTool(
    'get_contact',
    {
      title: 'Get contact',
      description: 'Read a single contact by its id.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get contact' },
    },
    handle(async ({ id }) => jsonResult(await client.getContact(id))),
  );

  server.registerTool(
    'list_conversations',
    {
      title: 'List conversations',
      description:
        'List conversations, newest first. Optionally filter by status (open / pending / closed) or by contact id. Paginated.',
      inputSchema: {
        status: z.enum(['open', 'pending', 'closed']).optional().describe('Conversation status filter.'),
        contact_id: z.string().optional().describe('Only conversations for this contact.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List conversations' },
    },
    handle(async (args) => jsonResult(await client.listConversations(args))),
  );

  server.registerTool(
    'get_conversation',
    {
      title: 'Get conversation',
      description: 'Read a single conversation by id, including its contact and tags.',
      inputSchema: {
        id: z.string().describe('Conversation id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get conversation' },
    },
    handle(async ({ id }) => jsonResult(await client.getConversation(id))),
  );

  server.registerTool(
    'list_conversation_notes',
    {
      title: 'List internal notes',
      description:
        'List the private team notes on a conversation, newest first — things the team wrote for each other, never sent to the customer. Paginated.',
      inputSchema: {
        conversation_id: z.string().describe('Conversation id.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List internal notes' },
    },
    handle(async ({ conversation_id, limit, cursor }) =>
      jsonResult(await client.listConversationNotes(conversation_id, { limit, cursor })),
    ),
  );

  server.registerTool(
    'list_messages',
    {
      title: 'List messages',
      description:
        'List the messages in a conversation, newest first. Each message includes its direction (inbound/outbound), delivery status, and content. Paginated.',
      inputSchema: {
        conversation_id: z.string().describe('The conversation to read messages from.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List messages' },
    },
    handle(async ({ conversation_id, limit, cursor }) =>
      jsonResult(await client.listConversationMessages(conversation_id, { limit, cursor })),
    ),
  );

  server.registerTool(
    'get_broadcast',
    {
      title: 'Get broadcast status',
      description:
        'Read a broadcast campaign by id — its status and delivered / read / rejected counts. Use this to poll progress after launching one.',
      inputSchema: {
        id: z.string().describe('Broadcast id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get broadcast status' },
    },
    handle(async ({ id }) => jsonResult(await client.getBroadcast(id))),
  );

  server.registerTool(
    'list_team_members',
    {
      title: 'List team members',
      description:
        'List active team members who can receive a conversation assignment (user_id, full_name, role only — no email or login data). Call this before assign_conversation to resolve a name to a user_id.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'List team members' },
    },
    handle(async () => jsonResult(await client.listTeamMembers())),
  );

  server.registerTool(
    'list_pipelines',
    {
      title: 'List pipelines',
      description:
        'List every sales pipeline in the account with its ordered stages (id, name, color). Call this first to resolve a pipeline/stage name to the ids create_deal and update_deal need.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'List pipelines' },
    },
    handle(async () => jsonResult(await client.listPipelines())),
  );

  server.registerTool(
    'list_deals',
    {
      title: 'List deals',
      description:
        'List deals (sales opportunities), newest first. Optionally filter by pipeline_id, stage_id, contact_id, or status (open/won/lost). Paginated.',
      inputSchema: {
        pipeline_id: z.string().optional(),
        stage_id: z.string().optional(),
        contact_id: z.string().optional().describe('Only deals for this contact.'),
        status: z.enum(['open', 'won', 'lost']).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List deals' },
    },
    handle(async (args) => jsonResult(await client.listDeals(args))),
  );

  server.registerTool(
    'get_deal',
    {
      title: 'Get deal',
      description: 'Read a single deal (sales opportunity) by id, including its contact and stage.',
      inputSchema: {
        id: z.string().describe('Deal id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get deal' },
    },
    handle(async ({ id }) => jsonResult(await client.getDeal(id))),
  );

  server.registerTool(
    'list_appointments',
    {
      title: 'List appointments',
      description:
        'List appointments in a date window (default: 7 days ago to 30 days ahead), newest first by start time. Optionally filter by status, contact_id, or specialist_id.',
      inputSchema: {
        from: z.string().optional().describe('ISO 8601 date-time. Defaults to 7 days ago.'),
        to: z.string().optional().describe('ISO 8601 date-time. Defaults to 30 days ahead.'),
        status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
        contact_id: z.string().optional(),
        specialist_id: z.string().optional(),
      },
      annotations: { ...READ_ONLY, title: 'List appointments' },
    },
    handle(async (args) => jsonResult(await client.listAppointments(args))),
  );

  server.registerTool(
    'get_appointment',
    {
      title: 'Get appointment',
      description: 'Read a single appointment by id, including its contact.',
      inputSchema: {
        id: z.string().describe('Appointment id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get appointment' },
    },
    handle(async ({ id }) => jsonResult(await client.getAppointment(id))),
  );

  server.registerTool(
    'get_availability',
    {
      title: 'Get available time slots',
      description:
        'Find free time slots for a specialist or an agent, honoring their working hours, holidays, buffer time, existing bookings, and Google Calendar busy time. Call this before create_appointment to offer the customer real options instead of guessing.',
      inputSchema: {
        specialist_id: z.string().optional().describe('Specialist to check. Omit if checking an agent instead.'),
        agent_id: z.string().optional().describe('Agent user_id to check. Omit if checking a specialist instead.'),
        from: z.string().optional().describe('ISO 8601 date-time. Defaults to now.'),
        to: z.string().optional().describe('ISO 8601 date-time. Defaults to 7 days from "from". Max 60-day range.'),
        duration: z.number().int().min(5).max(480).optional().describe('Slot length in minutes. Defaults to 30.'),
      },
      annotations: { ...READ_ONLY, title: 'Get available time slots' },
    },
    handle(async (args) => jsonResult(await client.getAvailability(args))),
  );

  server.registerTool(
    'list_agendapro_bookings',
    {
      title: 'List AgendaPro bookings',
      description:
        'List bookings (reservas) from the connected AgendaPro account — an appointment scheduler independent from NexoOmni\'s own Appointments module. Optionally filter by a date range, location, service, provider, or contact_id.',
      inputSchema: {
        range_from: z.string().optional().describe('ISO date (YYYY-MM-DD). Defaults to AgendaPro\'s own default window.'),
        range_to: z.string().optional().describe('ISO date (YYYY-MM-DD).'),
        location_id: z.string().optional().describe('AgendaPro location id.'),
        service_id: z.string().optional().describe('AgendaPro service id.'),
        provider_id: z.string().optional().describe('AgendaPro service-provider id.'),
        contact_id: z.string().optional().describe('NexoOmni contact id — resolved to its linked AgendaPro client, if any.'),
        page: z.number().int().min(1).optional(),
      },
      annotations: { ...READ_ONLY, title: 'List AgendaPro bookings' },
    },
    handle(async (args) => jsonResult(await client.listAgendaProBookings(args))),
  );

  server.registerTool(
    'get_agendapro_available_slots',
    {
      title: 'Get available AgendaPro slots',
      description:
        'Find free time slots for an AgendaPro service on a given date, for a specific provider or location. Call this before create_agendapro_booking to offer the customer real options instead of guessing.',
      inputSchema: {
        service_id: z.string().describe('AgendaPro service id.'),
        date: z.string().describe('ISO date (YYYY-MM-DD).'),
        provider_id: z.string().optional().describe('AgendaPro service-provider id. Provide this or location_id.'),
        location_id: z.string().optional().describe('AgendaPro location id. Provide this or provider_id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get available AgendaPro slots' },
    },
    handle(async (args) => jsonResult(await client.getAgendaProAvailableSlots(args))),
  );

  server.registerTool(
    'list_agendapro_catalog',
    {
      title: 'List AgendaPro catalog',
      description: 'List AgendaPro\'s locations, services, or service providers — look these ids up before booking.',
      inputSchema: {
        resource: z.enum(['locations', 'services', 'providers']),
      },
      annotations: { ...READ_ONLY, title: 'List AgendaPro catalog' },
    },
    handle(async ({ resource }) => jsonResult(await client.listAgendaProCatalog(resource))),
  );

  server.registerTool(
    'get_contact_memory',
    {
      title: 'Get contact memory',
      description:
        'Read a contact\'s Nexo Memory: the AI-derived summary, sales stage, sentiment, risk level, opportunity score, and next best action, plus its dated timeline events, active facts (interests/objections/attributes), and commitments/tasks (pending and past). Use this to answer "what do we know about this customer?" without opening the dashboard.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get contact memory' },
    },
    handle(async ({ id }) => jsonResult(await client.getContactMemory(id))),
  );
}
