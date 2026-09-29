// ============================================================
// Write tools — registered only when NEXOOMNI_ENABLE_WRITES is set.
//
// These change data or send a WhatsApp message. They are gated so a
// read-only deployment never exposes them to the model at all. (The
// API key's scopes are still enforced server-side; a call without the
// right scope returns a clean `forbidden` error.)
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NexoOmniClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

const templateSchema = z
  .object({
    name: z.string().describe('Meta-approved template name.'),
    language: z.string().describe('Template language code, e.g. "en_US".'),
    params: z
      .array(z.string())
      .optional()
      .describe('Positional body variables, in order.'),
  })
  .describe('Template payload — required when type is "template".');

export function registerWriteTools(server: McpServer, client: NexoOmniClient): void {
  server.registerTool(
    'send_message',
    {
      title: 'Send WhatsApp message',
      description:
        'Send a WhatsApp message to a phone number (E.164, e.g. +14155550123). The contact and conversation are found-or-created automatically. Use type "text" for a free-form message (only valid inside the 24-hour customer-service window), or "template" to send an approved template (required to open a new conversation). Media types (image/video/document/audio) require a media_url. This sends a real message to a real person — confirm the recipient and content with the user before calling.',
      inputSchema: {
        to: z.string().describe('Recipient phone number in E.164 format, e.g. +14155550123.'),
        type: z
          .enum(['text', 'template', 'image', 'video', 'document', 'audio'])
          .default('text')
          .describe('Message type. Defaults to "text".'),
        text: z
          .string()
          .optional()
          .describe('Message body for "text", or the caption for a media type.'),
        media_url: z
          .string()
          .url()
          .optional()
          .describe('Publicly reachable URL of the media file (required for media types).'),
        filename: z.string().optional().describe('File name for a "document" send.'),
        template: templateSchema.optional(),
        reply_to_message_id: z
          .string()
          .optional()
          .describe('Optional id of a message in the same conversation to reply to.'),
      },
      annotations: { title: 'Send WhatsApp message', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.sendMessage(args))),
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Create contact',
      description:
        'Create a contact by phone number (E.164, required). Find-or-create: if a contact with that phone already exists it is returned unchanged. Optional: name, email, company, and tags (tag names, created if missing).',
      inputSchema: {
        phone: z.string().describe('Phone number in E.164 format, e.g. +14155550123.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Tag names; created if they do not exist.'),
      },
      annotations: { title: 'Create contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (args) => jsonResult(await client.createContact(args))),
  );

  server.registerTool(
    'update_contact',
    {
      title: 'Update contact',
      description:
        'Update an existing contact. Only the fields you pass are changed. Pass tags (an array of tag names) to replace the contact’s tags entirely.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional().describe('Replaces the contact’s tags.'),
      },
      annotations: { title: 'Update contact', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateContact(id, body))),
  );

  server.registerTool(
    'assign_conversation',
    {
      title: 'Assign conversation',
      description:
        'Assign a conversation to an active team member, or remove its assignment. Never sends a customer message and never changes the conversation status. Call list_team_members first to resolve a name to a user_id.',
      inputSchema: {
        id: z.string().describe('Conversation id.'),
        assigned_agent_id: z
          .string()
          .nullable()
          .describe('Team member user_id from list_team_members, or null to unassign.'),
      },
      annotations: { title: 'Assign conversation', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, assigned_agent_id }) =>
      jsonResult(await client.assignConversation(id, assigned_agent_id)),
    ),
  );

  server.registerTool(
    'add_conversation_note',
    {
      title: 'Add internal note',
      description:
        'Add a private team note to a conversation. Never delivered to the customer through WhatsApp, Meta, Yeastar, or web chat — visible only inside the NexoOmni inbox.',
      inputSchema: {
        id: z.string().describe('Conversation id.'),
        body: z.string().min(1).describe('Note text.'),
      },
      annotations: { title: 'Add internal note', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, body }) => jsonResult(await client.addConversationNote(id, body))),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create follow-up task',
      description:
        'Schedule a follow-up task for a contact (e.g. "call back tomorrow at 3pm"). Triggers the existing "10 minutes before" reminder to the assigned agent. Requires an existing contact id — use create_contact first if you only have a phone number.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        description: z.string().min(1).max(300).describe('What the task is about.'),
        due_at: z.string().describe('When the task is due, ISO 8601 date-time, e.g. 2026-10-01T15:00:00-06:00.'),
        owner: z.enum(['agent', 'customer']).optional().describe('Who owns the follow-up. Defaults to "agent".'),
      },
      annotations: { title: 'Create follow-up task', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.createTask(id, body))),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update follow-up task',
      description:
        'Update a follow-up task: change its status (pending/done/overdue/cancelled), description, or due date/time. Only the fields you pass are changed. Changing due_at re-arms the "10 minutes before" reminder for the new time.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        task_id: z.string().describe('Task id.'),
        status: z.enum(['pending', 'done', 'overdue', 'cancelled']).optional(),
        description: z.string().min(1).max(300).optional(),
        due_at: z.string().optional().describe('ISO 8601 date-time.'),
      },
      annotations: { title: 'Update follow-up task', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, task_id, ...body }) => jsonResult(await client.updateTask(id, task_id, body))),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete follow-up task',
      description:
        'Permanently delete a follow-up task. Prefer update_task with status "cancelled" or "done" unless the task was created by mistake.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
        task_id: z.string().describe('Task id.'),
      },
      annotations: { title: 'Delete follow-up task', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    handle(async ({ id, task_id }) => jsonResult(await client.deleteTask(id, task_id))),
  );

  server.registerTool(
    'create_deal',
    {
      title: 'Create deal',
      description:
        'Create a deal (sales opportunity) in a pipeline. Call list_pipelines first to get valid pipeline_id/stage_id values. contact_id is optional but recommended.',
      inputSchema: {
        title: z.string().min(1).describe('Deal title, e.g. "Acme Inc — annual plan".'),
        pipeline_id: z.string().describe('Pipeline id from list_pipelines.'),
        stage_id: z.string().describe('Stage id from list_pipelines (must belong to pipeline_id).'),
        contact_id: z.string().optional().describe('Contact this deal belongs to.'),
        value: z.number().optional().describe('Deal value. Defaults to 0.'),
        currency: z.string().optional().describe('ISO currency code, e.g. "USD". Defaults to the account default.'),
        notes: z.string().optional(),
        expected_close_date: z.string().optional().describe('Date string, e.g. "2026-12-01".'),
      },
      annotations: { title: 'Create deal', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (body) => jsonResult(await client.createDeal(body))),
  );

  server.registerTool(
    'update_deal',
    {
      title: 'Update deal',
      description:
        'Update a deal: move it to a different stage (must belong to the same pipeline), change its value/currency/status/notes/contact, or set the expected close date. Only the fields you pass are changed.',
      inputSchema: {
        id: z.string().describe('Deal id.'),
        title: z.string().min(1).optional(),
        stage_id: z.string().optional().describe('Moves the deal to this stage (same pipeline only).'),
        status: z.enum(['open', 'won', 'lost']).optional(),
        value: z.number().optional(),
        currency: z.string().optional(),
        contact_id: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        expected_close_date: z.string().nullable().optional(),
      },
      annotations: { title: 'Update deal', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateDeal(id, body))),
  );

  server.registerTool(
    'create_appointment',
    {
      title: 'Create appointment',
      description:
        'Schedule an appointment. Checks for scheduling conflicts (same specialist or same agent) and rejects the request if the slot is already booked. Syncs to Google Calendar automatically if configured.',
      inputSchema: {
        title: z.string().min(1).max(160).describe('Appointment title, e.g. "Consulta — Jane Doe".'),
        starts_at: z.string().describe('ISO 8601 date-time.'),
        ends_at: z.string().describe('ISO 8601 date-time, must be after starts_at.'),
        timezone: z.string().optional().describe('IANA timezone, e.g. "America/Mexico_City". Defaults to UTC.'),
        contact_id: z.string().optional(),
        assigned_agent_id: z.string().optional().describe('Active team member user_id. Defaults to the account owner.'),
        specialist_id: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: { title: 'Create appointment', readOnlyHint: false, openWorldHint: true },
    },
    handle(async (body) => jsonResult(await client.createAppointment(body))),
  );

  server.registerTool(
    'update_appointment',
    {
      title: 'Update appointment',
      description:
        'Update an appointment: change its status (scheduled/confirmed/completed/cancelled/no_show), reschedule (re-checks for conflicts), or update its contact/agent/specialist/notes. Only the fields you pass are changed.',
      inputSchema: {
        id: z.string().describe('Appointment id.'),
        title: z.string().min(1).max(160).optional(),
        starts_at: z.string().optional().describe('ISO 8601 date-time.'),
        ends_at: z.string().optional().describe('ISO 8601 date-time.'),
        status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(),
        contact_id: z.string().nullable().optional(),
        assigned_agent_id: z.string().optional(),
        specialist_id: z.string().nullable().optional(),
        notes: z.string().optional(),
      },
      annotations: { title: 'Update appointment', readOnlyHint: false, openWorldHint: true },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateAppointment(id, body))),
  );
}
