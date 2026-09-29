// ============================================================
// Read-only MCP tools for the in-app HTTP endpoint.
//
// Unlike the standalone stdio server (env-var gated), every tool here
// is registered or skipped per-request based on the calling API key's
// own scopes — the same scopes already managed in Settings → API
// keys. A key with only `contacts:read` will simply never see
// `assign_conversation` in its tool list.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope } from '@/lib/api-keys/scopes';
import { callRoute } from '../bridge';
import { handle, jsonResult } from './shared';

import { GET as meGET } from '@/app/api/v1/me/route';
import { GET as listContactsGET } from '@/app/api/v1/contacts/route';
import { GET as getContactGET } from '@/app/api/v1/contacts/[id]/route';
import { GET as getContactMemoryGET } from '@/app/api/v1/contacts/[id]/memory/route';
import { GET as listConversationsGET } from '@/app/api/v1/conversations/route';
import { GET as getConversationGET } from '@/app/api/v1/conversations/[id]/route';
import { GET as listMessagesGET } from '@/app/api/v1/conversations/[id]/messages/route';
import { GET as getBroadcastGET } from '@/app/api/v1/broadcasts/[id]/route';
import { GET as listTeamMembersGET } from '@/app/api/v1/team-members/route';
import { GET as listPipelinesGET } from '@/app/api/v1/pipelines/route';
import { GET as listDealsGET } from '@/app/api/v1/deals/route';
import { GET as getDealGET } from '@/app/api/v1/deals/[id]/route';
import { GET as listAppointmentsGET } from '@/app/api/v1/appointments/route';
import { GET as getAppointmentGET } from '@/app/api/v1/appointments/[id]/route';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerReadTools(server: McpServer, authHeader: string, scopes: string[]): void {
  // `whoami` needs no scope — a key with zero scopes still authenticates.
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Verify the API key and show which NexoOmni account it is bound to and what scopes it carries. Call this first to discover what actions are possible.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Who am I' },
    },
    handle(async () => jsonResult((await callRoute(meGET, '/me', authHeader)).data)),
  );

  if (hasScope(scopes, 'contacts:read')) {
    server.registerTool(
      'list_contacts',
      {
        title: 'List contacts',
        description:
          'List contacts in the CRM, newest first. Optionally filter by a free-text search (matches name or phone) or by a tag id. Results are paginated: pass the returned next_cursor to fetch the next page.',
        inputSchema: {
          search: z.string().optional().describe('Free-text search over name or phone number.'),
          tag: z.string().optional().describe('Tag id to filter by.'),
          limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
          cursor: z.string().optional().describe('Opaque pagination cursor from a previous response.'),
        },
        annotations: { ...READ_ONLY, title: 'List contacts' },
      },
      handle(async (args: { search?: string; tag?: string; limit?: number; cursor?: string }) =>
        jsonResult(
          await callRoute(listContactsGET, '/contacts', authHeader, {
            query: { search: args.search, tag: args.tag, limit: args.limit, cursor: args.cursor },
          }),
        ),
      ),
    );

    server.registerTool(
      'get_contact',
      {
        title: 'Get contact',
        description: 'Read a single contact by its id.',
        inputSchema: { id: z.string().describe('Contact id.') },
        annotations: { ...READ_ONLY, title: 'Get contact' },
      },
      handle(async ({ id }: { id: string }) =>
        jsonResult((await callRoute(getContactGET, `/contacts/${id}`, authHeader, { params: { id } })).data),
      ),
    );
  }

  if (hasScope(scopes, 'contact-memory:read')) {
    server.registerTool(
      'get_contact_memory',
      {
        title: 'Get contact memory',
        description:
          'Read a contact\'s Nexo Memory: the AI-derived summary, sales stage, sentiment, risk level, opportunity score, and next best action, plus its dated timeline events, active facts (interests/objections/attributes), and commitments/tasks (pending and past). Use this to answer "what do we know about this customer?" without opening the dashboard.',
        inputSchema: { id: z.string().describe('Contact id.') },
        annotations: { ...READ_ONLY, title: 'Get contact memory' },
      },
      handle(async ({ id }: { id: string }) =>
        jsonResult(
          (await callRoute(getContactMemoryGET, `/contacts/${id}/memory`, authHeader, { params: { id } })).data,
        ),
      ),
    );
  }

  if (hasScope(scopes, 'conversations:read')) {
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
      handle(async (args: { status?: string; contact_id?: string; limit?: number; cursor?: string }) =>
        jsonResult(
          await callRoute(listConversationsGET, '/conversations', authHeader, {
            query: {
              status: args.status,
              contact_id: args.contact_id,
              limit: args.limit,
              cursor: args.cursor,
            },
          }),
        ),
      ),
    );

    server.registerTool(
      'get_conversation',
      {
        title: 'Get conversation',
        description: 'Read a single conversation by id, including its contact and tags.',
        inputSchema: { id: z.string().describe('Conversation id.') },
        annotations: { ...READ_ONLY, title: 'Get conversation' },
      },
      handle(async ({ id }: { id: string }) =>
        jsonResult(
          (await callRoute(getConversationGET, `/conversations/${id}`, authHeader, { params: { id } })).data,
        ),
      ),
    );
  }

  if (hasScope(scopes, 'messages:read')) {
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
      handle(async ({ conversation_id, limit, cursor }: { conversation_id: string; limit?: number; cursor?: string }) =>
        jsonResult(
          await callRoute(listMessagesGET, `/conversations/${conversation_id}/messages`, authHeader, {
            params: { id: conversation_id },
            query: { limit, cursor },
          }),
        ),
      ),
    );
  }

  if (hasScope(scopes, 'broadcasts:send')) {
    server.registerTool(
      'get_broadcast',
      {
        title: 'Get broadcast status',
        description:
          'Read a broadcast campaign by id — its status and delivered / read / rejected counts. Use this to poll progress after launching one.',
        inputSchema: { id: z.string().describe('Broadcast id.') },
        annotations: { ...READ_ONLY, title: 'Get broadcast status' },
      },
      handle(async ({ id }: { id: string }) =>
        jsonResult((await callRoute(getBroadcastGET, `/broadcasts/${id}`, authHeader, { params: { id } })).data),
      ),
    );
  }

  if (hasScope(scopes, 'conversations:assign')) {
    server.registerTool(
      'list_team_members',
      {
        title: 'List team members',
        description:
          'List active team members who can receive a conversation assignment (user_id, full_name, role only — no email or login data). Call this before assign_conversation to resolve a name to a user_id.',
        inputSchema: {},
        annotations: { ...READ_ONLY, title: 'List team members' },
      },
      handle(async () => jsonResult((await callRoute(listTeamMembersGET, '/team-members', authHeader)).data)),
    );
  }

  if (hasScope(scopes, 'deals:read')) {
    server.registerTool(
      'list_pipelines',
      {
        title: 'List pipelines',
        description:
          'List every sales pipeline in the account with its ordered stages (id, name, color). Call this first to resolve a pipeline/stage name to the ids create_deal and update_deal need.',
        inputSchema: {},
        annotations: { ...READ_ONLY, title: 'List pipelines' },
      },
      handle(async () => jsonResult((await callRoute(listPipelinesGET, '/pipelines', authHeader)).data)),
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
      handle(
        async (args: {
          pipeline_id?: string;
          stage_id?: string;
          contact_id?: string;
          status?: string;
          limit?: number;
          cursor?: string;
        }) =>
          jsonResult(
            await callRoute(listDealsGET, '/deals', authHeader, {
              query: {
                pipeline_id: args.pipeline_id,
                stage_id: args.stage_id,
                contact_id: args.contact_id,
                status: args.status,
                limit: args.limit,
                cursor: args.cursor,
              },
            }),
          ),
      ),
    );

    server.registerTool(
      'get_deal',
      {
        title: 'Get deal',
        description: 'Read a single deal (sales opportunity) by id, including its contact and stage.',
        inputSchema: { id: z.string().describe('Deal id.') },
        annotations: { ...READ_ONLY, title: 'Get deal' },
      },
      handle(async ({ id }: { id: string }) =>
        jsonResult((await callRoute(getDealGET, `/deals/${id}`, authHeader, { params: { id } })).data),
      ),
    );
  }

  if (hasScope(scopes, 'appointments:read')) {
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
      handle(
        async (args: { from?: string; to?: string; status?: string; contact_id?: string; specialist_id?: string }) =>
          jsonResult(
            await callRoute(listAppointmentsGET, '/appointments', authHeader, {
              query: {
                from: args.from,
                to: args.to,
                status: args.status,
                contact_id: args.contact_id,
                specialist_id: args.specialist_id,
              },
            }),
          ),
      ),
    );

    server.registerTool(
      'get_appointment',
      {
        title: 'Get appointment',
        description: 'Read a single appointment by id, including its contact.',
        inputSchema: { id: z.string().describe('Appointment id.') },
        annotations: { ...READ_ONLY, title: 'Get appointment' },
      },
      handle(async ({ id }: { id: string }) =>
        jsonResult((await callRoute(getAppointmentGET, `/appointments/${id}`, authHeader, { params: { id } })).data),
      ),
    );
  }
}